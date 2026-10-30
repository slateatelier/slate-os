-- SLATE Books: the approval rules, kept by the database itself (31 Oct 2026).
-- Until now the Books screens enforced who checks and who approves. Someone calling the database directly
-- could have skipped them. From now on the database refuses:
-- 1. anyone but the Principal changing Books settings (accounts used for salaries, numbering, depreciation …);
-- 2. an entry marked approved (or as from Tally) unless the approval rules allow it: the COO within the COO's
--     limit, entries that need no approval, an approved salary sheet, an approved request, or a split of an
--     approved entry;
-- 3. changing the amounts, accounts or date of an approved entry without it going back for approval;
-- 4. cancelling an entry, except the Principal, or its maker while it is still waiting or sent back;
-- 5. deleting entries, except the Principal;
-- 6. request decisions and salary sheets moving on without the right person: the COO checks, the Principal
--     approves (the COO within the COO's limit);
-- 7. people with no Books role, or Viewers, filing payment requests;
-- 8. a salary marked "only the Principal" in Business being copied into Books;
-- 9. the signed-out (anon) role having any table rights on Books (row security already returned nothing);
-- 10. renaming a record's path (which could move the settings, or turn an entry into a staff record);
-- 11. changing a request once the COO or the Principal has acted on it (unless it was sent back);
-- 12. closed months: also opening balances, fixed assets and salary sheets for a closed month; dates must be
--     written as YYYY-MM-DD; very large records;
-- 13. files: each person uploads into their own folder, and only pictures, PDFs and office documents.
-- The Principal's own work is not limited. Every change is still written to books_audit.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

revoke all on public.books_docs, public.books_audit from anon;

-- 7. own requests: only people with a Books role that may ask for money (office staff, accountant, COO, Principal)
create or replace function private.books_own(p_path text) returns boolean
language sql stable security definer set search_path to '' as $$
  select auth.uid() is not null and (
    p_path = 'members/' || auth.uid()::text
    or (p_path like 'requests/' || auth.uid()::text || '/items/%'
        and private.books_role() in ('Principal', 'COO', 'Accountant', 'Office staff')))
$$;

-- the COO's role in Books can be narrowed by the Principal, never widened
create or replace function private.books_role() returns text
language sql stable security definer set search_path to '' as $$
  select case
    when not coalesce(private.is_active(), false) then null
    when private.is_owner() then 'Principal'
    when private.is_coo() then coalesce((select case when x.r in ('COO','Accountant','Office staff','Viewer') then x.r end
            from (select s.data->'team'->(auth.uid()::text)->>'role' r from public.books_docs s where s.path = 'settings/main') x), 'COO')
    else (select case when x.r in ('COO','Accountant','Office staff','Viewer') then x.r end
            from (select s.data->'team'->(auth.uid()::text)->>'role' r from public.books_docs s where s.path = 'settings/main') x)
  end
$$;

-- 13. files: into the uploader's own folder; only pictures, PDFs and office documents
update storage.buckets set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword']
where id = 'books';
drop policy if exists books_files_write on storage.objects;
create policy books_files_write on storage.objects for insert to authenticated with check (
  bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text
  and ((select private.books_writer()) or (select private.books_role()) = 'Office staff'));

-- the approval settings, with the same defaults as the Books screens
create or replace function private.books_appr() returns jsonb
language sql stable security definer set search_path to '' as $$
  select '{"outCheck":true,"outApprove":true,"inCheck":true,"inApprove":false,"jvCheck":true,"jvApprove":true,"cooLimit":50000}'::jsonb
         || coalesce((select s.data->'approval' from public.books_docs s where s.path = 'settings/main'), '{}'::jsonb)
$$;

-- an entry's amount as the Books screens count it: the cash or bank moved, else the total
create or replace function private.books_v_amount(d jsonb) returns numeric
language sql stable security definer set search_path to '' as $$
  with ln as (select x.value v from jsonb_array_elements(case when jsonb_typeof(d->'lines') = 'array' then d->'lines' else '[]'::jsonb end) x),
       c as (select coalesce(sum(coalesce((ln.v->>'dr')::numeric, 0) - coalesce((ln.v->>'cr')::numeric, 0)), 0) net, count(*) n
               from ln join public.books_docs l on l.path = 'ledgers/' || (ln.v->>'l') and l.data->>'group' in ('cash', 'bank'))
  select case when (select n from c) > 0 and abs((select net from c)) > 0.005 then abs((select net from c))
              else coalesce((select sum(coalesce((v->>'dr')::numeric, 0)) from ln), 0) end
$$;

create or replace function private.books_rules() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  r text := private.books_role(); a jsonb; k text; lock_d text; need_c boolean; need_a boolean; amt numeric; lim numeric;
  ns text; os text; crit boolean; ok boolean; x jsonb;
begin
  if current_setting('slate.books_sync', true) = '1' or auth.uid() is null then return coalesce(new, old); end if;
  k := coalesce(new.coll, old.coll);

  -- 10. a record keeps its path, and when and by whom it was made (everyone, the Principal included)
  if tg_op = 'UPDATE' then
    if new.path is distinct from old.path then raise exception 'A Books record cannot be moved to another place'; end if;
    new.created_at := old.created_at; new.created_by := old.created_by;
  end if;
  if tg_op <> 'DELETE' and pg_column_size(new.data) > 262144 then raise exception 'This record is too large'; end if;
  if r = 'Principal' then return coalesce(new, old); end if;

  -- 12. dates in entries are written as YYYY-MM-DD, so the closing date can be compared
  if tg_op <> 'DELETE' and k in ('vouchers', 'invoices', 'payroll', 'cashcounts', 'recon', 'assets')
     and ((coalesce(new.data->>'date', '') <> '' and new.data->>'date' !~ '^\d{4}-\d{2}-\d{2}$')
       or (coalesce(new.data->>'month', '') <> '' and new.data->>'month' !~ '^\d{4}-\d{2}$')) then
    raise exception 'Dates must be written as YYYY-MM-DD';
  end if;
  -- 12. closed months, beyond what the first check covers
  lock_d := coalesce((select s.data->>'lockDate' from public.books_docs s where s.path = 'settings/main'), '');
  if lock_d <> '' then
    if k = 'payroll' and ((tg_op <> 'INSERT' and coalesce(old.data->>'month', '') <> '' and old.data->>'month' || '-01' <= lock_d)
                       or (tg_op <> 'DELETE' and coalesce(new.data->>'month', '') <> '' and new.data->>'month' || '-01' <= lock_d)) then
      raise exception 'The books are closed up to %. Only the Principal changes a salary sheet for a closed month', lock_d;
    end if;
    if k = 'ledgers' and tg_op = 'UPDATE' and (new.data->'opening') is distinct from (old.data->'opening') then
      raise exception 'The books are closed up to %. Only the Principal changes opening balances', lock_d;
    end if;
    if k = 'assets' and ((tg_op <> 'INSERT' and coalesce(old.data->>'date', '') <> '' and old.data->>'date' <= lock_d)
                      or (tg_op <> 'DELETE' and coalesce(new.data->>'date', '') <> '' and new.data->>'date' <= lock_d)) then
      raise exception 'The books are closed up to %. Only the Principal changes assets bought in a closed month', lock_d;
    end if;
  end if;

  -- 11. a request is fixed once it has been checked or decided (it can be changed again if sent back)
  if k like 'requests/%/items' then
    select p.data->>'status' into os from public.books_docs p
     where p.path = 'reqdec/' || split_part(coalesce(new.path, old.path), '/', 2) || '~' || split_part(coalesce(new.path, old.path), '/', 4);
    if coalesce(os, '') not in ('', 'returned') then raise exception 'This request has been acted on and can no longer be changed'; end if;
  end if;

  -- 1. settings
  if k = 'settings' then raise exception 'Only the Principal changes Books settings'; end if;

  -- 5. deleting entries
  if tg_op = 'DELETE' then
    if k in ('vouchers', 'payroll', 'reqdec', 'invoices') then raise exception 'Entries are not deleted. Cancel it instead, or ask the Principal'; end if;
    return old;
  end if;

  a := private.books_appr(); lim := coalesce((a->>'cooLimit')::numeric, 0);

  if k = 'vouchers' then
    ns := coalesce(new.data->>'status', 'approved');
    os := case when tg_op = 'UPDATE' then coalesce(old.data->>'status', 'approved') else null end;
    crit := tg_op = 'INSERT' or (new.data->'lines') is distinct from (old.data->'lines')
            or (new.data->'date') is distinct from (old.data->'date') or (new.data->'type') is distinct from (old.data->'type');
    case coalesce(new.data->>'type', '')
      when 'Payment' then need_c := (a->>'outCheck')::boolean; need_a := (a->>'outApprove')::boolean;
      when 'Receipt' then need_c := (a->>'inCheck')::boolean; need_a := (a->>'inApprove')::boolean;
      when 'Contra'  then need_c := (a->>'inCheck')::boolean; need_a := false;
      else need_c := (a->>'jvCheck')::boolean; need_a := (a->>'jvApprove')::boolean;
    end case;
    amt := private.books_v_amount(new.data);

    if ns in ('approved', 'tally') and (os is distinct from ns or crit) then
      ok := (ns = 'approved' and (
              (r = 'COO' and (not need_a or (amt > 0 and amt <= lim)))
           or (r = 'Accountant' and not need_a and not need_c)));
      -- an approved salary sheet being paid
      if not ok and ns = 'approved' and coalesce(new.data->>'payroll', '') <> '' then
        select p.data into x from public.books_docs p where p.path = 'payroll/' || (new.data->>'payroll');
        ok := x is not null and x->>'status' in ('approved', 'posted');
      end if;
      -- an approved request being paid, up to the amount approved
      if not ok and ns = 'approved' and coalesce(new.data->>'req', '') <> '' then
        select p.data into x from public.books_docs p where p.path = 'reqdec/' || (new.data->>'req');
        ok := x is not null and x->>'status' in ('approved', 'paid')
              and amt <= coalesce((select (q.data->>'amount')::numeric from public.books_docs q
                                    where q.path = 'requests/' || split_part(new.data->>'req', '~', 1) || '/items/' || split_part(new.data->>'req', '~', 2)), 0) + 0.005;
      end if;
      -- one part of an approved or Tally entry split by consultant
      if not ok and tg_op = 'INSERT' and coalesce(new.data->>'tallyOf', '') <> '' then
        select p.data into x from public.books_docs p where p.path = 'vouchers/' || (new.data->>'tallyOf');
        ok := x is not null and ns = coalesce(nullif(x->>'splitPrev', ''), x->>'status', 'approved') and x->>'status' in ('approved', 'tally', 'split');
      end if;
      if not ok then raise exception 'This entry needs the COO''s check or the Principal''s approval first'; end if;
    elsif ns = 'checked' and (os is distinct from ns or crit) then
      if not (r = 'COO' or (r = 'Accountant' and not need_c and need_a)) then raise exception 'Only the COO checks entries'; end if;
    elsif ns = 'void' and os is distinct from 'void' then
      if not (os in ('pending', 'returned') and coalesce(old.data->>'madeBy', '') = auth.uid()::text) then
        raise exception 'Only the Principal cancels an entry once it has been checked or approved';
      end if;
    elsif ns = 'split' and os is distinct from 'split' then
      if not (os in ('approved', 'tally')) then raise exception 'Only an approved entry can be split'; end if;
    elsif ns = 'returned' and os is distinct from 'returned' then
      if r <> 'COO' then raise exception 'Only the COO or the Principal sends an entry back'; end if;
    end if;
  end if;

  -- 6. request decisions
  if k = 'reqdec' then
    ns := coalesce(new.data->>'status', ''); os := case when tg_op = 'UPDATE' then coalesce(old.data->>'status', '') else '' end;
    if ns is distinct from os then
      amt := coalesce((select (q.data->>'amount')::numeric from public.books_docs q
                        where q.path = 'requests/' || split_part(new.doc_id, '~', 1) || '/items/' || split_part(new.doc_id, '~', 2)), 0);
      if ns = 'approved' and not (r = 'COO' and (not (a->>'outApprove')::boolean or amt <= lim)) then
        raise exception 'Only the Principal approves this request';
      elsif ns in ('checked', 'returned', 'rejected') and r <> 'COO' then
        raise exception 'Only the COO checks requests';
      elsif ns in ('paid', 'posted') and os not in ('approved', 'paid', 'posted') then
        raise exception 'A request is paid only after it is approved';
      end if;
    end if;
  end if;

  -- 6. salary sheets
  if k = 'payroll' then
    ns := coalesce(new.data->>'status', 'draft'); os := case when tg_op = 'UPDATE' then coalesce(old.data->>'status', 'draft') else null end;
    if ns = 'approved' and os is distinct from 'approved' then raise exception 'Only the Principal approves a salary sheet'; end if;
    if ns = 'checked' and os is distinct from 'checked' and r <> 'COO' then raise exception 'Only the COO checks a salary sheet'; end if;
    if ns = 'posted' and os is distinct from 'posted' and os is distinct from 'approved' then raise exception 'A salary sheet is paid only after it is approved'; end if;
    if tg_op = 'UPDATE' and os in ('approved', 'posted') and (new.data->'rows') is distinct from (old.data->'rows') then
      raise exception 'An approved salary sheet cannot be changed. Ask the Principal';
    end if;
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists books_rules on public.books_docs;
create trigger books_rules before insert or update or delete on public.books_docs
  for each row execute function private.books_rules();

revoke all on function private.books_appr(), private.books_v_amount(jsonb), private.books_rules() from public, anon, authenticated;
grant execute on function private.books_own(text) to authenticated;

-- 8. a salary marked "only the Principal" in Business stays out of Books
create or replace function private.books_from_fin() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(new.coll, old.coll) = 'staff' then
    if tg_op <> 'DELETE' and coalesce((new.data->>'principalOnly')::boolean, false) then
      perform set_config('slate.books_sync', '1', true);
      delete from public.books_docs where coll = 'staff' and data->>'osId' = new.doc_id;
      perform set_config('slate.books_sync', '', true);
      return null;
    end if;
    perform private.books_sync_staff(coalesce(new.doc_id, old.doc_id), case when tg_op = 'DELETE' then null else new.data end);
  elsif coalesce(new.coll, old.coll) = 'projects' then
    perform private.books_sync_project(coalesce(new.doc_id, old.doc_id), case when tg_op = 'DELETE' then null else new.data end);
  end if;
  return null;
end $$;

commit;
