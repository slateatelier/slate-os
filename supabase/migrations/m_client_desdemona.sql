-- Desdemona apartment owners (1 Nov 2026). Data only; nothing about the structure changes.
--  * Three Desdemona interior projects were imported with the placeholder client "Desdemona apartment owner".
--    The Principal gave the owners: C10 Mr Reza, C11 Mr Zahid, F11 Mr Nayeem.
--  * Sets the client on those projects in SLATE OS and on their Books projects (so invoices carry the owner's name).
--    Codes, names, fees and payments stay as they are.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

update public.docs set data = data || jsonb_build_object('client', v.owner)
from (values ('oldDesdemonaC10','MR REZA'), ('oldDesdemonaC11','MR ZAHID'), ('oldDesdemonaF11','MR NAYEEM')) as v(id, owner)
where public.docs.coll = 'projects' and public.docs.doc_id = v.id;

select set_config('slate.books_sync', '1', true);

update public.books_docs set data = data || jsonb_build_object('client', v.owner)
from (values ('os_oldDesdemonaC10','Mr Reza'), ('os_oldDesdemonaC11','Mr Zahid'), ('os_oldDesdemonaF11','Mr Nayeem')) as v(id, owner)
where public.books_docs.path = 'projects/' || v.id;

select set_config('slate.books_sync', '', true);

commit;
