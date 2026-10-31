-- Books and Business before the move of the old books (31 Oct 2026). Runs after m_access2.sql.
--  * Project status reaches Books in full: Active, On hold, Completed, Construction support (design done, site visits going on),
--    Closed (stopped after a phase) and Cancelled. Completed and Construction support still owe the whole fee; On hold, Closed and
--    Cancelled owe only the work done.
--  * "Fee to be agreed" (Business › Fees) and pro bono projects get a Books copy (pro bono is read from the agreement details), so money received can be recorded against them.
--    Neither counts as money owed.
--  * Business reads money received and invoiced per project from Books (public.biz_books_money), instead of the old Finance module.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

-- the Books status of a SLATE OS project
create or replace function private.books_os_status(o jsonb) returns text
language sql immutable set search_path to '' as $$
  select case
    when not coalesce((o->>'closed')::boolean, false) then 'Active'
    when o->>'outcome' = 'onhold' then 'On hold'
    when o->>'outcome' = 'cancelled' then 'Cancelled'
    when o->>'outcome' = 'partial' then 'Closed'
    when o->>'outcome' = 'completed' or (coalesce(o->>'outcome', '') = '' and o->>'entry' = 'completed')
      then case when o->'support'->>'status' = 'active' then 'Construction support' else 'Completed' end
    else 'Closed' end
$$;

create or replace function private.books_sync_project(p_id text, d jsonb) returns void
language plpgsql security definer set search_path to '' as $$
declare o jsonb; p text; tba boolean; free boolean;
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
  p := private.books_find('projects', 'finId', p_id, 'code', d->>'code');
  perform private.books_put_os(p, jsonb_build_object(
    'src', 'os', 'osId', coalesce(d->>'osId', ''), 'finId', p_id, 'code', coalesce(d->>'code', ''), 'name', coalesce(d->>'name', ''),
    'client', coalesce(d->>'client', ''), 'contract', case when tba or free then 0 else coalesce((d->>'fee')::numeric, 0) end,
    'feeTba', tba, 'estFee', case when tba then coalesce((d->>'estFee')::numeric, 0) else 0 end, 'free', free,
    'status', private.books_os_status(coalesce(o, '{}'::jsonb)), 'overhead', false,
    'jvPartner', '', 'jvShare', 0, 'notes', '', 'earned', 0, 'osRemoved', false),
    array['client', 'overhead', 'jvPartner', 'jvShare', 'notes', 'earned']);
end $$;

-- Studio changes that matter to Books: code, name, client; and closing, outcome, construction support or pro bono
create or replace function private.books_from_project() returns trigger
language plpgsql security definer set search_path to '' as $$
declare f record;
begin
  if (old.data->'code', old.data->'name', old.data->'client') is distinct from (new.data->'code', new.data->'name', new.data->'client') then
    perform set_config('slate.os_sync', '1', true);
    update public.fin_docs set data = data || jsonb_strip_nulls(jsonb_build_object('code', new.data->'code', 'name', new.data->'name', 'client', new.data->'client'))
    where coll = 'projects' and data->>'osId' = new.doc_id
      and (data->'code', data->'name', data->'client') is distinct from (new.data->'code', new.data->'name', new.data->'client');
    perform set_config('slate.os_sync', '', true);
  end if;
  if (old.data->'closed', old.data->'outcome', old.data->'entry', old.data->'support'->'status', old.data->'proBono')
     is distinct from (new.data->'closed', new.data->'outcome', new.data->'entry', new.data->'support'->'status', new.data->'proBono') then
    for f in select doc_id, data from public.fin_docs where coll = 'projects' and data->>'osId' = new.doc_id loop
      perform private.books_sync_project(f.doc_id, f.data);
    end loop;
  end if;
  return null;
end $$;

-- marking a project pro bono (or paid again) is saved with its agreement details: bring its Books copy up to date
create or replace function private.books_from_agreement() returns trigger
language plpgsql security definer set search_path to '' as $$
declare f record;
begin
  if tg_op = 'UPDATE' and (old.data->'proBono') is not distinct from (new.data->'proBono') then return null; end if;
  for f in select doc_id, data from public.fin_docs where coll = 'projects' and data->>'osId' = new.doc_id loop
    perform private.books_sync_project(f.doc_id, f.data);
  end loop;
  return null;
end $$;
drop trigger if exists books_from_agreement on public.docs;
create trigger books_from_agreement after insert or update on public.docs
  for each row when (new.coll = 'agreements') execute function private.books_from_agreement();

-- Business › Fees and Overview: money received and invoiced per SLATE OS project, from Books
create or replace function public.biz_books_money() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare res jsonb;
begin
  if not private.is_finance() then raise exception 'Only the Principal or the COO sees this (with the PIN)'; end if;
  with pj as (
    select doc_id id, data->>'osId' os from public.books_docs where coll = 'projects' and coalesce(data->>'osId', '') <> ''
  ), inc as (
    select doc_id id from public.books_docs where coll = 'ledgers' and data->>'group' = 'inc'
  ), v as (
    select data d from public.books_docs where coll = 'vouchers' and coalesce(data->>'status', 'approved') in ('approved', 'tally', 'checked')
  ), rec as (
    select pj.os, left(v.d->>'date', 7) ym,
      sum((c->>'a')::numeric * case when coalesce((l->>'cr')::numeric, 0) > 0 then 1 else -1 end) amt
    from v, jsonb_array_elements(v.d->'lines') l, jsonb_array_elements(coalesce(l->'cc', '[]')) c, pj
    where l->>'l' in (select id from inc) and c->>'p' = pj.id
    group by pj.os, left(v.d->>'date', 7)
  ), inv as (
    select pj.os, sum(t.base / case when i.data->>'vatMode' = 'incl' and coalesce((i.data->>'vatPct')::numeric, 0) > 0 then 1 + (i.data->>'vatPct')::numeric / 100 else 1 end) amt
    from public.books_docs i
    cross join lateral (select coalesce(sum((x->>'amount')::numeric), 0) base from jsonb_array_elements(coalesce(i.data->'items', '[]')) x) t
    join pj on pj.id = i.data->>'project'
    where i.coll = 'invoices' and coalesce(i.data->>'status', '') not in ('', 'draft', 'cancelled', 'void')
    group by pj.os
  ), ids as (select os from rec union select os from inv)
  select coalesce(jsonb_object_agg(ids.os, jsonb_build_object(
      'rec', coalesce((select sum(amt) from rec where rec.os = ids.os), 0),
      'inv', coalesce((select amt from inv where inv.os = ids.os), 0),
      'm', coalesce((select jsonb_object_agg(ym, amt) from rec where rec.os = ids.os), '{}'::jsonb))), '{}'::jsonb)
  into res from ids;
  return res;
end $$;
revoke all on function public.biz_books_money() from public, anon;
grant execute on function public.biz_books_money() to authenticated;

-- bring every Books copy up to date with the new rules
do $$ declare f record; begin
  for f in select doc_id, data from public.fin_docs where coll = 'projects' loop perform private.books_sync_project(f.doc_id, f.data); end loop;
end $$;

commit;
