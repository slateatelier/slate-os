-- m_invoice_short.sql (4 Nov 2026)
-- Part payments on Books invoices.
--  invoices/<id>.short: { amt, fee, why, note, by, at } — a balance the Principal or the COO closed without payment
--  (discount agreed, written off, small difference). amt is in invoice terms (with VAT), fee in fee terms.
--  1. Closing or reopening a balance doesn't change what the client sees, so it keeps the invoice's signature.
--  2. Business › Fees counts a closed balance as not billed (billed = invoiced less what was closed, plus fee received without an invoice).
-- Safe to run more than once.
begin;

create or replace function private.books_sign_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r text; ns jsonb; os jsonb; g jsonb;
begin
  if auth.uid() is null or coalesce(current_setting('slate.books_sync', true), '') = '1' then return coalesce(new, old); end if;
  r := private.books_role();
  if coalesce(new.coll, old.coll) = 'signs' then
    if coalesce(new.doc_id, old.doc_id) <> auth.uid()::text or r not in ('Principal', 'COO') then
      raise exception 'Only the Principal and the COO keep a signature, and each only their own';
    end if;
    if tg_op <> 'DELETE' and (coalesce(new.data->>'img', '') !~ '^data:image/jpeg;base64,' or pg_column_size(new.data) > 200000) then
      raise exception 'The signature must be a JPEG image under 150 KB';
    end if;
    return coalesce(new, old);
  end if;
  if coalesce(new.coll, old.coll) = 'invoices' and tg_op <> 'DELETE' then
    ns := nullif(new.data->'sign', 'null'::jsonb);
    os := case when tg_op = 'UPDATE' then nullif(old.data->'sign', 'null'::jsonb) else null end;
    if ns is not null and ns is distinct from os then
      select data into g from public.books_docs where path = 'signs/' || auth.uid()::text;
      if ns->>'uid' <> auth.uid()::text or g is null or ns->>'name' is distinct from g->>'name' or ns->>'desig' is distinct from g->>'desig' then
        raise exception 'Only the person whose signature it is can sign with it';
      end if;
    elsif ns is not null and tg_op = 'UPDATE' and ns->>'uid' <> auth.uid()::text
      and ((new.data - 'sign' - 'trail' - 'at' - 'status' - 'files' - 'short') is distinct from (old.data - 'sign' - 'trail' - 'at' - 'status' - 'files' - 'short')) then
      raise exception 'This invoice is signed by %. Saving changes removes the signature; ask them to sign again', ns->>'name';
    end if;
  end if;
  return coalesce(new, old);
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
    select pj.os, sum((t.base - coalesce((iss.d->'short'->>'fee')::numeric, 0)) / case when iss.d->>'vatMode' = 'incl' and coalesce((iss.d->>'vatPct')::numeric, 0) > 0 then 1 + (iss.d->>'vatPct')::numeric / 100 else 1 end) amt
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

commit;
