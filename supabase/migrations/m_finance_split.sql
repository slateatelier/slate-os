-- SLATE OS · Finance: split payments.
-- A client payment can arrive partly in cash and partly in the bank: receipts may carry parts
--   [{accountId, amount}] that add up to the amount received (one money receipt, several accounts).
-- A salary can be paid partly to the bank and the rest in cash: payroll lines with method 'split' carry bankAmt.
-- Applied as an in-place edit of private.fin_guard.
do $mig$
declare d text := pg_get_functiondef('private.fin_guard'::regproc);
  o1 text := '    if not private.fin_acct_ok(nd->>''accountId'') then raise exception ''Pick the cash or bank account the money went into''; end if;';
  n1 text := '    if jsonb_typeof(nd->''parts'') = ''array'' and jsonb_array_length(nd->''parts'') > 0 then
      if exists (select 1 from jsonb_array_elements(nd->''parts'') x where not private.fin_acct_ok(x->>''accountId'') or coalesce((x->>''amount'')::numeric, 0) <= 0) then
        raise exception ''Each part of the payment needs an active account and an amount'';
      end if;
      if abs((select sum((x->>''amount'')::numeric) from jsonb_array_elements(nd->''parts'') x) - coalesce((nd->>''received'')::numeric, 0)) > 1 then
        raise exception ''The parts must add up to the amount received'';
      end if;
    elsif not private.fin_acct_ok(nd->>''accountId'') then raise exception ''Pick the cash or bank account the money went into''; end if;';
  o2 text := '      select bool_or(coalesce(l->>''method'', ''cash'') = ''cash'' and coalesce((l->>''net'')::numeric, 0) > 0),
             bool_or(l->>''method'' = ''bank'' and coalesce((l->>''net'')::numeric, 0) > 0) into needc, needb
        from jsonb_array_elements(nd->''lines'') l;';
  n2 text := '      select bool_or(case coalesce(l->>''method'', ''cash'') when ''cash'' then coalesce((l->>''net'')::numeric, 0) when ''split'' then coalesce((l->>''net'')::numeric, 0) - least(coalesce((l->>''net'')::numeric, 0), coalesce((l->>''bankAmt'')::numeric, 0)) else 0 end > 0),
             bool_or(case l->>''method'' when ''bank'' then coalesce((l->>''net'')::numeric, 0) when ''split'' then least(coalesce((l->>''net'')::numeric, 0), coalesce((l->>''bankAmt'')::numeric, 0)) else 0 end > 0) into needc, needb
        from jsonb_array_elements(nd->''lines'') l;';
  o3 text := '(coll in (''receipts'', ''recons'') and data->>''accountId'' = old.doc_id)';
  n3 text := '(coll in (''receipts'', ''recons'') and data->>''accountId'' = old.doc_id)
                 or (coll = ''receipts'' and data->''parts'' @> jsonb_build_array(jsonb_build_object(''accountId'', old.doc_id)))';
begin
  if position(o1 in d) = 0 then raise exception 'receipt pattern not found'; end if;
  if position(o2 in d) = 0 then raise exception 'payroll pattern not found'; end if;
  if position(o3 in d) = 0 then raise exception 'account pattern not found'; end if;
  execute replace(replace(replace(d, o1, n1), o2, n2), o3, n3);
end $mig$;

-- Staff may be paid 'split' (bankPart to the bank each month, the rest in cash).
do $mig$
declare d text := pg_get_functiondef('private.fin_guard'::regproc);
  o text := 'if coalesce(nd->>''payMethod'', ''cash'') not in (''cash'', ''bank'') then raise exception ''Salary is paid in cash or to a bank account''; end if;';
  n text := 'if coalesce(nd->>''payMethod'', ''cash'') not in (''cash'', ''bank'', ''split'') then raise exception ''Salary is paid in cash, to a bank account, or split between them''; end if;
    if nd->>''payMethod'' = ''split'' and coalesce((nd->>''bankPart'')::numeric, 0) <= 0 then raise exception ''Enter how much of the salary goes to the bank''; end if;';
begin
  if position(o in d) = 0 then raise exception 'pattern not found'; end if;
  execute replace(d, o, n);
end $mig$;
