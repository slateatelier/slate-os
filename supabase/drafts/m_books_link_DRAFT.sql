-- DRAFT, DO NOT RUN. Written before we found the real books in the SLATE Books artifact.
-- To be rewritten at the move: link staff by Employee ID and projects by project code; no starter or client accounts.

-- SLATE Books ← SLATE OS (31 Oct 2026). SLATE OS keeps the agreements; Books keeps the money.
-- 1. Staff: every person in Business › HR & salaries appears in Books › Staff (employee ID, name, designation,
--    joining date, salary history, tax, bank/cash). Books reads them; it cannot change them.
-- 2. Projects: every project with a fee in Business › Fees appears in Books › Projects (code, name, client, fee,
--    open or closed). Books may add only its own details: overhead, joint-venture partner and share, notes.
-- 3. Clients: one client account per client (receivables), made once; Books may rename it.
-- 4. A starter list of accounts, named as in SLATE's Tally books so the real figures merge into them later.
-- Changes in SLATE OS reach Books at once (database triggers). Nothing in SLATE OS is changed by this file.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

-- ---------- the copy of one Business record in Books ----------
create or replace function private.books_put_os(p_path text, p_data jsonb, p_keep text[]) returns void
language plpgsql security definer set search_path to '' as $$
declare cur jsonb; k text;
begin
  select data into cur from public.books_docs where path = p_path;
  if cur is not null and p_keep is not null then          -- Books' own details on the record stay as Books set them
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

-- ---------- staff ----------
create or replace function private.books_sync_staff(p_id text, d jsonb) returns void
language plpgsql security definer set search_path to '' as $$
declare r jsonb; m text := to_char((now() at time zone 'Asia/Dhaka')::date, 'YYYY-MM'); g numeric; num int; bank numeric;
begin
  if d is null then   -- removed from Business: kept in Books (it may be on past salary sheets), no longer active
    perform set_config('slate.books_sync', '1', true);
    update public.books_docs set data = data || '{"active":false,"osRemoved":true}' where path = 'staff/os_' || p_id;
    perform set_config('slate.books_sync', '', true);
    return;
  end if;
  select x.value into r from jsonb_array_elements(coalesce(d->'rates', '[]')) x where x.value->>'from' <= m order by x.value->>'from' desc limit 1;
  if r is null then select x.value into r from jsonb_array_elements(coalesce(d->'rates', '[]')) x order by x.value->>'from' limit 1; end if;
  g := coalesce((r->>'basic')::numeric, 0) + coalesce((r->>'house')::numeric, 0) + coalesce((r->>'medical')::numeric, 0)
     + coalesce((r->>'conv')::numeric, 0) + coalesce((r->>'other')::numeric, 0);
  bank := case d->>'payMethod' when 'bank' then g when 'split' then coalesce((d->>'bankPart')::numeric, 0) else 0 end;
  num := nullif(regexp_replace(coalesce(d->>'empId', ''), '\D', '', 'g'), '')::int;
  perform private.books_put_os('staff/os_' || p_id, jsonb_build_object(
    'src', 'os', 'osId', p_id, 'userId', coalesce(d->>'userId', ''),
    'empId', coalesce(d->>'empId', ''),
    'name', coalesce(nullif(d->>'holder', ''), d->>'name', ''),                  -- a shared account (Accounts) prints its holder
    'account', case when coalesce(d->>'holder', '') <> '' then d->>'name' else '' end,
    'designation', coalesce(d->>'designation', ''),
    'joined', coalesce(d->>'joinDate', ''), 'left', '',
    'gross', g, 'tax', coalesce((r->>'tax')::numeric, 0), 'bank', bank,
    'payMethod', coalesce(d->>'payMethod', 'cash'), 'bankPart', coalesce((d->>'bankPart')::numeric, 0),
    'rates', coalesce(d->'rates', '[]'),
    'remarks', case when coalesce(d->>'probationEnd', '') <> '' and d->>'probationEnd' >= to_char(now(), 'YYYY-MM-DD') then 'Probation to ' || (d->>'probationEnd') else coalesce(d->>'note', '') end,
    'active', coalesce((d->>'active')::boolean, true),
    'sl', coalesce(num % 1000, 999)), null);
end $$;

-- ---------- clients and projects ----------
create or replace function private.books_client_ledger(p_client text) returns text
language plpgsql security definer set search_path to '' as $$
declare id text; nm text := btrim(coalesce(p_client, ''));
begin
  if nm = '' then return ''; end if;
  -- an account already named for this client (made here, by hand or from Tally) is used as it is
  select doc_id into id from public.books_docs where coll = 'ledgers' and data->>'group' = 'recv' and lower(btrim(data->>'name')) = lower(nm) limit 1;
  if id is not null then return id; end if;
  id := 'cl_' || substr(md5(lower(nm)), 1, 10);
  if not exists (select 1 from public.books_docs where path = 'ledgers/' || id) then
    perform private.books_put_os('ledgers/' || id, jsonb_build_object('name', nm, 'group', 'recv', 'cat', null, 'opening', 0, 'active', true,
      'notes', 'Client account, made from SLATE OS', 'dev', '', 'vk', '', 'defProj', '', 'noJvShare', false, 'src', 'os-client'), null);
  end if;
  return id;
end $$;

create or replace function private.books_sync_project(p_id text, d jsonb) returns void
language plpgsql security definer set search_path to '' as $$
declare closed boolean; cl text;
begin
  if d is null or coalesce((d->>'fee')::numeric, 0) <= 0 then   -- no fee (or removed): kept if Books has it, marked as no longer from SLATE OS
    perform set_config('slate.books_sync', '1', true);
    update public.books_docs set data = data || '{"osRemoved":true}' where path = 'projects/os_' || p_id;
    perform set_config('slate.books_sync', '', true);
    return;
  end if;
  select coalesce((x.data->>'closed')::boolean, false) into closed from public.docs x where x.path = 'projects/' || (d->>'osId');
  cl := private.books_client_ledger(d->>'client');
  perform private.books_put_os('projects/os_' || p_id, jsonb_build_object(
    'src', 'os', 'osId', coalesce(d->>'osId', ''), 'finId', p_id,
    'code', coalesce(d->>'code', ''), 'name', coalesce(d->>'name', ''), 'client', coalesce(d->>'client', ''), 'clientLedger', cl,
    'contract', coalesce((d->>'fee')::numeric, 0),
    'status', case when coalesce(closed, false) then 'Closed' else 'Active' end,
    'overhead', false, 'jvPartner', '', 'jvShare', 0, 'notes', '', 'earned', 0, 'osRemoved', false),
    array['overhead', 'jvPartner', 'jvShare', 'notes', 'earned']);
end $$;

-- ---------- triggers: Business changes reach Books at once ----------
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
  if new.coll <> 'projects' or (old.data->'closed') is not distinct from (new.data->'closed') then return null; end if;
  for f in select doc_id, data from public.fin_docs where coll = 'projects' and data->>'osId' = new.doc_id loop
    perform private.books_sync_project(f.doc_id, f.data);
  end loop;
  return null;
end $$;
drop trigger if exists books_from_project on public.docs;
create trigger books_from_project after update on public.docs
  for each row when (new.coll = 'projects') execute function private.books_from_project();

-- ---------- Books cannot change what SLATE OS owns ----------
create or replace function private.books_os_lock() returns trigger
language plpgsql security definer set search_path to '' as $$
declare k text;
begin
  if current_setting('slate.books_sync', true) = '1' or auth.uid() is null then return coalesce(new, old); end if;
  if old.data->>'src' = 'os' then
    if tg_op = 'DELETE' then raise exception 'This comes from SLATE OS. Change or remove it there (Business › HR & salaries or Fees)'; end if;
    for k in select jsonb_object_keys(old.data) union select jsonb_object_keys(new.data) loop
      if (old.data->k) is distinct from (new.data->k)
         and not (old.coll = 'projects' and k in ('overhead', 'jvPartner', 'jvShare', 'notes', 'earned')) then
        raise exception 'This comes from SLATE OS. Change it there (Business › HR & salaries or Fees)';
      end if;
    end loop;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists books_os_lock on public.books_docs;
create trigger books_os_lock before update or delete on public.books_docs
  for each row execute function private.books_os_lock();

revoke all on function private.books_put_os(text, jsonb, text[]), private.books_sync_staff(text, jsonb), private.books_client_ledger(text),
  private.books_sync_project(text, jsonb), private.books_from_fin(), private.books_from_project(), private.books_os_lock() from public, anon, authenticated;

-- ---------- starter accounts (named as in SLATE's Tally books; nothing is replaced if it exists) ----------
insert into public.books_docs (path, coll, doc_id, data)
select 'ledgers/' || id, 'ledgers', id, jsonb_build_object('name', nm, 'group', grp, 'cat', cat, 'opening', 0, 'active', true,
  'notes', 'Starter account', 'dev', '', 'vk', '', 'defProj', '', 'noJvShare', false, 'src', 'starter')
from (values
  ('l_cash',     'Cash-Head',                         'cash',     null),
  ('l_petty',    'Petty Cash',                        'cash',     null),
  ('l_bank',     'Mercantile Bank',                   'bank',     null),
  ('l_cap',      'Capital Account: Principal',         'cap',      null),
  ('l_fee',      'Design Fees',                       'inc',      null),
  ('l_oinc',     'Other Income',                      'oinc',     null),
  ('l_cons',     'Consultants (Structural and MEP)',  'pc',       'proj'),
  ('l_print',    'Printing and Plotting',             'pc',       'proj'),
  ('l_sal',      'Salary & Allowances',               'staff',    'staff'),
  ('l_bonus',    'Festival Bonus',                    'staff',    'staff'),
  ('l_rent',     'Office Rent',                       'occ',      'rent'),
  ('l_util',     'Electricity, Water and Gas',        'occ',      'rent'),
  ('l_net',      'Internet and Phone',                'occ',      'rent'),
  ('l_upkeep',   'Office Upkeep and Cleaning',        'occ',      'rent'),
  ('l_supplies', 'Office Supplies',                   'adm',      'office'),
  ('l_travel',   'Transport and Site Visits',         'adm',      'office'),
  ('l_ent',      'Entertainment and Refreshments',    'adm',      'office'),
  ('l_soft',     'Software and IT',                   'adm',      'it'),
  ('l_legal',    'Licences, Fees and Legal',          'adm',      'lic'),
  ('l_mkt',      'Marketing',                         'adm',      'mkt'),
  ('l_bankchg',  'Bank Charges',                      'fin',      'bank'),
  ('l_salpay',   'Salary Payable',                    'accr',     null),
  ('l_wht',      'Withholding Tax',                   'stat',     null),
  ('l_tds',      'TDS Payable',                       'stat',     null),
  ('l_vat',      'VAT Payable',                       'stat',     null),
  ('l_ait',      'AIT deducted by clients',           'taxa',     null),
  ('l_vatd',     'VAT deducted by clients',           'taxa',     null),
  ('l_staffadv', 'Staff Advances',                    'staffadv', null),
  ('l_deposit',  'Office Rent Deposit',               'adv',      null),
  ('l_fa_it',    'Computers and Equipment',           'fa',       'equip'),
  ('l_fa_furn',  'Furniture and Fittings',            'fa',       'equip'),
  ('l_ad_it',    'Accumulated Depreciation: Computers and Equipment', 'accdep', null),
  ('l_ad_furn',  'Accumulated Depreciation: Furniture and Fittings',  'accdep', null),
  ('l_dep',      'Depreciation',                      'dep',      null)
) v(id, nm, grp, cat)
on conflict (path) do nothing;

-- the settings Books uses to post salaries, petty cash and depreciation (only where not set yet)
update public.books_docs set data = data
  || case when coalesce(data->>'salaryLedger', '') = '' then '{"salaryLedger":"l_sal"}'::jsonb else '{}' end
  || case when coalesce(data->>'salaryTax', '') = '' then '{"salaryTax":"l_wht"}'::jsonb else '{}' end
  || case when coalesce(data->>'tdsVendor', '') = '' then '{"tdsVendor":"l_tds"}'::jsonb else '{}' end
  || case when coalesce(data->>'pettyLedger', '') = '' then '{"pettyLedger":"l_petty"}'::jsonb else '{}' end
  || case when coalesce(data->>'defaultCash', '') = '' then '{"defaultCash":"l_cash"}'::jsonb else '{}' end
  || case when coalesce(data->>'depExpense', '') = '' then '{"depExpense":"l_dep"}'::jsonb else '{}' end
where path = 'settings/main';

-- ---------- bring across what Business holds today ----------
do $sync$
declare f record;
begin
  for f in select doc_id, data from public.fin_docs where coll = 'staff' loop perform private.books_sync_staff(f.doc_id, f.data); end loop;
  for f in select doc_id, data from public.fin_docs where coll = 'projects' loop perform private.books_sync_project(f.doc_id, f.data); end loop;
end $sync$;

commit;
