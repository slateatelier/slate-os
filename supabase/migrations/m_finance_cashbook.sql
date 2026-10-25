-- SLATE OS · Finance stage 1: Cash/Bank invoices, money receipts, cash & bank book.
-- New record types in fin_docs: accounts (cash in hand, banks, bKash), moves (transfers, owner's drawings,
-- capital in, other income) and recons (month-end check of each account against the real balance).
-- Every client payment now goes into an account and carries a money-receipt number.

create unique index if not exists fin_mr_no on public.fin_docs ((data->>'mrNo')) where coll = 'receipts' and coalesce(data->>'mrNo', '') <> '';
create index if not exists fin_docs_account on public.fin_docs ((data->>'accountId')) where coll in ('receipts', 'recons');

create or replace function private.fin_acct_ok(aid text)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.fin_docs where path = 'accounts/' || coalesce(aid, '') and coalesce((data->>'active')::boolean, true))
$$;

create or replace function private.fin_guard()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  uid uuid := auth.uid();
  role text := private.fin_role();
  od jsonb := case when tg_op in ('UPDATE', 'DELETE') then old.data else null end;
  nd jsonb;
  ost text; nst text; inv jsonb; settled numeric; k text; amt numeric;
  allowed text[];
begin
  if uid is not null and coalesce(role, '') not in ('principal', 'coo') then
    raise exception 'Finance is limited to the Principal and the COO';
  end if;

  if tg_op = 'DELETE' then
    if old.coll = 'invoices' then
      if coalesce(od->>'status', 'draft') <> 'draft' then raise exception 'Issued invoices are never deleted. Void it instead.'; end if;
    elsif old.coll in ('receipts', 'moves', 'recons') then
      if private.fin_locked(od->>'date') then raise exception 'That financial year is closed. The Principal can reopen it in Settings.'; end if;
    elsif old.coll = 'projects' then
      if exists (select 1 from public.fin_docs where coll = 'invoices' and data->>'projectId' = old.doc_id) then
        raise exception 'This project has invoices, so it can''t be deleted. Mark it closed instead.';
      end if;
    elsif old.coll = 'accounts' then
      if exists (select 1 from public.fin_docs where (coll in ('receipts', 'recons') and data->>'accountId' = old.doc_id)
                 or (coll = 'moves' and (data->>'from' = old.doc_id or data->>'to' = old.doc_id))) then
        raise exception 'This account has entries, so it can''t be deleted. Mark it inactive instead.';
      end if;
    elsif old.path = 'config/settings' then
      raise exception 'Settings can''t be deleted';
    end if;
    return old;
  end if;

  -- path, collection and server-kept fields
  new.coll := split_part(new.path, '/', 1);
  new.doc_id := split_part(new.path, '/', 2);
  if new.coll not in ('projects', 'invoices', 'receipts', 'config', 'accounts', 'moves', 'recons') then
    raise exception 'Unknown finance record type: %', new.coll;
  end if;
  if new.coll = 'config' and new.doc_id <> 'settings' then raise exception 'Unknown settings record'; end if;
  if tg_op = 'UPDATE' and (new.path <> old.path) then raise exception 'Records can''t be moved'; end if;
  if tg_op = 'INSERT' then
    new.created_at := now(); new.created_by := uid;
  else
    new.created_at := old.created_at; new.created_by := old.created_by;
  end if;
  new.updated_at := now(); new.updated_by := uid;
  nd := new.data - 'createdAt' - 'createdBy' - 'updatedAt' - 'updatedBy';
  nd := nd || jsonb_build_object('createdAt', to_jsonb(new.created_at), 'createdBy', to_jsonb(new.created_by),
                                 'updatedAt', to_jsonb(new.updated_at), 'updatedBy', to_jsonb(new.updated_by));
  new.data := nd;

  if new.coll = 'config' then
    if (coalesce(od->'lockedFYs', '[]'::jsonb) is distinct from coalesce(nd->'lockedFYs', '[]'::jsonb)) and role <> 'principal' and uid is not null then
      raise exception 'Only the Principal closes or reopens a financial year';
    end if;
    return new;
  end if;

  if new.coll = 'projects' then
    if coalesce(nd->>'code', '') = '' or coalesce(nd->>'name', '') = '' then raise exception 'A project needs a code and a name'; end if;
    if coalesce((nd->>'fee')::numeric, 0) < 0 then raise exception 'Fee can''t be negative'; end if;
    return new;
  end if;

  if new.coll = 'accounts' then
    if coalesce(nd->>'name', '') = '' then raise exception 'An account needs a name'; end if;
    if coalesce(nd->>'kind', '') not in ('cash', 'bank', 'mfs') then raise exception 'Account type must be cash, bank or mobile wallet'; end if;
    if coalesce(nd->>'openingDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Opening balance date is missing'; end if;
    if tg_op = 'UPDATE' and ((od->'opening') is distinct from (nd->'opening') or (od->>'openingDate') is distinct from (nd->>'openingDate'))
       and (private.fin_locked(od->>'openingDate') or private.fin_locked(nd->>'openingDate')) then
      raise exception 'That financial year is closed, so the opening balance can''t change. The Principal can reopen it in Settings.';
    end if;
    if tg_op = 'INSERT' and private.fin_locked(nd->>'openingDate') then
      raise exception 'That financial year is closed. The Principal can reopen it in Settings.';
    end if;
    return new;
  end if;

  if new.coll = 'moves' then
    if coalesce(nd->>'type', '') not in ('transfer', 'drawing', 'capital', 'income') then raise exception 'Unknown entry type'; end if;
    amt := coalesce((nd->>'amount')::numeric, 0);
    if amt <= 0 then raise exception 'Enter an amount above zero'; end if;
    if coalesce(nd->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Date is missing'; end if;
    if nd->>'type' in ('transfer', 'drawing') and not private.fin_acct_ok(nd->>'from') then raise exception 'Pick the account the money comes out of'; end if;
    if nd->>'type' in ('transfer', 'capital', 'income') and not private.fin_acct_ok(nd->>'to') then raise exception 'Pick the account the money goes into'; end if;
    if nd->>'type' = 'transfer' and nd->>'from' = nd->>'to' then raise exception 'A transfer needs two different accounts'; end if;
    if private.fin_locked(nd->>'date') or (od is not null and private.fin_locked(od->>'date')) then
      raise exception 'That financial year is closed. The Principal can reopen it in Settings.';
    end if;
    return new;
  end if;

  if new.coll = 'recons' then
    if not exists (select 1 from public.fin_docs where path = 'accounts/' || coalesce(nd->>'accountId', '')) then raise exception 'Account not found'; end if;
    if coalesce(nd->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Date is missing'; end if;
    if private.fin_locked(nd->>'date') or (od is not null and private.fin_locked(od->>'date')) then
      raise exception 'That financial year is closed. The Principal can reopen it in Settings.';
    end if;
    return new;
  end if;

  if new.coll = 'invoices' then
    nst := coalesce(nd->>'status', 'draft');
    if nst not in ('draft', 'issued', 'void') then raise exception 'Unknown invoice status'; end if;
    if coalesce(nd->>'mode', 'cash') not in ('cash', 'bank') then raise exception 'Invoice payment must be cash or bank'; end if;
    if coalesce((nd->>'amount')::numeric, -1) < 0 then raise exception 'Invoice amount is missing'; end if;
    if coalesce(nd->>'no', '') = '' then raise exception 'Invoice number is missing'; end if;
    if not exists (select 1 from public.fin_docs where path = 'projects/' || coalesce(nd->>'projectId', '')) then
      raise exception 'Invoice project not found';
    end if;
    if tg_op = 'INSERT' then
      if nst = 'void' then raise exception 'A new invoice can''t start as void'; end if;
      if private.fin_locked(nd->>'date') then raise exception 'That financial year is closed. The Principal can reopen it in Settings.'; end if;
      return new;
    end if;
    ost := coalesce(od->>'status', 'draft');
    if ost = 'void' then raise exception 'A voided invoice can''t be changed. Issue a new one.'; end if;
    if private.fin_locked(od->>'date') or private.fin_locked(nd->>'date') then
      raise exception 'That financial year is closed. The Principal can reopen it in Settings.';
    end if;
    if ost = 'draft' then
      return new;
    end if;
    if nst = 'draft' then raise exception 'An issued invoice can''t go back to draft. Void it and issue a corrected one.'; end if;
    allowed := array['status', 'due', 'note', 'voidReason', 'voidedOn', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'];
    for k in select jsonb_object_keys(od || nd) loop
      if not (k = any(allowed)) and (od->k) is distinct from (nd->k) then
        raise exception 'An issued invoice can''t be edited (%). Void it and issue a corrected one.', k;
      end if;
    end loop;
    if nst = 'void' and exists (select 1 from public.fin_docs where coll = 'receipts' and data->>'invoiceId' = new.doc_id) then
      raise exception 'This invoice has payments recorded. Remove them before voiding.';
    end if;
    return new;
  end if;

  if new.coll = 'receipts' then
    select data into inv from public.fin_docs where path = 'invoices/' || coalesce(nd->>'invoiceId', '');
    if inv is null then raise exception 'Payment invoice not found'; end if;
    if coalesce(inv->>'status', 'draft') <> 'issued' then raise exception 'Payments can only be recorded against an issued invoice'; end if;
    if not private.fin_acct_ok(nd->>'accountId') then raise exception 'Pick the cash or bank account the money went into'; end if;
    if coalesce(nd->>'mrNo', '') = '' then raise exception 'Money receipt number is missing'; end if;
    if coalesce((nd->>'received')::numeric, 0) < 0 or coalesce((nd->>'ait')::numeric, 0) < 0 or coalesce((nd->>'vds')::numeric, 0) < 0 then
      raise exception 'Amounts can''t be negative';
    end if;
    if coalesce((nd->>'received')::numeric, 0) + coalesce((nd->>'ait')::numeric, 0) + coalesce((nd->>'vds')::numeric, 0) <= 0 then
      raise exception 'Enter the amount received';
    end if;
    if private.fin_locked(nd->>'date') or (od is not null and private.fin_locked(od->>'date')) then
      raise exception 'That financial year is closed. The Principal can reopen it in Settings.';
    end if;
    select coalesce(sum(coalesce((data->>'received')::numeric, 0) + coalesce((data->>'ait')::numeric, 0) + coalesce((data->>'vds')::numeric, 0)), 0)
      into settled from public.fin_docs where coll = 'receipts' and data->>'invoiceId' = nd->>'invoiceId' and path <> new.path;
    if settled + coalesce((nd->>'received')::numeric, 0) + coalesce((nd->>'ait')::numeric, 0) + coalesce((nd->>'vds')::numeric, 0)
       > private.fin_inv_total(inv) + 1 then
      raise exception 'That is more than the invoice balance';
    end if;
    nd := nd || jsonb_build_object('projectId', inv->>'projectId');
    new.data := nd;
    return new;
  end if;
  return new;
end $$;
