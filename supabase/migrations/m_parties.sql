-- One party list with IDs (Principal, 3 Nov 2026).
-- Every client, consultant, supplier and other party SLATE deals with gets a Party ID (PTY-0001, PTY-0002 …) that never changes.
--  * Kept in docs › clients (Business › Clients). The ID is given by the database; nobody types or changes it.
--  * name   = the short name SLATE OS shows (projects, proposals, lists). Renaming a party renames it on every linked project.
--  * legal  = the formal name billed in Books (invoices). Changing it changes the client name on the party's Books projects.
--  * roles  = client, consultant, supplier, viz, referral, service, jv, related (lender / related party).
--  * ledgers = the party's own Books accounts (payable, loan). Linked by the Principal or the COO only.
-- Projects and proposals carry clientId = the Party ID. It is found from the client name (or one of the party's other names)
-- whenever the client name changes; a project whose client isn't in the list yet adds it. Books projects carry partyId.
-- Books gets a read-only copy of the list (books_docs › parties) for client statements and grouping.
-- Payee-only parties (not clients) are seen only by the Principal, the COO and Books.
-- Also fixes: saving a client was refused by the docs guard ("Not allowed"), so the client list had never been saved.
-- Note: the app saves through doc_write, which inserts with an empty coll that docs_derive fills in later, so the BEFORE
-- triggers here match on the path, not on coll.
-- Runs as one transaction.

begin;

create sequence if not exists private.party_seq;

create or replace function private.cnorm(t text) returns text
language sql immutable set search_path to '' as $$
  select regexp_replace(regexp_replace(lower(trim(coalesce(t, ''))), '\s+', ' ', 'g'), '[.,]', '', 'g')
$$;

-- the party a client name belongs to (its name or one of its other names); deleted parties are skipped
create or replace function private.client_find(p_name text) returns text
language sql stable security definer set search_path to '' as $$
  select c.data->>'pid' from public.docs c
  where c.coll = 'clients' and coalesce(c.data->>'pid', '') <> '' and not coalesce((c.data->>'deleted')::boolean, false)
    and private.cnorm(p_name) <> ''
    and (private.cnorm(c.data->>'name') = private.cnorm(p_name)
         or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(c.data->'aka') = 'array' then c.data->'aka' else '[]'::jsonb end) a
                    where private.cnorm(a) = private.cnorm(p_name)))
  order by (private.cnorm(c.data->>'name') = private.cnorm(p_name)) desc, c.data->>'pid'
  limit 1
$$;

-- 1. the Party ID: given once, never changed; roles default to client; Books links are the Principal's or the COO's
create or replace function private.client_party() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'UPDATE' and coalesce(old.data->>'pid', '') <> '' then
    new.data := jsonb_set(new.data, '{pid}', old.data->'pid');
  elsif coalesce(new.data->>'pid', '') = '' then
    new.data := new.data || jsonb_build_object('pid', 'PTY-' || lpad(nextval('private.party_seq')::text, 4, '0'));
  end if;
  if jsonb_typeof(new.data->'roles') is distinct from 'array' or jsonb_array_length(new.data->'roles') = 0 then
    new.data := new.data || '{"roles":["client"]}'::jsonb;
  end if;
  if auth.uid() is not null and not private.is_top()
     and (new.data->'ledgers') is distinct from (case when tg_op = 'UPDATE' then old.data->'ledgers' end) then
    raise exception 'Only the Principal or the COO links a party to Books accounts';
  end if;
  return new;
end $$;

drop trigger if exists a01_client_party on public.docs;
create trigger a01_client_party before insert or update on public.docs
  for each row when (new.path ~ '^clients/[^/]+$') execute function private.client_party();

-- 2. projects and proposals: the Party ID follows the client name; a picked Party ID sets the name
create or replace function private.client_link() returns trigger
language plpgsql security definer set search_path to '' as $$
declare c text := coalesce(new.data->>'client', ''); pid text := coalesce(new.data->>'clientId', ''); nm text; nid text;
begin
  if trim(c) = '' and pid = '' then return new; end if;
  -- a party picked by ID (new, or changed): its name is the client name
  if pid <> '' and (tg_op = 'INSERT' or pid is distinct from coalesce(old.data->>'clientId', '')) then
    select x.data->>'name' into nm from public.docs x where x.coll = 'clients' and x.data->>'pid' = pid;
    if nm is not null then new.data := jsonb_set(new.data, '{client}', to_jsonb(nm)); return new; end if;
  end if;
  if trim(c) = '' then new.data := new.data - 'clientId'; return new; end if;
  -- the client name didn't change: keep the link
  if tg_op = 'UPDATE' and pid <> '' and private.cnorm(old.data->>'client') = private.cnorm(c) then return new; end if;
  pid := private.client_find(c);
  if pid is null then
    if new.path like 'projects/%' or current_setting('slate.client_noauto', true) is distinct from '1' then
      nid := 'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 19);
      perform set_config('slate.client_auto', '1', true);
      insert into public.docs (path, coll, doc_id, data)
      values ('clients/' || nid, 'clients', nid, jsonb_strip_nulls(jsonb_build_object(
        'name', upper(trim(c)), 'roles', '["client"]'::jsonb, 'auto', true,
        'contact', nullif(new.data->>'contact', ''), 'phone', nullif(new.data->>'phone', ''), 'email', nullif(new.data->>'email', ''),
        'type', nullif(new.data->>'type', ''), 'createdAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'createdBy', auth.uid())));
      perform set_config('slate.client_auto', '', true);
      pid := private.client_find(c);
    end if;
  end if;
  if pid is null then new.data := new.data - 'clientId'; else new.data := new.data || jsonb_build_object('clientId', pid); end if;
  return new;
end $$;

drop trigger if exists a02_client_link on public.docs;
create trigger a02_client_link before insert or update on public.docs
  for each row when (new.path ~ '^(projects|proposals)/[^/]+$') execute function private.client_link();

-- 3. after a party changes: its name on projects and proposals, its formal name on Books projects, the Books copy, account links
create or replace function private.client_after() returns trigger
language plpgsql security definer set search_path to '' as $$
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
  -- the party's own Books accounts point back at it
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
    'tin', nullif(new.data->>'tin', ''), 'aka', new.data->'aka', 'deleted', case when coalesce((new.data->>'deleted')::boolean, false) then true end)))
  on conflict (path) do update set data = excluded.data;
  perform set_config('slate.books_sync', '', true);
  return null;
end $$;

drop trigger if exists j_client_after on public.docs;
create trigger j_client_after after insert or update on public.docs
  for each row when (new.coll = 'clients') execute function private.client_after();

-- 4. a project's party reaches its Books project
create or replace function private.client_to_books() returns trigger
language plpgsql security definer set search_path to '' as $$
declare lg text;
begin
  if tg_op = 'UPDATE' and (new.data->'clientId') is not distinct from (old.data->'clientId') then return null; end if;
  select nullif(trim(coalesce(c.data->>'legal', '')), '') into lg from public.docs c where c.coll = 'clients' and c.data->>'pid' = new.data->>'clientId';
  perform set_config('slate.books_sync', '1', true);
  update public.books_docs
  set data = case when new.data ? 'clientId' then data || jsonb_build_object('partyId', new.data->>'clientId') else data - 'partyId' end
             || case when lg is not null then jsonb_build_object('client', lg) else '{}'::jsonb end
  where coll = 'projects' and data->>'osId' = new.doc_id;
  perform set_config('slate.books_sync', '', true);
  return null;
end $$;

drop trigger if exists k_client_to_books on public.docs;
create trigger k_client_to_books after insert or update on public.docs
  for each row when (new.coll = 'projects') execute function private.client_to_books();

-- 5. Books keeps the project's party when SLATE OS fees re-sync the Books project
do $$
declare src text; a text := 'array[''client'', ''overhead'', ''jvPartner'', ''jvShare'', ''notes'', ''earned'']';
begin
  select pg_get_functiondef('private.books_sync_project(text, jsonb)'::regprocedure) into src;
  if position('partyId' in src) = 0 then
    if position(a in src) = 0 then raise exception 'books_sync_project changed; update m_parties.sql'; end if;
    execute replace(src, a, 'array[''client'', ''overhead'', ''jvPartner'', ''jvShare'', ''notes'', ''earned'', ''partyId'']');
  end if;
end $$;

-- 6. the party list in Books is a copy: changed only from Business › Clients
create or replace function private.books_parties_lock() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(new.coll, old.coll) <> 'parties' then return coalesce(new, old); end if;
  if auth.uid() is null or current_setting('slate.books_sync', true) = '1' then return coalesce(new, old); end if;
  raise exception 'Parties are kept in Business › Clients';
end $$;
drop trigger if exists books_parties_lock on public.books_docs;
create trigger books_parties_lock before insert or update or delete on public.books_docs
  for each row execute function private.books_parties_lock();

-- 7. docs › clients is a known collection (it was missing, so every client save failed with "Unknown collection clients")
do $$
declare src text; a text := '''data'',''agreements'',''proposals'')';
begin
  select pg_get_functiondef('private.docs_derive()'::regprocedure) into src;
  if position('''clients''' in src) = 0 then
    if position(a in src) = 0 then raise exception 'docs_derive changed; update m_parties.sql'; end if;
    execute replace(src, a, '''data'',''agreements'',''proposals'',''clients'')');
  end if;
end $$;

-- 7b. the docs guard: who saves a party (it refused every client save before)
do $$
declare src text; a text := '  raise exception ''Not allowed'';
end';
begin
  select pg_get_functiondef('private.docs_guard()'::regprocedure) into src;
  if position('slate.client_auto' in src) = 0 then
    if position(a in src) = 0 then raise exception 'docs_guard changed; update m_parties.sql'; end if;
    execute replace(src, a, '  -- parties (Business › Clients): the Principal and the COO; a new project''s client is added for whoever sends the project
  if rw.coll = ''clients'' then
    if private.is_top() then return new; end if;
    if tg_op = ''INSERT'' and current_setting(''slate.client_auto'', true) = ''1'' then return new; end if;
    raise exception ''Only the Principal or the COO changes the client list'';
  end if;
' || a);
  end if;
end $$;

-- 8. who sees a party: clients like any project detail; payee-only parties the Principal, the COO and Books
do $$
declare q text;
begin
  select pg_get_expr(polqual, polrelid) into q from pg_policy where polrelid = 'public.docs'::regclass and polname = 'docs_select';
  if position('''clients''' in q) = 0 then
    q := regexp_replace(q, 'ELSE true\s*END\s*$',
      'WHEN ''clients''::text THEN (coalesce((data -> ''roles''::text) ? ''client''::text, true) OR ( SELECT private.is_top() AS is_top) OR ( SELECT private.books_admin() AS books_admin)) ELSE true END');
    if position('''clients''' in q) = 0 then raise exception 'docs_select changed; update m_parties.sql'; end if;
    execute 'alter policy docs_select on public.docs using (' || q || ')';
  end if;
end $$;

-- 9. the list as it stands: clients in the order of their first project, proposal-only clients, then payees
create temp table seed (n int, name text, legal text, aka text[], roles text[], ledgers text[], contact text, phone text, note text) on commit drop;
insert into seed values
 ( 1, 'RAFTA', 'RAFTA REAL ESTATE', '{RAFTA REAL ESTATE}', '{client}', null, null, null, null),
 ( 2, 'CSRM', 'CSRM REAL ESTATE', '{CSRM REAL ESTATE}', '{client}', null, null, null, null),
 ( 3, 'ACE', 'ACE', null, '{client}', null, null, null, null),
 ( 4, 'BHAIYA HOUSING LTD', 'BHAIYA HOUSING LTD.', null, '{client}', null, null, null, null),
 ( 5, 'DESHI GROUP', 'DESHI GROUP', null, '{client}', null, null, null, null),
 ( 6, 'DR MOHAMMED HOSSAIN', 'DR. MOHAMMAD HOSSAIN', '{DR. MOHAMMAD HOSSAIN}', '{client}', null, null, null, 'Spelling differs between Studio (Mohammed) and Books (Mohammad): confirm.'),
 ( 7, 'EDISON REAL ESTATE', 'EDISON REAL ESTATE LTD. (EREL)', '{EDISON REAL ESTATE LTD. (EREL),EDISON REAL ESTATE LIMITED,EREL}', '{client,related}', '{l006}', null, null, null),
 ( 8, 'FORTRESS', 'FORTRESS REAL ESTATE', '{FORTRESS REAL ESTATE}', '{client}', null, null, null, null),
 ( 9, 'NEST', 'EDISON REAL ESTATE LTD. (EREL)', null, '{client}', null, null, null, 'Nest Cassandra is billed to Edison Real Estate in Books: confirm whether NEST is its own client or part of Edison.'),
 (10, 'MRS SAYMA AKTER PINKY', 'SAYMA AKTER PINKY', '{SAYMA AKTER PINKY}', '{client}', null, null, null, null),
 (11, 'HABIKON HEIGHTS', 'HABIKON HEIGHTS', null, '{client}', null, null, null, null),
 (12, 'REZAUL KARIM', 'REZAUL KARIM', null, '{client}', null, null, null, null),
 (13, 'NAVANA', 'NAVANA REAL ESTATE', '{NAVANA REAL ESTATE}', '{client}', null, null, null, null),
 (14, 'RAY WHITE', 'RAY WHITE', '{RAYWHITE}', '{client}', null, null, null, null),
 (15, 'ASSETIUM', 'ASSETIUM', null, '{client}', null, null, null, null),
 (16, 'UNICORN', 'UNICORN PROPERTIES LTD.', '{UNICORN PROPERTIES LTD.}', '{client}', null, null, null, null),
 (17, 'MR MOHAMMED ATIQUR RAHMAN REPON', 'MOHAMMAD ATIQUR REPON', '{MOHAMMAD ATIQUR REPON}', '{client}', null, null, null, 'Spelling differs between Studio and Books: confirm the formal name.'),
 (18, 'INTERSPACE', 'INTERSPACE', null, '{client}', null, null, null, null),
 (19, 'ZAKIR HOSSAIN', 'ZAKIR HOSSAIN', null, '{client}', null, null, null, null),
 (20, 'MR HAIDER', 'MR HAIDER', null, '{client}', null, null, null, null),
 (21, 'MR. RAIHAN', 'MR. RAIHAN', null, '{client}', null, null, null, null),
 (22, 'MAINUL HUDA', 'MAINUL HUDA', null, '{client}', null, null, null, null),
 (23, 'MR REZA', 'MR REZA', null, '{client}', null, null, null, null),
 (24, 'MR ZAHID', 'MR ZAHID', null, '{client}', null, null, null, null),
 (25, 'MR NAYEEM', 'MR NAYEEM', null, '{client}', null, null, null, null),
 (26, 'MD. MIRAZ HOSSAIN', 'MD. MIRAZ HOSSAIN', null, '{client}', null, null, null, null),
 (27, 'DR. SHAIKH MD. REZWAN', 'DR. SHAIKH MD. REZWAN', null, '{client}', null, null, null, null),
 (28, 'D.ZIGNSCAPE', 'Dzignscape Professionals Ltd', '{DZIGNSCAPE PROFESSIONALS LTD,DZIGNSCAPE}', '{client,consultant}', '{l044}', null, null, 'Client on Handyman Jolshiri and SLATE''s consultant: one party. Split if they are different companies.'),
 (29, 'IREEN AKHTER', 'IREEN AKHTER', null, '{client}', null, null, null, null),
 (30, 'EDISON PROPERTIES LTD', 'EDISON PROPERTIES LTD', '{EDISON PROPERTIES LYD}', '{client}', null, 'M NURUZZAMAN', '+8801755626969', 'Typed as "LYD" on the project; corrected to LTD.'),
 (31, 'MR TAIABUR', 'MR TAIABUR', null, '{client}', null, 'MR TAIABUR', null, null),
 -- proposals only
 (32, 'WESTERNBREEZE', null, null, '{client}', null, 'Mr. Rumy', '+8801805444300', null),
 (33, 'MR. ABDUS SALAM', null, null, '{client}', null, 'Mr. Ashir', '+8801601333200', null),
 (34, 'MR. NAZMUL ALAM', null, null, '{client}', null, 'Self', '+8801911819091', null),
 (35, 'MR. NAYEM', null, null, '{client}', null, 'Self', '+8801617552638', 'Possibly the same person as MR NAYEEM (Desdemona): merge if so.'),
 (36, 'MR. SHUVOJIT', null, null, '{client}', null, 'Self', '01799983835', null),
 (37, 'MR. MOMINUL HAQUE', null, null, '{client}', null, 'Self', '01894925476', null),
 (38, 'IMRUL HASAN', null, null, '{client}', null, 'Self', '+96892136652', null),
 (39, 'SOUTH HEAVEN', null, null, '{client}', null, 'Mr. Ehsan', '01989359890', null),
 (40, 'TRU PROPERTIES', null, null, '{client}', null, 'Mr. Tarif', '+8801321127499', null),
 (41, 'UNION DEVELOPMENT', null, null, '{client}', null, 'Mr. Saddam Hossain', '+8801819557350', null);

-- payees: every supplier, consultant and other payable account in Books (Dzignscape is above)
insert into seed
select 41 + row_number() over (order by l.doc_id), upper(l.data->>'name'), l.data->>'name', null,
       array[case l.data->>'vk' when 'staff' then 'service' else coalesce(nullif(l.data->>'vk', ''), 'supplier') end],
       array[l.doc_id], null, null, null
from public.books_docs l
where l.coll = 'ledgers' and l.data->>'group' = 'pay' and l.doc_id <> 'l044';

select setval('private.party_seq', 1, false);
insert into public.docs (path, coll, doc_id, data)
select 'clients/' || pid, 'clients', pid, jsonb_strip_nulls(jsonb_build_object(
  'pid', pid, 'name', s.name, 'legal', s.legal, 'aka', to_jsonb(s.aka), 'roles', to_jsonb(s.roles), 'ledgers', to_jsonb(s.ledgers),
  'contact', s.contact, 'phone', s.phone, 'note', s.note,
  'type', (select p.data->>'type' from public.docs p where p.coll = 'projects' and private.cnorm(p.data->>'client') in
            (select private.cnorm(x) from unnest(array[s.name] || coalesce(s.aka, '{}')) x) order by p.data->>'codeNo' limit 1),
  'createdAt', '2026-11-03T17:30:00.000Z'))
from (select s.*, 'PTY-' || lpad(s.n::text, 4, '0') pid from seed s) s
order by s.n;
select setval('private.party_seq', (select max(n) from seed));

-- link every project and proposal (proposals for test entries are left unlinked)
select set_config('slate.client_noauto', '1', true);
update public.docs set data = data - 'clientId' where coll in ('projects', 'proposals');
update public.docs set data = data || jsonb_build_object('clientId', private.client_find(data->>'client'))
where coll in ('projects', 'proposals') and private.client_find(data->>'client') is not null;
select set_config('slate.client_noauto', '', true);
-- the party's own name on every linked project and proposal (e.g. RAYWHITE becomes RAY WHITE)
update public.docs p set data = jsonb_set(p.data, '{client}', to_jsonb(c.data->>'name'))
from public.docs c
where p.coll in ('projects', 'proposals') and c.coll = 'clients' and c.data->>'pid' = p.data->>'clientId' and p.data->>'client' is distinct from c.data->>'name';

-- Books projects: the party, and its formal name (Books' own name kept where the party has none)
select set_config('slate.books_sync', '1', true);
update public.books_docs b set data = b.data || jsonb_build_object('partyId', p.data->>'clientId')
from public.docs p
where b.coll = 'projects' and p.coll = 'projects' and p.doc_id = b.data->>'osId' and coalesce(p.data->>'clientId', '') <> '';
select set_config('slate.books_sync', '', true);

commit;
