-- SLATE Books (31 Oct 2026): the accounts space of SLATE OS, structure only (no financial data).
-- One table for every Books record (ledgers, vouchers, invoices, requests, payroll, assets, files, settings …),
-- each row a document: path = '<collection path>/<id>', coll = the collection path, data = the record.
-- Who sees what:
--   Principal (designation principal) ............ everything; settings, roles, closing the books
--   COO (designation coo) ......................... everything except settings and roles
--   Accountant (given the role in Books) .......... enters and pays; sees the books
--   Viewer (given the role in Books) .............. reads the books, changes nothing
--   Office staff (given the role in Books) ........ petty cash and their own requests only
--   anyone else ................................... nothing (they may only say they visited, so the Principal can give a role)
-- Entries dated on or before the closing date (settings.lockDate) can be changed only by the Principal.
-- Every change is written to books_audit. Files go to the private storage bucket 'books'.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

create table if not exists public.books_docs (
  path       text primary key,
  coll       text not null,
  doc_id     text not null,
  data       jsonb not null default '{}'::jsonb,
  company    text not null default 'slate' check (company in ('slate','chalk','cobuilt')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists books_docs_coll on public.books_docs (coll);

create table if not exists public.books_audit (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  actor  uuid,
  path   text not null,
  op     text not null,
  before jsonb,
  after  jsonb
);

-- the caller's Books role: Principal and COO by designation, everyone else from the Principal's team list in Books
create or replace function private.books_role() returns text
language sql stable security definer set search_path to '' as $$
  select case
    when not private.is_active() then null
    when private.is_owner() then 'Principal'
    when private.is_coo() then coalesce(nullif((select s.data->'team'->(auth.uid()::text)->>'role' from public.books_docs s where s.path = 'settings/main'), ''), 'COO')
    else (select case when x.r in ('COO','Accountant','Office staff','Viewer') then x.r end
            from (select s.data->'team'->(auth.uid()::text)->>'role' r from public.books_docs s where s.path = 'settings/main') x)
  end
$$;
create or replace function private.books_admin() returns boolean
language sql stable security definer set search_path to '' as $$ select private.books_role() in ('Principal','COO','Accountant','Viewer') $$;
create or replace function private.books_writer() returns boolean
language sql stable security definer set search_path to '' as $$ select private.books_role() in ('Principal','COO','Accountant') $$;
-- the caller's own corner: their requests and their "I was here" note
create or replace function private.books_own(p_path text) returns boolean
language sql stable security definer set search_path to '' as $$
  select auth.uid() is not null and (p_path like 'requests/' || auth.uid()::text || '/items/%' or p_path = 'members/' || auth.uid()::text)
$$;
create or replace function public.books_role() returns text
language sql stable security definer set search_path to '' as $$ select private.books_role() $$;
revoke all on function private.books_role(), private.books_admin(), private.books_writer(), private.books_own(text) from public, anon;
revoke all on function public.books_role() from public, anon;
grant execute on function public.books_role() to authenticated;

alter table public.books_docs enable row level security;
alter table public.books_audit enable row level security;

drop policy if exists books_read on public.books_docs;
create policy books_read on public.books_docs for select to authenticated using (
  (select private.books_admin())
  or (coll in ('settings','catalog','reqdec') and (select private.books_role()) = 'Office staff')
  or private.books_own(path));

drop policy if exists books_insert on public.books_docs;
create policy books_insert on public.books_docs for insert to authenticated with check (
  ((select private.books_writer()) and coll <> 'settings' and coll <> 'members')
  or ((select private.books_role()) = 'Principal')
  or (private.books_own(path) and private.is_active()));

drop policy if exists books_update on public.books_docs;
create policy books_update on public.books_docs for update to authenticated
  using (((select private.books_writer()) and coll <> 'members') or ((select private.books_role()) = 'Principal') or private.books_own(path))
  with check (((select private.books_writer()) and coll <> 'members') or ((select private.books_role()) = 'Principal') or private.books_own(path));

drop policy if exists books_delete on public.books_docs;
create policy books_delete on public.books_docs for delete to authenticated using (
  ((select private.books_writer()) and coll not in ('settings','members')) or private.books_own(path));

drop policy if exists books_audit_read on public.books_audit;
create policy books_audit_read on public.books_audit for select to authenticated using ((select private.books_role()) in ('Principal','COO'));

-- the guard: stamps, settings and roles for the Principal alone (the COO may change the approval rules' working
-- fields only through the Principal), closed months, and the audit trail
create or replace function private.books_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
declare r text := private.books_role(); lock text; d_old text; d_new text;
begin
  if auth.uid() is null then  -- the database itself (migrations, maintenance)
    if tg_op <> 'DELETE' then new.updated_at := now(); end if;
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now();
  end if;
  if tg_op <> 'DELETE' then
    new.updated_by := auth.uid(); new.updated_at := now();
    new.coll := regexp_replace(new.path, '/[^/]+$', '');
    new.doc_id := regexp_replace(new.path, '^.*/', '');
  end if;
  -- the settings: roles, the closing date and the approval limits are the Principal's
  if coalesce(new.path, old.path) = 'settings/main' and r is distinct from 'Principal' then
    if tg_op = 'DELETE' then raise exception 'Only the Principal changes Books settings'; end if;
    if tg_op = 'INSERT' or (new.data->'team') is distinct from (old.data->'team')
       or (new.data->'lockDate') is distinct from (old.data->'lockDate')
       or (new.data->'approval') is distinct from (old.data->'approval')
       or (new.data->'fyRule') is distinct from (old.data->'fyRule')
       or (new.data->'ownerId') is distinct from (old.data->'ownerId') then
      raise exception 'Only the Principal changes roles, approval limits, the financial year or the closing date';
    end if;
  end if;
  -- closed months: entries dated on or before the closing date stay as they are, except for the Principal
  if coalesce(new.coll, old.coll) in ('vouchers','invoices','payroll','cashcounts','recon') and r is distinct from 'Principal' then
    select s.data->>'lockDate' into lock from public.books_docs s where s.path = 'settings/main';
    if coalesce(lock, '') <> '' then
      d_old := case when tg_op = 'INSERT' then null else coalesce(old.data->>'date', old.data->>'month') end;
      d_new := case when tg_op = 'DELETE' then null else coalesce(new.data->>'date', new.data->>'month') end;
      if (d_old is not null and d_old <= lock) or (d_new is not null and d_new <= lock) then
        raise exception 'The books are closed up to %. Only the Principal changes entries in a closed month', lock;
      end if;
    end if;
  end if;
  insert into public.books_audit (actor, path, op, before, after)
  values (auth.uid(), coalesce(new.path, old.path), lower(tg_op),
          case when tg_op = 'INSERT' then null else old.data end,
          case when tg_op = 'DELETE' then null else new.data end);
  return coalesce(new, old);
end $$;
revoke all on function private.books_guard() from public, anon, authenticated;

drop trigger if exists books_guard on public.books_docs;
create trigger books_guard before insert or update or delete on public.books_docs
  for each row execute function private.books_guard();

grant select, insert, update, delete on public.books_docs to authenticated;
grant select on public.books_audit to authenticated;

-- live updates for open Books screens (row security applies)
do $rt$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'books_docs') then
    alter publication supabase_realtime add table public.books_docs;
  end if;
end $rt$;

-- files: bills, receipts, statements, agreements. Private; the books' people see all, office staff their own uploads
insert into storage.buckets (id, name, public, file_size_limit)
values ('books', 'books', false, 26214400)
on conflict (id) do nothing;

drop policy if exists books_files_read on storage.objects;
create policy books_files_read on storage.objects for select to authenticated using (
  bucket_id = 'books' and ((select private.books_admin()) or owner = auth.uid()));
drop policy if exists books_files_write on storage.objects;
create policy books_files_write on storage.objects for insert to authenticated with check (
  bucket_id = 'books' and ((select private.books_writer()) or (select private.books_role()) = 'Office staff'));
drop policy if exists books_files_delete on storage.objects;
create policy books_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'books' and ((select private.books_role()) in ('Principal','COO') or owner = auth.uid()));

-- the Books settings start with the SLATE defaults; the Principal changes them in Books › More › Settings
insert into public.books_docs (path, coll, doc_id, data)
values ('settings/main', 'settings', 'main', jsonb_build_object(
  'company', 'SLATE', 'address', 'House SW (I) 3/A, Road 2, Gulshan 1, Dhaka 1212', 'phone', '+880 1749-390284',
  'email', 'info@slate-atelier.com', 'fyRule', 'bd', 'fyStart', 7, 'team', '{}'::jsonb))
on conflict (path) do nothing;

commit;
