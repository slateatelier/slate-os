-- SLATE's cash and bank accounts in Books (31 Oct 2026). Data only; nothing about the structure changes.
--  * SLATE keeps cash in two places only: the SLATE vault and petty cash.
--  * "Cash-Head Office" (cash held at the EREL head office) and the City Bank account (EREL's) are marked not in use.
--    Their balance is Tk 0; their past entries stay as they are.
--  * "Cash-in-Vault(9th Floor)" becomes "Cash in SLATE vault".
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

select set_config('slate.books_sync', '1', true);

update public.books_docs set data = data || '{"active":false,"notes":"Cash held at the EREL head office. Not used by SLATE since 31 Oct 2026; balance Tk 0."}'::jsonb
where path = 'ledgers/l036';

update public.books_docs set data = data || '{"active":false,"notes":"EREL''s account (City Bank letter, Feb 2026). Not used by SLATE after 31 Mar 2026; balance Tk 0."}'::jsonb
where path = 'ledgers/l003';

update public.books_docs set data = data || '{"name":"Cash in SLATE vault","notes":"SLATE''s cash. Count it weekly with two signatures."}'::jsonb
where path = 'ledgers/l103';

update public.books_docs set data = data || '{"notes":"SLATE''s petty cash, run as a fixed float (imprest)."}'::jsonb
where path = 'ledgers/l043';

select set_config('slate.books_sync', '', true);

commit;
