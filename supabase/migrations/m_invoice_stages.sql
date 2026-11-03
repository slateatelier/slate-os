-- m_invoice_stages.sql (3 Nov 2026)
-- Fee stages reach Books, so an invoice can bill stages and print the whole fee schedule.
--  1. Business › Fees payment stages (milestones) and the fee note are copied to the Books project as
--     `stages` [{id, label, pct, amount}] and `feeTerms`. Amounts add up to the fee exactly (rounding goes to the last stage).
--  2. Business "billed" is fixed: billed = invoiced + fee money received without an invoice (the advance, Tally receipts).
--     It was max(invoiced, received), which under-states billing once an advance was taken without an invoice
--     (CSRM: 3.25 lakh advance + 6.5 lakh invoice showed as 6.5 lakh billed instead of 9.75 lakh).
--     Also returns the stage ids already invoiced, so Business won't let a billed stage be removed.
--  3. Every Business fee record is synced again so the existing Books projects get their stages now.
-- Safe to run more than once. Run in the Supabase SQL editor as one script.

begin;

create or replace function private.books_sync_project(p_id text, d jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare o jsonb; p text; tba boolean; free boolean; fee numeric; stg jsonb;
begin
  if d is not null then select x.data into o from public.docs x where x.path = 'projects/' || (d->>'osId'); end if;
  tba := coalesce(d->>'feeBasis', '') = 'tba';
  -- pro bono is kept with the agreement details (agreements/<id>); older projects may carry it on the project itself
  free := coalesce(o->>'proBono', '') = 'yes'
       or exists (select 1 from public.docs a where a.path = 'agreements/' || coalesce(d->>'osId', '') and a.data->>'proBono' = 'yes');
  if d is null or (coalesce((d->>'fee')::numeric, 0) <= 0 and not tba and not free) then
    -- no fee, or removed: a Books copy stays, marked as no longer linked
    perform set_config('slate.books_sync', '1', true);
    update public.books_docs set data = data || '{"osRemoved":true}' where coll = 'projects' and data->>'finId' = p_id;
    perform set_config('slate.books_sync', '', true);
    return;
  end if;
  fee := case when tba or free then 0 else coalesce((d->>'fee')::numeric, 0) end;
  -- payment stages: amount = the fee to the end of this stage less the fee to the end of the one before, so they add up exactly
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m->>'id', 'label', coalesce(m->>'label', ''), 'pct', coalesce((m->>'pct')::numeric, 0),
           'amount', round(fee * cum / 100) - round(fee * (cum - coalesce((m->>'pct')::numeric, 0)) / 100)) order by ord), '[]'::jsonb)
    into stg
    from (select m, ord, sum(coalesce((m->>'pct')::numeric, 0)) over (order by ord) cum
            from jsonb_array_elements(coalesce(d->'milestones', '[]'::jsonb)) with ordinality t(m, ord)
           where coalesce(m->>'id', '') <> '') s;
  p := private.books_find('projects', 'finId', p_id, 'code', d->>'code');
  perform private.books_put_os(p, jsonb_build_object(
    'src', 'os', 'osId', coalesce(d->>'osId', ''), 'finId', p_id, 'code', coalesce(d->>'code', ''), 'name', coalesce(d->>'name', ''),
    'client', coalesce(d->>'client', ''), 'contract', fee,
    'feeTba', tba, 'estFee', case when tba then coalesce((d->>'estFee')::numeric, 0) else 0 end, 'free', free,
    'status', private.books_os_status(coalesce(o, '{}'::jsonb)), 'overhead', false,
    'jvPartner', '', 'jvShare', 0, 'notes', '', 'earned', 0, 'osRemoved', false,
    'stages', stg, 'feeTerms', coalesce(d->>'feeNote', '')),
    array['client', 'overhead', 'jvPartner', 'jvShare', 'notes', 'earned']);
end $function$;

create or replace function public.biz_books_money()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare res jsonb;
begin
  if not private.is_finance() then raise exception 'Only the Principal or the COO sees this (with the PIN)'; end if;
  with pj as (
    select doc_id id, data->>'osId' os from public.books_docs where coll = 'projects' and coalesce(data->>'osId', '') <> ''
  ), inc as (
    select doc_id id from public.books_docs where coll = 'ledgers' and data->>'group' = 'inc'
  ), iss as (
    select doc_id id, data d from public.books_docs
     where coll = 'invoices' and coalesce(data->>'status', '') not in ('', 'draft', 'cancelled', 'void')
  ), v as (
    select data d, coalesce(data->>'inv', '') <> '' and exists (select 1 from iss where iss.id = data->>'inv') on_inv
      from public.books_docs where coll = 'vouchers' and coalesce(data->>'status', 'approved') in ('approved', 'tally', 'checked')
  ), lines as (
    select pj.os, left(v.d->>'date', 7) ym, v.on_inv,
      (c->>'a')::numeric * case when coalesce((l->>'cr')::numeric, 0) > 0 then 1 else -1 end amt
    from v, jsonb_array_elements(v.d->'lines') l, jsonb_array_elements(coalesce(l->'cc', '[]')) c, pj
    where l->>'l' in (select id from inc) and c->>'p' = pj.id
  ), rec as (
    select os, ym, sum(amt) amt from lines group by os, ym
  ), unl as (
    select os, sum(amt) amt from lines where not on_inv group by os
  ), inv as (
    select pj.os, sum(t.base / case when iss.d->>'vatMode' = 'incl' and coalesce((iss.d->>'vatPct')::numeric, 0) > 0 then 1 + (iss.d->>'vatPct')::numeric / 100 else 1 end) amt
    from iss
    cross join lateral (select coalesce(sum((x->>'amount')::numeric), 0) base from jsonb_array_elements(coalesce(iss.d->'items', '[]')) x) t
    join pj on pj.id = iss.d->>'project'
    group by pj.os
  ), stg as (
    select pj.os, jsonb_agg(distinct x->>'stage') ids
    from iss cross join lateral jsonb_array_elements(coalesce(iss.d->'items', '[]')) x
    join pj on pj.id = iss.d->>'project'
    where coalesce(x->>'stage', '') <> ''
    group by pj.os
  ), ids as (select os from rec union select os from inv)
  select coalesce(jsonb_object_agg(ids.os, jsonb_build_object(
      'rec', coalesce((select sum(amt) from rec where rec.os = ids.os), 0),
      'inv', coalesce((select amt from inv where inv.os = ids.os), 0),
      'unl', coalesce((select amt from unl where unl.os = ids.os), 0),
      'st', coalesce((select stg.ids from stg where stg.os = ids.os), '[]'::jsonb),
      'm', coalesce((select jsonb_object_agg(ym, amt) from rec where rec.os = ids.os), '{}'::jsonb))), '{}'::jsonb)
  into res from ids;
  return res;
end $function$;

-- give the existing Books projects their stages now
select private.books_sync_project(doc_id, data) from public.fin_docs where coll = 'projects';

commit;

-- check: CSRM should show 4 stages of Tk 3,25,000
select data->>'code' code, data->'stages' stages, data->>'feeTerms' terms
  from public.books_docs where coll = 'projects' and data->>'code' = 'JOL-CSRM01-5K-2609';
