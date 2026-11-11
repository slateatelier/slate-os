-- SLATE Books · Letters and cards (11 Nov 2026)
-- More › Staff › Letters and cards: NOC for travel, salary certificate, salary statement, employment certificate,
-- office ID card and visiting card. Two new Books collections:
--   hrfiles/<staff id>  passport number, title, photo and card contact for each staff member
--   letters/<id>        the register: every letter or card issued, with its reference number and exact content
-- Only the Principal and the COO (by designation in SLATE OS) can read or write either, whatever their Books role;
-- the Accountant, office staff and viewers get nothing back. Only the Principal can delete from the register.
-- Run in Supabase › SQL Editor. Safe to run more than once.

drop policy if exists books_hr_only_top on public.books_docs;
create policy books_hr_only_top on public.books_docs as restrictive for all to authenticated
  using (coll not in ('hrfiles', 'letters') or private.is_owner() or private.is_coo())
  with check (coll not in ('hrfiles', 'letters') or private.is_owner() or private.is_coo());

drop policy if exists books_letters_keep on public.books_docs;
create policy books_letters_keep on public.books_docs as restrictive for delete to authenticated
  using (coll <> 'letters' or private.is_owner());

-- the change log for these two collections is for the Principal and the COO only (it already is for all of Books)
