-- MARINER and SAKINA corrections (Principal, 3 Nov 2026). Data only; nothing about the structure changes.
--  * MARINER (SUN-MARI-5K-2628): Books' client changes from "Sunvalley" (the area, carried over from the Tally account
--    "Sunvalley P5R3AS1") to REZAUL KARIM, the client in Business. Money › Fees by client then lists him; invoices go to him.
--  * SAKINA (ASSETIUM): the site is United City, not Sunvalley. Location becomes UNITED CITY and the code follows it:
--    SUN-SAKI-5K-2633 becomes UNI-SAKI-5K-2633 (same number, like UNI-HAID-5K-2640). The Business fee copy and Books
--    follow. No voucher changes: vouchers point at the project by its id, not its code.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

-- MARINER: the client on Books' copy (Books keeps its own client name; the sync flag lets the change through)
select set_config('slate.books_sync', '1', true);
update public.books_docs set data = data || '{"client":"REZAUL KARIM"}'::jsonb
 where path = 'projects/os_marinerSun2628';
select set_config('slate.books_sync', '', true);

-- SAKINA: location and code (the code trigger normally keeps a code fixed)
alter table public.docs disable trigger a0_docs_project_code;
update public.docs set data = data || '{"location":"UNITED CITY","code":"UNI-SAKI-5K-2633"}'::jsonb
 where path = 'projects/L3WEW4ZX1iSZQA2PWGp3' and data->>'code' = 'SUN-SAKI-5K-2633';
alter table public.docs enable trigger a0_docs_project_code;

-- Business fee copy (Books' copy follows at once through its sync trigger)
update public.fin_docs
   set data = data || jsonb_build_object('code', 'UNI-SAKI-5K-2633')
             || case when data ? 'location' then '{"location":"UNITED CITY"}'::jsonb else '{}'::jsonb end,
       updated_at = now()
 where coll = 'projects' and data->>'osId' = 'L3WEW4ZX1iSZQA2PWGp3';

-- Books' saved category list still names the old code
select set_config('slate.books_sync', '1', true);
update public.books_docs set data = replace(data::text, 'SUN-SAKI-5K-2633', 'UNI-SAKI-5K-2633')::jsonb
 where path = 'catalog/main' and data::text like '%SUN-SAKI-5K-2633%';
select set_config('slate.books_sync', '', true);

commit;

-- check: MARINER shows REZAUL KARIM in Books; SAKINA shows UNI-SAKI-5K-2633 and UNITED CITY in all three
select 'docs' t, data->>'code' code, data->>'name' name, data->>'client' client, data->>'location' loc from public.docs where path in ('projects/usIkLhhOh13BOryLmnE2', 'projects/L3WEW4ZX1iSZQA2PWGp3')
union all select 'fin', data->>'code', data->>'name', data->>'client', data->>'location' from public.fin_docs where coll = 'projects' and data->>'osId' in ('usIkLhhOh13BOryLmnE2', 'L3WEW4ZX1iSZQA2PWGp3')
union all select 'books', data->>'code', data->>'name', data->>'client', '' from public.books_docs where path in ('projects/os_marinerSun2628', 'projects/os_6c3681fb60f3992efd4f');
