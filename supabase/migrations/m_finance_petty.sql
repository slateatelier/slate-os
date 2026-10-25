-- SLATE OS · Finance stage 4: petty cash.
-- A petty cash box is an account of its own kind ('petty') with a fixed float (imprest). Top-ups are transfers
-- from the office vault; bills are ordinary expenses paid from the box, so the Principal still approves them.
-- Applied as an in-place edit of private.fin_guard (the rest of the function is unchanged from m_finance_payroll.sql).
do $mig$
declare d text := pg_get_functiondef('private.fin_guard'::regproc);
  o text := 'if coalesce(nd->>''kind'', '''') not in (''cash'', ''bank'', ''mfs'') then raise exception ''Account type must be cash, bank or mobile wallet''; end if;';
  n text := 'if coalesce(nd->>''kind'', '''') not in (''cash'', ''bank'', ''mfs'', ''petty'') then raise exception ''Account type must be cash, bank, mobile wallet or petty cash''; end if;
    if nd->>''kind'' = ''petty'' and coalesce((nd->>''float'')::numeric, 0) < 0 then raise exception ''The petty cash float can''''t be negative''; end if;';
begin
  if position(o in d) = 0 then raise exception 'pattern not found'; end if;
  execute replace(d, o, n);
end $mig$;
