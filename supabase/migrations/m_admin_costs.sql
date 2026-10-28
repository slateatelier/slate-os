-- SLATE OS · Admin costs (28 Oct 2026)
-- Monthly running costs of the studio (office rent, electricity, internet, cleaning …), set in SLATE OS › Business › Admin
-- and kept in Finance as recurring/<id>, so Finance's cash forecast uses them. Office rent can carry an advance adjusted a
-- little each month and a security deposit. Only the Principal and the COO can see or change them (the Accountant cannot).
-- Run in Supabase › SQL Editor. Safe to run more than once.
do $mig$
declare d text;
begin
  d := pg_get_functiondef('private.fin_guard'::regproc);
  if position($o$'clients', 'recurring')$o$ in d) = 0 then
    if position($o$'budgets', 'intakes', 'clients')$o$ in d) = 0 or position($o$  if new.coll = 'config' then$o$ in d) = 0 then
      raise exception 'fin_guard has changed; update this migration';
    end if;
    d := replace(d, $o$'budgets', 'intakes', 'clients')$o$, $o$'budgets', 'intakes', 'clients', 'recurring')$o$);
    d := replace(d, $o$  if new.coll = 'config' then$o$, $n$  if new.coll = 'recurring' then
    if coalesce(nd->>'name', '') = '' then raise exception 'A running cost needs a name'; end if;
    if coalesce(nd->>'kind', '') not in ('fixed', 'variable', 'rent') then raise exception 'Unknown kind of running cost'; end if;
    if least(coalesce((nd->>'amount')::numeric, 0), coalesce((nd->>'rent')::numeric, 0), coalesce((nd->>'advance')::numeric, 0),
             coalesce((nd->>'adjust')::numeric, 0), coalesce((nd->>'deposit')::numeric, 0)) < 0 then raise exception 'Amounts can''t be negative'; end if;
    if coalesce(nd->>'from', '') !~ '^\d{4}-\d{2}$' then raise exception 'Choose the month it starts'; end if;
    return new;
  end if;
  if new.coll = 'config' then$n$);
    execute d;
  end if;
end $mig$;
