-- Client and project names in capitals (Principal, 3 Nov 2026).
--  * Every client name and project name is kept in capitals, wherever it is saved: Studio and Business projects,
--    proposals and leads, the Clients list (name and other names), the Business fee copy, Books projects and the
--    name on a Books invoice. Typing in small letters is fine: the database stores capitals.
--  * Existing names are changed once (38 Books project clients, 10 proposal clients, "Head Office (overheads)").
--    Only letters change case; spelling, codes, fees and links stay as they are.
--  * Books' chart of accounts is not renamed; a Books invoice prints its client in capitals.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

create or replace function private.caps_names() returns trigger
language plpgsql security definer set search_path to '' as $$
declare d jsonb := new.data; k text;
begin
  if d is null or jsonb_typeof(d) <> 'object' then return new; end if;
  if new.coll in ('projects', 'proposals') then
    foreach k in array array['client', 'name'] loop
      if jsonb_typeof(d->k) = 'string' and d->>k <> upper(d->>k) then d := jsonb_set(d, array[k], to_jsonb(upper(d->>k))); end if;
    end loop;
  elsif new.coll = 'clients' then
    if jsonb_typeof(d->'name') = 'string' and d->>'name' <> upper(d->>'name') then d := jsonb_set(d, '{name}', to_jsonb(upper(d->>'name'))); end if;
    if jsonb_typeof(d->'aka') = 'array' then
      d := jsonb_set(d, '{aka}', coalesce((select jsonb_agg(case when jsonb_typeof(x) = 'string' then to_jsonb(upper(x #>> '{}')) else x end)
                                           from jsonb_array_elements(d->'aka') x), '[]'::jsonb));
    end if;
  elsif new.coll = 'invoices' then
    if jsonb_typeof(d->'clientName') = 'string' and d->>'clientName' <> upper(d->>'clientName') then d := jsonb_set(d, '{clientName}', to_jsonb(upper(d->>'clientName'))); end if;
  end if;
  new.data := d;
  return new;
end $$;
revoke all on function private.caps_names() from public, anon, authenticated;

-- runs first on each table, so every later check, code and Books copy sees the capitals
drop trigger if exists a00_caps_names on public.docs;
create trigger a00_caps_names before insert or update on public.docs
  for each row when (new.coll in ('projects', 'proposals', 'clients')) execute function private.caps_names();
drop trigger if exists a00_caps_names on public.fin_docs;
create trigger a00_caps_names before insert or update on public.fin_docs
  for each row when (new.coll = 'projects') execute function private.caps_names();
drop trigger if exists a00_caps_names on public.books_docs;
create trigger a00_caps_names before insert or update on public.books_docs
  for each row when (new.coll in ('projects', 'invoices')) execute function private.caps_names();

-- the names already saved (the triggers above do the change; Books' sync flag lets its OS-linked copies through)
select set_config('slate.books_sync', '1', true);
update public.docs set data = data where coll in ('projects', 'proposals', 'clients')
  and (data->>'client' <> upper(data->>'client') or data->>'name' <> upper(data->>'name') or (coll = 'clients' and data ? 'aka'));
update public.fin_docs set data = data where coll = 'projects'
  and (data->>'client' <> upper(data->>'client') or data->>'name' <> upper(data->>'name'));
update public.books_docs set data = data where coll in ('projects', 'invoices')
  and (data->>'client' <> upper(data->>'client') or data->>'name' <> upper(data->>'name') or data->>'clientName' <> upper(data->>'clientName'));
select set_config('slate.books_sync', '', true);

commit;

-- check: every row below should show 0
select 'docs' t, coll, count(*) filter (where data->>'client' <> upper(data->>'client') or data->>'name' <> upper(data->>'name')) not_caps
  from public.docs where coll in ('projects', 'proposals', 'clients') group by coll
union all
select 'fin_docs', coll, count(*) filter (where data->>'client' <> upper(data->>'client') or data->>'name' <> upper(data->>'name'))
  from public.fin_docs where coll = 'projects' group by coll
union all
select 'books_docs', coll, count(*) filter (where data->>'client' <> upper(data->>'client') or data->>'name' <> upper(data->>'name') or data->>'clientName' <> upper(data->>'clientName'))
  from public.books_docs where coll in ('projects', 'invoices') group by coll;
