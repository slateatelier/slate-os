-- SLATE OS · COO feedback 03, release 3 (16 Nov 2026). Run once in the Supabase SQL editor (after m_coo_feedback_03.sql).
-- 1. Client contacts reach Books: the Books copy of each party (books_docs parties/<PTY-id>) now also carries the client's other
--    contacts, billing address and how invoices go (hard copy / WhatsApp / email, and to whom), so a Books invoice shows them,
--    prints the billing address under Bill to, and opens WhatsApp to the right number. Same function as before plus four fields.

create or replace function private.client_after()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare pid text := new.data->>'pid'; nm text := new.data->>'name'; lg text := nullif(trim(coalesce(new.data->>'legal', '')), '');
  l text; o jsonb := case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end;
begin
  if coalesce(pid, '') = '' then return null; end if;
  if tg_op = 'UPDATE' and nm is distinct from (o->>'name') and not coalesce((new.data->>'deleted')::boolean, false) then
    update public.docs set data = jsonb_set(data, '{client}', to_jsonb(nm))
    where coll in ('projects', 'proposals') and data->>'clientId' = pid and data->>'client' is distinct from nm;
  end if;
  perform set_config('slate.books_sync', '1', true);
  if lg is not null and (tg_op = 'INSERT' or lg is distinct from (o->>'legal')) then
    update public.books_docs set data = jsonb_set(data, '{client}', to_jsonb(lg))
    where coll = 'projects' and data->>'partyId' = pid and data->>'client' is distinct from lg;
  end if;
  if (new.data->'ledgers') is distinct from (o->'ledgers') then
    update public.books_docs set data = data - 'party'
    where coll = 'ledgers' and data->>'party' = pid
      and not (case when jsonb_typeof(new.data->'ledgers') = 'array' then new.data->'ledgers' else '[]'::jsonb end) ? doc_id;
    for l in select jsonb_array_elements_text(case when jsonb_typeof(new.data->'ledgers') = 'array' then new.data->'ledgers' else '[]'::jsonb end) loop
      update public.books_docs set data = data || jsonb_build_object('party', pid)
      where coll = 'ledgers' and doc_id = l and data->>'party' is distinct from pid;
    end loop;
  end if;
  insert into public.books_docs (path, coll, doc_id, data)
  values ('parties/' || pid, 'parties', pid, jsonb_strip_nulls(jsonb_build_object(
    'pid', pid, 'name', nm, 'legal', lg, 'roles', new.data->'roles', 'ledgers', new.data->'ledgers',
    'contact', nullif(new.data->>'contact', ''), 'title', nullif(new.data->>'title', ''), 'phone', nullif(new.data->>'phone', ''),
    'email', nullif(new.data->>'email', ''), 'address', nullif(new.data->>'address', ''), 'bin', nullif(new.data->>'bin', ''),
    'tin', nullif(new.data->>'tin', ''), 'aka', new.data->'aka',
    'billAddr', nullif(new.data->>'billAddr', ''),
    'contacts', case when jsonb_typeof(new.data->'contacts') = 'array' and jsonb_array_length(new.data->'contacts') > 0 then new.data->'contacts' end,
    'deliver', case when jsonb_typeof(new.data->'deliver') = 'array' and jsonb_array_length(new.data->'deliver') > 0 then new.data->'deliver' end,
    'sendTo', nullif(new.data->>'sendTo', ''),
    'deleted', case when coalesce((new.data->>'deleted')::boolean, false) then true end)))
  on conflict (path) do update set data = excluded.data;
  perform set_config('slate.books_sync', '', true);
  return null;
end $function$;

-- 2. Office records (Books › Documents › Office records) and TMRFs (Business › HR): employee documents, IDs, SOP, NOA, agreements, rent and utility
--    receipts, licences; team member requisitions. Kept in books_docs "office" and "tmrf", which only the Principal and the COO can read or change (as HR files).
alter policy books_hr_only_top on public.books_docs
  using ((coll <> all (array['hrfiles', 'letters', 'office', 'tmrf'])) or private.is_owner() or private.is_coo())
  with check ((coll <> all (array['hrfiles', 'letters', 'office', 'tmrf'])) or private.is_owner() or private.is_coo());

-- 3. Tell the apps the rule above is in place: Office records and TMRF stay switched off until this flag is set,
--    so nothing private is saved while the Accountant could still read it.
update public.books_docs set data = data || '{"topColls":["hrfiles","letters","office","tmrf"]}'::jsonb where path = 'settings/main';
