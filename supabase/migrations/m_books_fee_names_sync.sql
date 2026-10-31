-- Fee income account names follow SLATE OS (31 Oct 2026). Runs after m_books_fee_names.sql.
--  * When a project's code or name changes in SLATE OS, its fee income account in Books is renamed to match
--    ("PROJECT CODE · PROJECT NAME"), straight away. Accounts linked to a project are the ones m_books_fee_names.sql renamed.
--  * ACE OPAL's account keeps its ending "(fee share via Volumezero)".
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

-- the ending some accounts carry after the project's code and name
update public.books_docs set data = data || '{"nameSuffix":" (fee share via Volumezero)"}'::jsonb
where coll = 'ledgers' and data->>'project' = 'os_387e7c11dbafb06c2c1b' and not data ? 'nameSuffix';

create or replace function private.books_fee_names() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if (old.data->'code', old.data->'name') is not distinct from (new.data->'code', new.data->'name') then return null; end if;
  if coalesce(new.data->>'code', '') = '' or coalesce(new.data->>'name', '') = '' then return null; end if;
  perform set_config('slate.books_sync', '1', true);
  update public.books_docs l
  set data = l.data || jsonb_build_object('name', (new.data->>'code') || ' · ' || (new.data->>'name') || coalesce(l.data->>'nameSuffix', ''))
  where l.coll = 'ledgers' and l.data->>'project' = new.doc_id
    and l.data->>'name' is distinct from (new.data->>'code') || ' · ' || (new.data->>'name') || coalesce(l.data->>'nameSuffix', '');
  perform set_config('slate.books_sync', '', true);
  return null;
end $$;

drop trigger if exists books_fee_names on public.books_docs;
create trigger books_fee_names after update on public.books_docs
  for each row when (new.coll = 'projects') execute function private.books_fee_names();

commit;
