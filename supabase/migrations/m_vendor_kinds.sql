-- Consultants, 3D vendors, suppliers and others in Books, as the Principal set them (31 Oct 2026). Data only.
--  * Each vendor account in Books gets its kind. New kinds: 3D visualisation, Staff paid through a firm, Referral incentive.
--  * Notes on Wedesign Studio (pays Shiful Islam Zisan's part-time salary), Shahrier Rashid Labib (site measurement and
--    documentation) and Sakib (referral incentive).
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

select set_config('slate.books_sync', '1', true);

update public.books_docs set data = data || '{"vk":"consultant"}'::jsonb
where coll = 'ledgers' and doc_id in ('l031','l042','l044','l045','l046','l076','l091','l102','l106');

update public.books_docs set data = data || '{"vk":"viz"}'::jsonb
where coll = 'ledgers' and doc_id in ('l028','l047','l096');

update public.books_docs set data = data || '{"vk":"supplier"}'::jsonb
where coll = 'ledgers' and doc_id in ('l030','l049','l052','l058','l062','l093','l107','l112','l123','l125');

update public.books_docs set data = data || '{"vk":"service","notes":"Site measurement and site documentation."}'::jsonb
where path = 'ledgers/l105';

update public.books_docs set data = data || '{"vk":"staff","notes":"Shiful Islam Zisan (Accounts) is a part-time employee; his salary is paid to Wedesign Studio."}'::jsonb
where path = 'ledgers/l084';

update public.books_docs set data = data || '{"vk":"referral","notes":"Referral incentive for bringing projects to SLATE."}'::jsonb
where path = 'ledgers/l132';

select set_config('slate.books_sync', '', true);

commit;
