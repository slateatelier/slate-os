-- SLATE Books: monthly office shopping and the COO's petty cash (2 Nov 2026).
--  * Monthly shopping list: office staff (Rabbi) count what is left at month end and submit what to buy;
--    the COO approves or sends it back; office staff order from the enlisted vendor and confirm what arrived,
--    with the bill and the price paid; the COO releases the cash from petty cash.
--    Collections: shopitems (the standard list: item, size, group, vendor, monthly quantity),
--    shopvendors (enlisted vendors), shopcfg/main (which expense account each group is booked to),
--    shoplists/<YYYY-MM> (one list per month, with what was counted, approved, received and paid).
--  * Petty cash is held by the COO (settings.pettyHolder). The holder may refill it up to Tk 1,00,000 in a calendar
--    month (settings.pettyCap) without waiting for the Principal; the Principal sees the statement and can stop a
--    refill until Accounts pays it.
--  * Seeds the 97 items of the current list (vendor: Riyad Enterprises, 01830974687).
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

-- office staff see the shopping records and may write only the monthly lists
drop policy if exists books_read on public.books_docs;
create policy books_read on public.books_docs for select to authenticated using (
  (select private.books_admin())
  or (coll in ('settings','catalog','reqdec','shopitems','shopvendors','shopcfg','shoplists') and (select private.books_role()) = 'Office staff')
  or private.books_own(path));

drop policy if exists books_insert on public.books_docs;
create policy books_insert on public.books_docs for insert to authenticated with check (
  ((select private.books_writer()) and coll <> 'settings' and coll <> 'members')
  or ((select private.books_role()) = 'Principal')
  or (private.books_own(path) and private.is_active())
  or (coll = 'shoplists' and (select private.books_role()) = 'Office staff'));

drop policy if exists books_update on public.books_docs;
create policy books_update on public.books_docs for update to authenticated
  using (((select private.books_writer()) and coll <> 'members') or ((select private.books_role()) = 'Principal') or private.books_own(path)
         or (coll = 'shoplists' and (select private.books_role()) = 'Office staff'))
  with check (((select private.books_writer()) and coll <> 'members') or ((select private.books_role()) = 'Principal') or private.books_own(path)
         or (coll = 'shoplists' and (select private.books_role()) = 'Office staff'));

-- a petty cash refill the holder may approve: a top-up asked by the petty cash holder, within the monthly limit
create or replace function private.books_topup_ok(p_key text, p_amt numeric) returns boolean
language plpgsql stable security definer set search_path to '' as $$
declare u text := split_part(p_key, '~', 1); q jsonb; st jsonb; holder text; cap numeric; used numeric; m text;
begin
  select p.data into q from public.books_docs p where p.path = 'requests/' || u || '/items/' || split_part(p_key, '~', 2);
  if q is null or coalesce(q->>'type', '') <> 'topup' or coalesce(p_amt, 0) <= 0 then return false; end if;
  select s.data into st from public.books_docs s where s.path = 'settings/main';
  holder := coalesce(st->>'pettyHolder', '');
  if holder = '' then
    if not exists (select 1 from public.profiles pr where pr.id::text = u and pr.designation = 'coo' and pr.active) then return false; end if;
  elsif holder <> u then return false;
  end if;
  cap := coalesce(nullif(st->>'pettyCap', '')::numeric, 100000);
  m := left(coalesce(q->>'date', ''), 7);
  select coalesce(sum((r.data->>'amount')::numeric), 0) into used
    from public.books_docs r
    join public.books_docs d on d.path = 'reqdec/' || split_part(r.coll, '/', 2) || '~' || r.doc_id
   where r.coll like 'requests/%/items' and r.data->>'type' = 'topup' and left(coalesce(r.data->>'date', ''), 7) = m
     and coalesce((r.data->>'withdrawn')::boolean, false) = false
     and d.data->>'status' in ('approved', 'paid', 'posted')
     and split_part(r.coll, '/', 2) || '~' || r.doc_id <> p_key;
  return used + p_amt <= cap + 0.005;
end $$;
revoke all on function private.books_topup_ok(text, numeric) from public, anon, authenticated;

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
      select q.data into x from public.books_docs q
       where q.path = 'requests/' || split_part(new.doc_id, '~', 1) || '/items/' || split_part(new.doc_id, '~', 2);
      amt := coalesce((x->>'amount')::numeric, 0);
      -- a petty cash refill is held to the monthly limit (asked by the holder), whatever its size; other requests to the COO's limit
      if ns = 'approved' and not (r = 'COO' and case when coalesce(x->>'type', '') = 'topup' then private.books_topup_ok(new.doc_id, amt)
                                                      else (not (a->>'outApprove')::boolean or amt <= lim) end) then
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

revoke all on function private.books_rules() from public, anon, authenticated;

-- the monthly list moves step by step, each step by the right person:
--   draft / returned -> submitted ............ office staff, Accounts or the COO
--   submitted -> approved / returned ......... the COO
--   submitted -> draft (taken back) .......... whoever prepares it
--   approved -> ordered -> received .......... office staff, Accounts or the COO (and back from received to ordered)
--   received -> paid ......................... the COO, within the COO's limit
--   anything after paid ...................... the Principal only
-- approved quantities change only by the COO; the standard list, vendors and accounts only by Principal, COO, Accounts
create or replace function private.books_shop() returns trigger
language plpgsql security definer set search_path to '' as $$
declare r text := private.books_role(); k text; ns text; os text; lim numeric; aq_new jsonb; aq_old jsonb;
begin
  if auth.uid() is null or r = 'Principal' then return coalesce(new, old); end if;
  k := coalesce(new.coll, old.coll);
  if k in ('shopitems', 'shopvendors', 'shopcfg') then
    if r not in ('COO', 'Accountant') then raise exception 'Only the COO changes the standard shopping list and vendors'; end if;
    return coalesce(new, old);
  end if;
  if k <> 'shoplists' then return coalesce(new, old); end if;
  if r not in ('COO', 'Accountant', 'Office staff') then raise exception 'You don''t have a role for the shopping list'; end if;
  os := case when tg_op = 'INSERT' then '' else coalesce(old.data->>'status', 'draft') end;
  if tg_op = 'DELETE' then
    if r <> 'COO' or os = 'paid' then raise exception 'Only the COO removes a shopping list, and never once it is paid'; end if;
    return old;
  end if;
  if new.doc_id !~ '^\d{4}-\d{2}$' then raise exception 'A shopping list is kept as YYYY-MM'; end if;
  ns := coalesce(new.data->>'status', 'draft');
  if os = 'paid' then raise exception 'This list is paid. Only the Principal changes it now'; end if;
  if ns is distinct from os then
    if not (
         (os in ('', 'draft', 'returned') and ns in ('draft', 'submitted'))
      or (os = 'submitted' and ns = 'draft')
      or (os = 'submitted' and ns in ('approved', 'returned') and r = 'COO')
      or (os = 'approved' and ns = 'ordered')
      or (os = 'ordered' and ns = 'received')
      or (os = 'received' and ns = 'ordered')
      or (os = 'received' and ns = 'paid' and r = 'COO')
    ) then
      raise exception 'The shopping list can''t move from % to % this way', coalesce(nullif(os, ''), 'new'), ns;
    end if;
    if ns = 'paid' then
      lim := coalesce((private.books_appr()->>'cooLimit')::numeric, 0);
      if coalesce((new.data->'paid'->>'total')::numeric, 0) > lim then
        raise exception 'This list is above the COO''s limit of Tk %. The Principal releases the cash', lim;
      end if;
    end if;
  elsif os = 'submitted' and r <> 'COO' then
    raise exception 'The list is with the COO. Take it back first to change it';
  end if;
  -- quantities the COO approved stay as approved
  if os in ('approved', 'ordered', 'received') and r <> 'COO' then
    select coalesce(jsonb_agg(jsonb_build_array(x->>'id', x->'aq') order by x->>'id'), '[]'::jsonb) into aq_new from jsonb_array_elements(coalesce(new.data->'rows', '[]'::jsonb)) x;
    select coalesce(jsonb_agg(jsonb_build_array(x->>'id', x->'aq') order by x->>'id'), '[]'::jsonb) into aq_old from jsonb_array_elements(coalesce(old.data->'rows', '[]'::jsonb)) x;
    if aq_new is distinct from aq_old then raise exception 'Only the COO changes approved quantities'; end if;
  end if;
  return new;
end $$;
revoke all on function private.books_shop() from public, anon, authenticated;

drop trigger if exists books_shop on public.books_docs;
create trigger books_shop before insert or update or delete on public.books_docs
  for each row execute function private.books_shop();

-- petty cash: held by the COO, refilled up to Tk 1,00,000 a month
update public.books_docs s set data = s.data
  || jsonb_build_object('pettyCap', coalesce(nullif(s.data->>'pettyCap', '')::numeric, 100000))
  || case when coalesce(s.data->>'pettyHolder', '') = ''
          then coalesce((select jsonb_build_object('pettyHolder', p.id::text) from public.profiles p where p.designation = 'coo' and p.active limit 1), '{}'::jsonb)
          else '{}'::jsonb end
where s.path = 'settings/main';

-- enlisted vendor and expense accounts per group (the COO changes them in Books › Shopping › Set-up)
insert into public.books_docs (path, coll, doc_id, data) values
  ('shopvendors/v01', 'shopvendors', 'v01', '{"name": "Riyad Enterprises", "phone": "01830974687", "supplies": "Monthly office items: pantry, housekeeping, paper, stationery, files", "active": true}'::jsonb),
  ('shopcfg/main', 'shopcfg', 'main', (jsonb_build_object('ledgers', jsonb_strip_nulls(jsonb_build_object(
      'Pantry & Refreshments', (select doc_id from public.books_docs where coll = 'ledgers' and data->>'name' = 'Entertainment' limit 1),
      'Housekeeping Supplies', (select doc_id from public.books_docs where coll = 'ledgers' and data->>'name' = 'Cleaning & Sanitation Exp.' limit 1),
      'Paper/Envelopes', (select doc_id from public.books_docs where coll = 'ledgers' and data->>'name' = 'Printing & Stationery' limit 1),
      'Writing Instruments', (select doc_id from public.books_docs where coll = 'ledgers' and data->>'name' = 'Printing & Stationery' limit 1),
      'Desk & Stationery Accessories', (select doc_id from public.books_docs where coll = 'ledgers' and data->>'name' = 'Printing & Stationery' limit 1),
      'Filing & Folders', (select doc_id from public.books_docs where coll = 'ledgers' and data->>'name' = 'Printing & Stationery' limit 1))),
    'otherLedger', (select doc_id from public.books_docs where coll = 'ledgers' and data->>'name' = 'Office Supplies' limit 1),
    'groups', '["Pantry & Refreshments","Housekeeping Supplies","Paper/Envelopes","Writing Instruments","Desk & Stationery Accessories","Filing & Folders"]'::jsonb,
    'countFrom', 25)))
on conflict (path) do nothing;

-- the current list, as on the office sheet (Required = the standard monthly quantity)
insert into public.books_docs (path, coll, doc_id, data)
select x.path, 'shopitems', regexp_replace(x.path, '^.*/', ''), x.data from (values
  ('shopitems/i001', '{"id": "i001", "sl": 1, "name": "Milk packet (DANO)", "spec": "10 GRAM", "group": "Pantry & Refreshments", "std": 50, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i002', '{"id": "i002", "sl": 2, "name": "Coffee Packet", "spec": "200 GRAM", "group": "Pantry & Refreshments", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i003', '{"id": "i003", "sl": 3, "name": "Sugar", "spec": "1KG", "group": "Pantry & Refreshments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i004', '{"id": "i004", "sl": 4, "name": "Salt", "spec": "1KG", "group": "Pantry & Refreshments", "std": 0, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i005', '{"id": "i005", "sl": 5, "name": "Tea (ISPAHANI)", "spec": "400 gram", "group": "Pantry & Refreshments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i006', '{"id": "i006", "sl": 6, "name": "Cloves", "spec": "50 gram", "group": "Pantry & Refreshments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i007', '{"id": "i007", "sl": 7, "name": "Cardamom", "spec": "50 gram", "group": "Pantry & Refreshments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i008', '{"id": "i008", "sl": 8, "name": "Olympic Nutty Real Peanut Biscuit", "spec": "50 gram", "group": "Pantry & Refreshments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i009', '{"id": "i009", "sl": 9, "name": "Olympic Lexus Vegetable Crackers Biscuits", "spec": "216 gram", "group": "Pantry & Refreshments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i010', '{"id": "i010", "sl": 10, "name": "Fresh Butter Cookies Biscuit Jar", "spec": "750 gram", "group": "Pantry & Refreshments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i011', '{"id": "i011", "sl": 11, "name": "Ruchi BBQ Chanachur", "spec": "500 gram", "group": "Pantry & Refreshments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i012', '{"id": "i012", "sl": 12, "name": "Pran Puffed Rice (Muri)", "spec": "500 gram", "group": "Pantry & Refreshments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i013', '{"id": "i013", "sl": 13, "name": "Mustard oil (Radhuni)", "spec": "250 ml", "group": "Pantry & Refreshments", "std": 0.5, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i014', '{"id": "i014", "sl": 14, "name": "Hand towel tissue", "spec": "Bashundhara", "group": "Housekeeping Supplies", "std": 15, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i015', '{"id": "i015", "sl": 15, "name": "Hand wash", "spec": "1 Litre", "group": "Housekeeping Supplies", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i016', '{"id": "i016", "sl": 16, "name": "Godrej Magic Hand Wash (Powder packet)", "spec": "9 gram", "group": "Housekeeping Supplies", "std": 3, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i017', '{"id": "i017", "sl": 17, "name": "Vim liquid (dishwash)", "spec": "200 ml", "group": "Housekeeping Supplies", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i018', '{"id": "i018", "sl": 18, "name": "Air freshener (Angelic Citrus Burst)", "spec": "300ml", "group": "Housekeeping Supplies", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i019', '{"id": "i019", "sl": 19, "name": "Lizol", "spec": "1 litre", "group": "Housekeeping Supplies", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i020', '{"id": "i020", "sl": 20, "name": "Harpic", "spec": "750 ml", "group": "Housekeeping Supplies", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i021', '{"id": "i021", "sl": 21, "name": "Toilet tissue", "spec": "Bashundhara", "group": "Housekeeping Supplies", "std": 20, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i022', '{"id": "i022", "sl": 22, "name": "Toilet freshener (Tablet box type)", "spec": "Odonil", "group": "Housekeeping Supplies", "std": 4, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i023', '{"id": "i023", "sl": 23, "name": "Wheel powder (detergent)", "spec": "500 gram", "group": "Housekeeping Supplies", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i024', '{"id": "i024", "sl": 24, "name": "Garbage polythene bags Black", "spec": "24\" x 18\"", "group": "Housekeeping Supplies", "std": 30, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i025', '{"id": "i025", "sl": 25, "name": "Broom (jharu)", "spec": "", "group": "Housekeeping Supplies", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i026', '{"id": "i026", "sl": 26, "name": "Mosquito repellent (ACI)", "spec": "475ml", "group": "Housekeeping Supplies", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i027', '{"id": "i027", "sl": 27, "name": "Batteries", "spec": "AA", "group": "Housekeeping Supplies", "std": 6, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i028', '{"id": "i028", "sl": 28, "name": "Duster", "spec": "", "group": "Housekeeping Supplies", "std": 0, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i029', '{"id": "i029", "sl": 29, "name": "Mr Brasso (Glass Cleaner)", "spec": "250 ml", "group": "Housekeeping Supplies", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i030', '{"id": "i030", "sl": 30, "name": "A3 envelope", "spec": "18\" x 14\"", "group": "Paper/Envelopes", "std": 10, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i031', '{"id": "i031", "sl": 31, "name": "A4 envelope", "spec": "12\" x 10\"", "group": "Paper/Envelopes", "std": 10, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i032', '{"id": "i032", "sl": 32, "name": "Letter Envelope", "spec": "9.5\" x 4.25\"", "group": "Paper/Envelopes", "std": 10, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i033', '{"id": "i033", "sl": 33, "name": "A3 paper (Bashundhara)", "spec": "80 gsm ( 1 Rim)", "group": "Paper/Envelopes", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i034', '{"id": "i034", "sl": 34, "name": "A4 paper (Bashundhara)", "spec": "80 gsm ( 1 Rim)", "group": "Paper/Envelopes", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i035', '{"id": "i035", "sl": 35, "name": "A4 paper (Sonali)", "spec": "65 gsm ( 1 Rim)", "group": "Paper/Envelopes", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i036', '{"id": "i036", "sl": 36, "name": "Stamp Paper 100 Taka", "spec": "100 taka 1 paper", "group": "Paper/Envelopes", "std": 5, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i037', '{"id": "i037", "sl": 37, "name": "Legal Size Paper", "spec": "70 gsm ( 1 Rim)", "group": "Paper/Envelopes", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i038', '{"id": "i038", "sl": 38, "name": "Matador Hi School Pen", "spec": "Black, Blue, Green, Red", "group": "Writing Instruments", "std": 10, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i039', '{"id": "i039", "sl": 39, "name": "Matador i-teen gel Pen", "spec": "Green", "group": "Writing Instruments", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i040', '{"id": "i040", "sl": 40, "name": "Matador i-teen gel Pen", "spec": "Black", "group": "Writing Instruments", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i041', '{"id": "i041", "sl": 41, "name": "Matador i-teen gel Pen", "spec": "Blue", "group": "Writing Instruments", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i042', '{"id": "i042", "sl": 42, "name": "Matador i-teen gel Pen", "spec": "Red", "group": "Writing Instruments", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i043', '{"id": "i043", "sl": 43, "name": "Pilot Gel Pen (V7 point)", "spec": "Black", "group": "Writing Instruments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i044', '{"id": "i044", "sl": 44, "name": "Pilot Gel Pen (V7 point)", "spec": "Blue", "group": "Writing Instruments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i045', '{"id": "i045", "sl": 45, "name": "Faber Castell (2B)", "spec": "2B", "group": "Writing Instruments", "std": 12, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i046', '{"id": "i046", "sl": 46, "name": "Sharpner", "spec": "", "group": "Writing Instruments", "std": 0, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i047', '{"id": "i047", "sl": 47, "name": "Mechanical Rotary Sharpner (Deli)", "spec": "Small Size", "group": "Writing Instruments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i048', '{"id": "i048", "sl": 48, "name": "CD Marker pen (Both Side)", "spec": "Black", "group": "Writing Instruments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i049', '{"id": "i049", "sl": 49, "name": "Highlighter (Red Leaf)", "spec": "Orange", "group": "Writing Instruments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i050', '{"id": "i050", "sl": 50, "name": "Highlighter (Red Leaf)", "spec": "Yellow", "group": "Writing Instruments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i051', '{"id": "i051", "sl": 51, "name": "Highlighter (Red Leaf)", "spec": "Blue", "group": "Writing Instruments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i052', '{"id": "i052", "sl": 52, "name": "Highlighter (Red Leaf)", "spec": "Green", "group": "Writing Instruments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i053', '{"id": "i053", "sl": 53, "name": "Highlighter (Red Leaf)", "spec": "Magenta", "group": "Writing Instruments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i054', '{"id": "i054", "sl": 54, "name": "Whiteboard marker (Red Leaf)", "spec": "Red", "group": "Writing Instruments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i055', '{"id": "i055", "sl": 55, "name": "Whiteboard marker (Red Leaf)", "spec": "Blue", "group": "Writing Instruments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i056', '{"id": "i056", "sl": 56, "name": "Whiteboard marker (Red Leaf)", "spec": "Green", "group": "Writing Instruments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i057', '{"id": "i057", "sl": 57, "name": "Whiteboard marker (Red Leaf)", "spec": "Black", "group": "Writing Instruments", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i058', '{"id": "i058", "sl": 58, "name": "White Board Duster", "spec": "", "group": "Writing Instruments", "std": 0, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i059', '{"id": "i059", "sl": 59, "name": "Eraser", "spec": "", "group": "Writing Instruments", "std": 0, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i060', '{"id": "i060", "sl": 60, "name": "Sketch Notebook ( White Dotted Paper)", "spec": "A5 size", "group": "Desk & Stationery Accessories", "std": 3, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i061', '{"id": "i061", "sl": 61, "name": "Spiral Notebook", "spec": "A5 Size", "group": "Desk & Stationery Accessories", "std": 3, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i062', '{"id": "i062", "sl": 62, "name": "Steel Scale", "spec": "12 Inch", "group": "Desk & Stationery Accessories", "std": 3, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i063', '{"id": "i063", "sl": 63, "name": "NT cutter", "spec": "", "group": "Desk & Stationery Accessories", "std": 3, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i064', '{"id": "i064", "sl": 64, "name": "Pin Opener (Deli)", "spec": "", "group": "Desk & Stationery Accessories", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i065', '{"id": "i065", "sl": 65, "name": "Paper Gem Clips (Deli)", "spec": "1 box", "group": "Desk & Stationery Accessories", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i066', '{"id": "i066", "sl": 66, "name": "Sticky notes (Square)", "spec": "3\" x 3\"", "group": "Desk & Stationery Accessories", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i067', '{"id": "i067", "sl": 67, "name": "Sticky notes (5pcs linear)", "spec": "5pcs linear", "group": "Desk & Stationery Accessories", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i068', '{"id": "i068", "sl": 68, "name": "Pen holder (Deli)", "spec": "Square Shape, Black", "group": "Desk & Stationery Accessories", "std": 3, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i069', '{"id": "i069", "sl": 69, "name": "White Calculator Deli Calculator M01010", "spec": "White", "group": "Desk & Stationery Accessories", "std": 0, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i070', '{"id": "i070", "sl": 70, "name": "Stapler", "spec": "", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i071', '{"id": "i071", "sl": 71, "name": "Staple pins", "spec": "", "group": "Desk & Stationery Accessories", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i072', '{"id": "i072", "sl": 72, "name": "Paper punch machine", "spec": "", "group": "Desk & Stationery Accessories", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i073', '{"id": "i073", "sl": 73, "name": "Cello Scotch tape", "spec": "2 inch", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i074', '{"id": "i074", "sl": 74, "name": "Osaka PVC Tape", "spec": ".5 inch, Black", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i075', '{"id": "i075", "sl": 75, "name": "Rexin Tape (Hunter)", "spec": "2 inch, Black", "group": "Desk & Stationery Accessories", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i076', '{"id": "i076", "sl": 76, "name": "Masking tape (Hunter)", "spec": "1 inch", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i077', '{"id": "i077", "sl": 77, "name": "Masking tape (Hunter)", "spec": "2 inch", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i078', '{"id": "i078", "sl": 78, "name": "Tape dispenser", "spec": "", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i079', '{"id": "i079", "sl": 79, "name": "Glue stick", "spec": "Fevicol", "group": "Desk & Stationery Accessories", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i080', '{"id": "i080", "sl": 80, "name": "Rubber bands", "spec": "100 gram", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i081', '{"id": "i081", "sl": 81, "name": "Correction fluid", "spec": "", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i082', '{"id": "i082", "sl": 82, "name": "Binder clips", "spec": "15mm", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i083', '{"id": "i083", "sl": 83, "name": "Binder clips", "spec": "25mm", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i084', '{"id": "i084", "sl": 84, "name": "Binder clips", "spec": "32mm", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i085', '{"id": "i085", "sl": 85, "name": "Binder clips", "spec": "51mm", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i086', '{"id": "i086", "sl": 86, "name": "Deli Classic Scissor", "spec": "Deli Classic", "group": "Desk & Stationery Accessories", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i087', '{"id": "i087", "sl": 87, "name": "Both Side Tape", "spec": "1/2 inch", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i088', '{"id": "i088", "sl": 88, "name": "Visiting Card Holder Box", "spec": "Transparent", "group": "Desk & Stationery Accessories", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i089', '{"id": "i089", "sl": 89, "name": "Stamp pad ink", "spec": "(Liquid) 1 Bottle", "group": "Desk & Stationery Accessories", "std": 1, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i090', '{"id": "i090", "sl": 90, "name": "Transparent button File Folder", "spec": "Transparent", "group": "Filing & Folders", "std": 6, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i091', '{"id": "i091", "sl": 91, "name": "Data Bank Double Clip File (712)", "spec": "F/C, Black", "group": "Filing & Folders", "std": 6, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i092', '{"id": "i092", "sl": 92, "name": "Ring Folder", "spec": "F/C, Black", "group": "Filing & Folders", "std": 0, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i093', '{"id": "i093", "sl": 93, "name": "Index File Folder", "spec": "F/C, Black", "group": "Filing & Folders", "std": 0, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i094', '{"id": "i094", "sl": 94, "name": "Report Cover File", "spec": "A4, Black", "group": "Filing & Folders", "std": 10, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i095', '{"id": "i095", "sl": 95, "name": "Magazine file holder Plastic (Matador)", "spec": "Black", "group": "Filing & Folders", "std": 4, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i096', '{"id": "i096", "sl": 96, "name": "Displace File Book (20-30 pockets)", "spec": "F/C, Black", "group": "Filing & Folders", "std": 2, "vendor": "v01", "active": true}'::jsonb),
  ('shopitems/i097', '{"id": "i097", "sl": 97, "name": "Plastic Punch display Pocket folders", "spec": "A4", "group": "Filing & Folders", "std": 0, "vendor": "v01", "active": true}'::jsonb)
) as x(path, data)
on conflict (path) do nothing;

commit;
