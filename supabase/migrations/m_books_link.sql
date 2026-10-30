-- SLATE Books ← SLATE OS (31 Oct 2026). SLATE OS keeps the agreements; Books keeps the money.
-- 1. Staff: everyone in Business › HR & salaries appears in Books › Staff (employee ID, name, designation,
--    joining date, salary history, tax, bank/cash). Changed only in Business; Books reads them.
-- 2. Projects: every project with a fee in Business › Fees appears in Books › Projects (code, name, fee,
--    open or closed). Books keeps its own details: the client's name for invoices, overhead, joint-venture
--    partner and share, notes.
-- 3. New staff and new projects are made in SLATE OS only, never in Books.
-- No accounts are made: the real chart of accounts comes with the books when they are moved in.
-- Changes in SLATE OS reach Books at once (database triggers). Nothing in SLATE OS is changed by this file.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

-- ---------- write one SLATE OS record into Books, keeping Books' own details ----------
create or replace function private.books_put_os(p_path text, p_data jsonb, p_keep text[]) returns void
language plpgsql security definer set search_path to '' as $$
declare cur jsonb; k text;
begin
  select data into cur from public.books_docs where path = p_path;
  if cur is not null and p_keep is not null then
    foreach k in array p_keep loop
      if cur ? k then p_data := p_data || jsonb_build_object(k, cur->k); end if;
    end loop;
  end if;
  perform set_config('slate.books_sync', '1', true);
  insert into public.books_docs (path, coll, doc_id, data)
  values (p_path, regexp_replace(p_path, '/[^/]+$', ''), regexp_replace(p_path, '^.*/', ''), p_data)
  on conflict (path) do update set data = excluded.data;
  perform set_config('slate.books_sync', '', true);
end $$;

-- the Books record for a SLATE OS record: the one already linked to it, else one with the same employee ID or
-- project code (records brought in with the old books), else a new one
create or replace function private.books_find(p_coll text, p_key text, p_osid text, p_match text, p_val text) returns text
language sql stable security definer set search_path to '' as $$
  select coalesce(
    (select path from public.books_docs where coll = p_coll and data->>p_key = p_osid limit 1),
    (select path from public.books_docs where coll = p_coll and coalesce(p_val, '') <> ''
       and upper(regexp_replace(coalesce(data->>p_match, ''), '[\s.]', '', 'g')) = upper(regexp_replace(p_val, '[\s.]', '', 'g'))
       and coalesce(data->>'src', '') <> 'os' order by path limit 1),
    p_coll || '/os_' || p_osid)
$$;

-- ---------- staff ----------
create or replace function private.books_sync_staff(p_id text, d jsonb) returns void
language plpgsql security definer set search_path to '' as $$
declare r jsonb; m text := to_char((now() at time zone 'Asia/Dhaka')::date, 'YYYY-MM'); g numeric; num int; bank numeric; p text;
begin
  if d is null then   -- removed from Business: kept in Books (it is on past salary sheets), no longer on the sheet
    perform set_config('slate.books_sync', '1', true);
    update public.books_docs set data = data || '{"active":false,"osRemoved":true}' where coll = 'staff' and data->>'osId' = p_id;
    perform set_config('slate.books_sync', '', true);
    return;
  end if;
  select x.value into r from jsonb_array_elements(coalesce(d->'rates', '[]')) x where x.value->>'from' <= m order by x.value->>'from' desc limit 1;
  if r is null then select x.value into r from jsonb_array_elements(coalesce(d->'rates', '[]')) x order by x.value->>'from' limit 1; end if;
  g := coalesce((r->>'basic')::numeric, 0) + coalesce((r->>'house')::numeric, 0) + coalesce((r->>'medical')::numeric, 0)
     + coalesce((r->>'conv')::numeric, 0) + coalesce((r->>'other')::numeric, 0);
  bank := case d->>'payMethod' when 'bank' then g when 'split' then coalesce((d->>'bankPart')::numeric, 0) else 0 end;
  num := nullif(regexp_replace(coalesce(d->>'empId', ''), '\D', '', 'g'), '')::int;
  p := private.books_find('staff', 'osId', p_id, 'empId', d->>'empId');
  perform private.books_put_os(p, jsonb_build_object(
    'src', 'os', 'osId', p_id, 'userId', coalesce(d->>'userId', ''),
    'empId', coalesce(d->>'empId', ''),
    'name', coalesce(nullif(d->>'holder', ''), d->>'name', ''),          -- a shared account (Accounts) prints its holder
    'account', case when coalesce(d->>'holder', '') <> '' then d->>'name' else '' end,
    'designation', coalesce(d->>'designation', ''),
    'joined', coalesce(d->>'joinDate', ''), 'left', coalesce(d->>'leftOn', ''),
    'gross', g, 'tax', coalesce((r->>'tax')::numeric, 0), 'bank', bank,
    'payMethod', coalesce(d->>'payMethod', 'cash'), 'bankPart', coalesce((d->>'bankPart')::numeric, 0),
    'rates', coalesce(d->'rates', '[]'),
    'remarks', case when coalesce(d->>'probationEnd', '') >= to_char((now() at time zone 'Asia/Dhaka')::date, 'YYYY-MM-DD') then 'Probation to ' || (d->>'probationEnd') else coalesce(d->>'note', '') end,
    'active', coalesce((d->>'active')::boolean, true),
    'sl', coalesce(num % 1000, 999)), null);
end $$;

-- ---------- projects ----------
create or replace function private.books_sync_project(p_id text, d jsonb) returns void
language plpgsql security definer set search_path to '' as $$
declare closed boolean; p text;
begin
  if d is null or coalesce((d->>'fee')::numeric, 0) <= 0 then   -- no fee, or removed: a Books copy stays, marked as no longer linked
    perform set_config('slate.books_sync', '1', true);
    update public.books_docs set data = data || '{"osRemoved":true}' where coll = 'projects' and data->>'finId' = p_id;
    perform set_config('slate.books_sync', '', true);
    return;
  end if;
  select coalesce((x.data->>'closed')::boolean, false) into closed from public.docs x where x.path = 'projects/' || (d->>'osId');
  p := private.books_find('projects', 'finId', p_id, 'code', d->>'code');
  perform private.books_put_os(p, jsonb_build_object(
    'src', 'os', 'osId', coalesce(d->>'osId', ''), 'finId', p_id,
    'code', coalesce(d->>'code', ''), 'name', coalesce(d->>'name', ''), 'client', coalesce(d->>'client', ''),
    'contract', coalesce((d->>'fee')::numeric, 0),
    'status', case when coalesce(closed, false) then 'Closed' else 'Active' end,
    'overhead', false, 'jvPartner', '', 'jvShare', 0, 'notes', '', 'earned', 0, 'osRemoved', false),
    array['client', 'overhead', 'jvPartner', 'jvShare', 'notes', 'earned']);
end $$;

-- ---------- triggers: Business and Studio changes reach Books at once ----------
create or replace function private.books_from_fin() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(new.coll, old.coll) = 'staff' then
    perform private.books_sync_staff(coalesce(new.doc_id, old.doc_id), case when tg_op = 'DELETE' then null else new.data end);
  elsif coalesce(new.coll, old.coll) = 'projects' then
    perform private.books_sync_project(coalesce(new.doc_id, old.doc_id), case when tg_op = 'DELETE' then null else new.data end);
  end if;
  return null;
end $$;
drop trigger if exists books_from_fin on public.fin_docs;
create trigger books_from_fin after insert or update or delete on public.fin_docs
  for each row execute function private.books_from_fin();

-- a project closed or reopened in Studio
create or replace function private.books_from_project() returns trigger
language plpgsql security definer set search_path to '' as $$
declare f record;
begin
  if (old.data->'closed') is not distinct from (new.data->'closed') then return null; end if;
  for f in select doc_id, data from public.fin_docs where coll = 'projects' and data->>'osId' = new.doc_id loop
    perform private.books_sync_project(f.doc_id, f.data);
  end loop;
  return null;
end $$;
drop trigger if exists books_from_project on public.docs;
create trigger books_from_project after update on public.docs
  for each row when (new.coll = 'projects') execute function private.books_from_project();

-- ---------- Books cannot make staff or projects, or change what SLATE OS owns ----------
create or replace function private.books_os_lock() returns trigger
language plpgsql security definer set search_path to '' as $$
declare k text;
begin
  if current_setting('slate.books_sync', true) = '1' or auth.uid() is null then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    if new.coll in ('staff', 'projects') then
      raise exception 'Staff and projects are added in SLATE OS (Business › HR & salaries, or the project in Studio and its fee in Business › Fees)';
    end if;
    return new;
  end if;
  if old.coll in ('staff', 'projects') and old.data->>'src' = 'os' then
    if tg_op = 'DELETE' then raise exception 'This comes from SLATE OS. Change or remove it there'; end if;
    for k in select jsonb_object_keys(old.data) union select jsonb_object_keys(new.data) loop
      if (old.data->k) is distinct from (new.data->k)
         and not (old.coll = 'projects' and k in ('client', 'overhead', 'jvPartner', 'jvShare', 'notes', 'earned')) then
        raise exception 'This comes from SLATE OS. Change it there (Business › HR & salaries, or Studio and Business › Fees)';
      end if;
    end loop;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists books_os_lock on public.books_docs;
create trigger books_os_lock before insert or update or delete on public.books_docs
  for each row execute function private.books_os_lock();

revoke all on function private.books_put_os(text, jsonb, text[]), private.books_find(text, text, text, text, text),
  private.books_sync_staff(text, jsonb), private.books_sync_project(text, jsonb),
  private.books_from_fin(), private.books_from_project(), private.books_os_lock() from public, anon, authenticated;

-- ---------- bring across what Business holds today ----------
do $sync$
declare f record;
begin
  for f in select doc_id, data from public.fin_docs where coll = 'staff' loop perform private.books_sync_staff(f.doc_id, f.data); end loop;
  for f in select doc_id, data from public.fin_docs where coll = 'projects' loop perform private.books_sync_project(f.doc_id, f.data); end loop;
end $sync$;

commit;
