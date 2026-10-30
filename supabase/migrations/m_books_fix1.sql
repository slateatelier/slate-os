-- SLATE Books fix (31 Oct 2026): let signed-in users run the Books access checks.
-- Without this, every Books screen fails with "permission denied for function books_admin".
-- Who sees what does not change: the checks themselves decide that.
grant execute on function private.books_role(), private.books_admin(), private.books_writer(), private.books_own(text) to authenticated;
