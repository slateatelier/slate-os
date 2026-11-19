-- m_file_covers.sql (19 Nov 2026)
-- Project file covers: the A4 cover sheet the Principal or the COO prints for a project's paper files.
-- The project image is kept here (private bucket 'covers', <project id>/<time>.jpg, a compressed JPEG);
-- the project document only keeps its path (projects/<id>.cover = { path, at, by }).
-- Only the Principal and the COO see, upload, replace or remove a cover image. Review logins read only.
-- Safe to run more than once.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 1048576, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

drop policy if exists covers_read on storage.objects;
create policy covers_read on storage.objects for select to authenticated using (
  bucket_id = 'covers' and (select private.is_top()));
drop policy if exists covers_write on storage.objects;
create policy covers_write on storage.objects for insert to authenticated with check (
  bucket_id = 'covers' and (select private.is_top()) and not (select private.is_reviewer()));
drop policy if exists covers_update on storage.objects;
create policy covers_update on storage.objects for update to authenticated using (
  bucket_id = 'covers' and (select private.is_top()) and not (select private.is_reviewer()));
drop policy if exists covers_delete on storage.objects;
create policy covers_delete on storage.objects for delete to authenticated using (
  bucket_id = 'covers' and (select private.is_top()) and not (select private.is_reviewer()));
