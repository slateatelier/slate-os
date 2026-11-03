-- m_signatures.sql (3 Nov 2026)
-- Digital signatures on Books invoices.
--  signs/<user id>: { name, desig, img (JPEG data URL), w, h, at } — the Principal's or the COO's own signature.
--  invoices/<id>.sign: { uid, name, desig, at } — who signed the invoice and when.
-- Rules (everyone, the Principal included):
--  1. Only the Principal and the COO keep a signature, and each only their own (signs/<their id>).
--  2. A signature is put on an invoice only by its owner, with the name and designation from their signature.
--  3. Anyone else changing what the client sees on a signed invoice must drop the signature (sign again).
-- Safe to run more than once.

create or replace function private.books_sign_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r text; ns jsonb; os jsonb; g jsonb;
begin
  if auth.uid() is null or coalesce(current_setting('slate.books_sync', true), '') = '1' then return coalesce(new, old); end if;
  r := private.books_role();
  if coalesce(new.coll, old.coll) = 'signs' then
    if coalesce(new.doc_id, old.doc_id) <> auth.uid()::text or r not in ('Principal', 'COO') then
      raise exception 'Only the Principal and the COO keep a signature, and each only their own';
    end if;
    if tg_op <> 'DELETE' and (coalesce(new.data->>'img', '') !~ '^data:image/jpeg;base64,' or pg_column_size(new.data) > 200000) then
      raise exception 'The signature must be a JPEG image under 150 KB';
    end if;
    return coalesce(new, old);
  end if;
  if coalesce(new.coll, old.coll) = 'invoices' and tg_op <> 'DELETE' then
    ns := nullif(new.data->'sign', 'null'::jsonb);
    os := case when tg_op = 'UPDATE' then nullif(old.data->'sign', 'null'::jsonb) else null end;
    if ns is not null and ns is distinct from os then
      select data into g from public.books_docs where path = 'signs/' || auth.uid()::text;
      if ns->>'uid' <> auth.uid()::text or g is null or ns->>'name' is distinct from g->>'name' or ns->>'desig' is distinct from g->>'desig' then
        raise exception 'Only the person whose signature it is can sign with it';
      end if;
    elsif ns is not null and tg_op = 'UPDATE' and ns->>'uid' <> auth.uid()::text
      and ((new.data - 'sign' - 'trail' - 'at' - 'status' - 'files') is distinct from (old.data - 'sign' - 'trail' - 'at' - 'status' - 'files')) then
      raise exception 'This invoice is signed by %. Saving changes removes the signature; ask them to sign again', ns->>'name';
    end if;
  end if;
  return coalesce(new, old);
end $function$;

drop trigger if exists books_sign_guard on public.books_docs;
create trigger books_sign_guard before insert or delete or update on public.books_docs
  for each row execute function private.books_sign_guard();
