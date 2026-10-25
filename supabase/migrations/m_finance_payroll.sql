-- SLATE OS · Finance stage 3: payroll.
-- staff: who is paid, with salary history (rates, each from a month) and cash or bank payment.
-- advances: salary advances and loans; the COO requests, the Principal approves, then it is paid from an account
--   and recovered from salaries a fixed amount at a time.
-- payruns: a month's salary sheet or an Eid bonus. The COO prepares and submits it, only the Principal approves it,
--   then it is paid in one step: cash lines from one account, bank lines from another. A paid sheet is final.

create or replace function private.fin_guard()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  uid uuid := auth.uid();
  role text := private.fin_role();
  od jsonb := case when tg_op in ('UPDATE', 'DELETE') then old.data else null end;
  nd jsonb;
  ost text; nst text; inv jsonb; settled numeric; k text; amt numeric; wo jsonb; ln jsonb; needc boolean; needb boolean; isp boolean := (uid is null or role = 'principal');
  allowed text[];
begin
  if uid is not null and coalesce(role, '') not in ('principal', 'coo') then
    raise exception 'Finance is limited to the Principal and the COO';
  end if;

  if tg_op = 'DELETE' then
    if old.coll = 'invoices' then
      if coalesce(od->>'status', 'draft') <> 'draft' then raise exception 'Issued invoices are never deleted. Void it instead.'; end if;
    elsif old.coll = 'expenses' then
      if not isp and coalesce(od->>'status', 'pending') <> 'pending' then raise exception 'Only the Principal can remove an expense after it has been decided'; end if;
      if private.fin_locked(od->>'date') or private.fin_locked(od->>'paidOn') then raise exception 'That financial year is closed. The Principal can reopen it in Settings.'; end if;
    elsif old.coll = 'workorders' then
      if exists (select 1 from public.fin_docs where coll = 'wopays' and data->>'woId' = old.doc_id) then raise exception 'This work order has payments, so it can''t be deleted. Cancel or close it instead.'; end if;
      if not isp and coalesce(od->>'status', 'pending') <> 'pending' then raise exception 'Only the Principal can remove a work order after it has been decided'; end if;
    elsif old.coll = 'staff' then
      if exists (select 1 from public.fin_docs where coll = 'advances' and data->>'staffId' = old.doc_id)
         or exists (select 1 from public.fin_docs r, jsonb_array_elements(coalesce(r.data->'lines', '[]'::jsonb)) l where r.coll = 'payruns' and l->>'staffId' = old.doc_id) then
        raise exception 'This person has salary or advance records, so they can''t be deleted. Mark them inactive instead.';
      end if;
    elsif old.coll = 'advances' then
      if not isp and coalesce(od->>'status', 'pending') <> 'pending' then raise exception 'Only the Principal can remove an advance after it has been decided'; end if;
      if private.fin_locked(od->>'date') or private.fin_locked(od->>'paidOn') then raise exception 'That financial year is closed. The Principal can reopen it in Settings.'; end if;
    elsif old.coll = 'payruns' then
      if coalesce(od->>'status', 'draft') = 'paid' then raise exception 'A paid salary sheet can''t be deleted'; end if;
      if not isp and coalesce(od->>'status', 'draft') not in ('draft', 'submitted') then raise exception 'Only the Principal can remove an approved salary sheet'; end if;
    elsif old.coll in ('receipts', 'moves', 'recons', 'wopays') then
      if private.fin_locked(od->>'date') then raise exception 'That financial year is closed. The Principal can reopen it in Settings.'; end if;
    elsif old.coll = 'projects' then
      if exists (select 1 from public.fin_docs where coll = 'invoices' and data->>'projectId' = old.doc_id) then
        raise exception 'This project has invoices, so it can''t be deleted. Mark it closed instead.';
      end if;
    elsif old.coll = 'accounts' then
      if exists (select 1 from public.fin_docs where (coll in ('receipts', 'recons') and data->>'accountId' = old.doc_id)
                 or (coll = 'moves' and (data->>'from' = old.doc_id or data->>'to' = old.doc_id))
                 or (coll in ('expenses', 'wopays', 'advances') and data->>'accountId' = old.doc_id)
                 or (coll = 'payruns' and (data->>'cashAccountId' = old.doc_id or data->>'bankAccountId' = old.doc_id))) then
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
  if new.coll not in ('projects', 'invoices', 'receipts', 'config', 'accounts', 'moves', 'recons', 'expenses', 'workorders', 'wopays', 'staff', 'advances', 'payruns') then
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

  if new.coll = 'expenses' then
    nst := coalesce(nd->>'status', 'pending'); ost := coalesce(od->>'status', 'pending');
    if nst not in ('pending', 'approved', 'rejected') then raise exception 'Unknown expense status'; end if;
    if coalesce(nd->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Date is missing'; end if;
    if coalesce(nd->>'category', '') = '' or coalesce(nd->>'desc', '') = '' then raise exception 'An expense needs a category and a description'; end if;
    if coalesce((nd->>'amount')::numeric, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
    if not isp then
      if tg_op = 'INSERT' and nst <> 'pending' then raise exception 'Only the Principal approves expenses'; end if;
      if tg_op = 'UPDATE' and nst <> ost then raise exception 'Only the Principal approves or rejects expenses'; end if;
      if tg_op = 'UPDATE' and ost <> 'pending' then
        allowed := array['accountId', 'paidOn', 'method', 'ref', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'];
        for k in select jsonb_object_keys(od || nd) loop
          if not (k = any(allowed)) and (od->k) is distinct from (nd->k) then
            raise exception 'This expense has been decided, so only its payment can be recorded. Ask the Principal to change it.';
          end if;
        end loop;
      end if;
    end if;
    if coalesce(nd->>'accountId', '') <> '' then
      if nst = 'rejected' then raise exception 'A rejected expense can''t be paid'; end if;
      if not private.fin_acct_ok(nd->>'accountId') and (od is null or (od->>'accountId') is distinct from (nd->>'accountId')) then raise exception 'Pick the account it was paid from'; end if;
      if coalesce(nd->>'paidOn', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Payment date is missing'; end if;
    end if;
    if private.fin_locked(nd->>'date') or private.fin_locked(nd->>'paidOn') or (od is not null and (private.fin_locked(od->>'date') or private.fin_locked(od->>'paidOn'))) then
      raise exception 'That financial year is closed. The Principal can reopen it in Settings.';
    end if;
    return new;
  end if;

  if new.coll = 'workorders' then
    nst := coalesce(nd->>'status', 'pending'); ost := coalesce(od->>'status', 'pending');
    if nst not in ('pending', 'approved', 'rejected', 'closed') then raise exception 'Unknown work order status'; end if;
    if coalesce(nd->>'no', '') = '' or coalesce(nd->>'vendor', '') = '' then raise exception 'A work order needs a number and a vendor'; end if;
    if coalesce(nd->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Date is missing'; end if;
    amt := coalesce((nd->>'amount')::numeric, 0);
    if amt <= 0 then raise exception 'Enter the work order value'; end if;
    if not isp then
      if tg_op = 'INSERT' and nst <> 'pending' then raise exception 'Only the Principal approves work orders'; end if;
      if tg_op = 'UPDATE' and nst <> ost then raise exception 'Only the Principal approves, rejects or closes work orders'; end if;
      if tg_op = 'UPDATE' and ost <> 'pending' then
        allowed := array['note', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'];
        for k in select jsonb_object_keys(od || nd) loop
          if not (k = any(allowed)) and (od->k) is distinct from (nd->k) then
            raise exception 'This work order has been decided. Ask the Principal to change it.';
          end if;
        end loop;
      end if;
    end if;
    select coalesce(sum((data->>'gross')::numeric), 0) into settled from public.fin_docs where coll = 'wopays' and data->>'woId' = new.doc_id;
    if amt + 1 < settled then raise exception 'The value can''t be less than what has already been paid against it'; end if;
    if tg_op = 'INSERT' and private.fin_locked(nd->>'date') then raise exception 'That financial year is closed. The Principal can reopen it in Settings.'; end if;
    return new;
  end if;

  if new.coll = 'wopays' then
    select data into wo from public.fin_docs where path = 'workorders/' || coalesce(nd->>'woId', '');
    if wo is null then raise exception 'Work order not found'; end if;
    if coalesce(wo->>'status', '') <> 'approved' then raise exception 'Payments can only be made against an approved work order'; end if;
    if not private.fin_acct_ok(nd->>'accountId') then raise exception 'Pick the account it was paid from'; end if;
    if coalesce(nd->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Date is missing'; end if;
    amt := coalesce((nd->>'gross')::numeric, 0);
    if amt <= 0 then raise exception 'Enter the amount being settled'; end if;
    if coalesce((nd->>'ait')::numeric, 0) < 0 or coalesce((nd->>'vds')::numeric, 0) < 0 then raise exception 'Amounts can''t be negative'; end if;
    if coalesce((nd->>'ait')::numeric, 0) + coalesce((nd->>'vds')::numeric, 0) > amt then raise exception 'Tax deducted can''t be more than the amount settled'; end if;
    select coalesce(sum((data->>'gross')::numeric), 0) into settled from public.fin_docs where coll = 'wopays' and data->>'woId' = nd->>'woId' and path <> new.path;
    if settled + amt > coalesce((wo->>'amount')::numeric, 0) + 1 then raise exception 'That is more than what is left on the work order'; end if;
    if private.fin_locked(nd->>'date') or (od is not null and private.fin_locked(od->>'date')) then
      raise exception 'That financial year is closed. The Principal can reopen it in Settings.';
    end if;
    nd := nd || jsonb_build_object('paid', amt - coalesce((nd->>'ait')::numeric, 0) - coalesce((nd->>'vds')::numeric, 0), 'projectId', wo->>'projectId');
    new.data := nd;
    return new;
  end if;

  if new.coll = 'staff' then
    if coalesce(nd->>'name', '') = '' then raise exception 'A staff member needs a name'; end if;
    if coalesce(nd->>'payMethod', 'cash') not in ('cash', 'bank') then raise exception 'Salary is paid in cash or to a bank account'; end if;
    if jsonb_typeof(nd->'rates') <> 'array' or jsonb_array_length(nd->'rates') = 0 then raise exception 'Enter the salary'; end if;
    if exists (select 1 from jsonb_array_elements(nd->'rates') r where coalesce(r->>'from', '') !~ '^\d{4}-\d{2}$'
               or least(coalesce((r->>'basic')::numeric, 0), coalesce((r->>'house')::numeric, 0), coalesce((r->>'medical')::numeric, 0),
                        coalesce((r->>'conv')::numeric, 0), coalesce((r->>'other')::numeric, 0), coalesce((r->>'tax')::numeric, 0)) < 0) then
      raise exception 'Salary amounts can''t be negative, and each change needs the month it starts';
    end if;
    return new;
  end if;

  if new.coll = 'advances' then
    nst := coalesce(nd->>'status', 'pending'); ost := coalesce(od->>'status', 'pending');
    if nst not in ('pending', 'approved', 'rejected') then raise exception 'Unknown advance status'; end if;
    if not exists (select 1 from public.fin_docs where path = 'staff/' || coalesce(nd->>'staffId', '')) then raise exception 'Staff member not found'; end if;
    if coalesce(nd->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Date is missing'; end if;
    amt := coalesce((nd->>'amount')::numeric, 0);
    if amt <= 0 then raise exception 'Enter the advance amount'; end if;
    if coalesce((nd->>'installment')::numeric, 0) <= 0 or (nd->>'installment')::numeric > amt then raise exception 'The monthly recovery must be above zero and no more than the advance'; end if;
    if not isp then
      if tg_op = 'INSERT' and nst <> 'pending' then raise exception 'Only the Principal approves advances'; end if;
      if tg_op = 'UPDATE' and nst <> ost then raise exception 'Only the Principal approves or rejects advances'; end if;
      if tg_op = 'UPDATE' and ost <> 'pending' then
        allowed := array['accountId', 'paidOn', 'ref', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'];
        for k in select jsonb_object_keys(od || nd) loop
          if not (k = any(allowed)) and (od->k) is distinct from (nd->k) then raise exception 'This advance has been decided, so only its payment can be recorded.'; end if;
        end loop;
      end if;
    end if;
    if coalesce(nd->>'accountId', '') <> '' then
      if nst <> 'approved' then raise exception 'An advance is paid only after the Principal approves it'; end if;
      if not private.fin_acct_ok(nd->>'accountId') and (od is null or (od->>'accountId') is distinct from (nd->>'accountId')) then raise exception 'Pick the account it was paid from'; end if;
      if coalesce(nd->>'paidOn', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Payment date is missing'; end if;
    end if;
    if private.fin_locked(nd->>'date') or private.fin_locked(nd->>'paidOn') or (od is not null and (private.fin_locked(od->>'date') or private.fin_locked(od->>'paidOn'))) then
      raise exception 'That financial year is closed. The Principal can reopen it in Settings.';
    end if;
    return new;
  end if;

  if new.coll = 'payruns' then
    nst := coalesce(nd->>'status', 'draft'); ost := coalesce(od->>'status', 'draft');
    if nst not in ('draft', 'submitted', 'approved', 'paid') then raise exception 'Unknown salary sheet status'; end if;
    if coalesce(nd->>'kind', '') not in ('salary', 'bonus') then raise exception 'A sheet is either salary or bonus'; end if;
    if coalesce(nd->>'month', '') !~ '^\d{4}-\d{2}$' then raise exception 'Month is missing'; end if;
    if jsonb_typeof(nd->'lines') <> 'array' then raise exception 'The sheet has no lines'; end if;
    if exists (select 1 from jsonb_array_elements(nd->'lines') l where not exists (select 1 from public.fin_docs s where s.path = 'staff/' || coalesce(l->>'staffId', ''))
               or coalesce((l->>'net')::numeric, 0) < 0) then
      raise exception 'Every line needs a staff member, and no one can be paid less than zero';
    end if;
    if ost = 'paid' and not isp then raise exception 'This sheet has been paid and is final'; end if;
    if ost = 'paid' and nst = 'paid' then
      for k in select jsonb_object_keys(od || nd) loop
        if k not in ('note', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy') and (od->k) is distinct from (nd->k) then raise exception 'This sheet has been paid and is final. Mark it unpaid first.'; end if;
      end loop;
    end if;
    if not isp then
      if nst = 'approved' and ost <> 'approved' then raise exception 'Only the Principal approves salary sheets'; end if;
      if ost = 'approved' then
        if nst not in ('approved', 'paid') then raise exception 'Only the Principal can reopen an approved sheet'; end if;
        allowed := array['status', 'payDate', 'cashAccountId', 'bankAccountId', 'payRef', 'note', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'];
        for k in select jsonb_object_keys(od || nd) loop
          if not (k = any(allowed)) and (od->k) is distinct from (nd->k) then raise exception 'This sheet has been approved; only its payment can be recorded'; end if;
        end loop;
      end if;
      if tg_op = 'INSERT' and nst not in ('draft', 'submitted') then raise exception 'Only the Principal approves salary sheets'; end if;
    end if;
    if nst = 'paid' then
      if ost not in ('approved', 'paid') and not isp then raise exception 'A sheet is paid only after the Principal approves it'; end if;
      if coalesce(nd->>'payDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Payment date is missing'; end if;
      select bool_or(coalesce(l->>'method', 'cash') = 'cash' and coalesce((l->>'net')::numeric, 0) > 0),
             bool_or(l->>'method' = 'bank' and coalesce((l->>'net')::numeric, 0) > 0) into needc, needb
        from jsonb_array_elements(nd->'lines') l;
      if coalesce(needc, false) and (coalesce(nd->>'cashAccountId', '') = '' or (not private.fin_acct_ok(nd->>'cashAccountId') and (od is null or (od->>'cashAccountId') is distinct from (nd->>'cashAccountId')))) then raise exception 'Pick the account cash salaries come out of'; end if;
      if coalesce(needb, false) and (coalesce(nd->>'bankAccountId', '') = '' or (not private.fin_acct_ok(nd->>'bankAccountId') and (od is null or (od->>'bankAccountId') is distinct from (nd->>'bankAccountId')))) then raise exception 'Pick the account bank salaries come out of'; end if;
    end if;
    if private.fin_locked(nd->>'payDate') or (od is not null and private.fin_locked(od->>'payDate'))
       or private.fin_locked((nd->>'month') || '-01') then
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
