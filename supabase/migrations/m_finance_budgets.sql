-- SLATE OS · Finance stage 5: budgets (one record per financial year, budgets/FY2026, monthly amount per category).
-- Only the Principal sets or removes a budget. Applied as an in-place edit of private.fin_guard.
do $mig$
declare d text := pg_get_functiondef('private.fin_guard'::regproc);
  o1 text := '''wopays'', ''staff'', ''advances'', ''payruns'') then';
  n1 text := '''wopays'', ''staff'', ''advances'', ''payruns'', ''budgets'') then';
  o2 text := '    elsif old.path = ''config/settings'' then';
  n2 text := '    elsif old.coll = ''budgets'' then
      if not isp then raise exception ''Only the Principal sets budgets''; end if;
    elsif old.path = ''config/settings'' then';
  o3 text := '  if new.coll = ''invoices'' then';
  n3 text := '  if new.coll = ''budgets'' then
    if not isp then raise exception ''Only the Principal sets budgets''; end if;
    if new.doc_id !~ ''^FY\d{4}$'' then raise exception ''A budget is kept per financial year''; end if;
    if jsonb_typeof(nd->''lines'') <> ''object'' then raise exception ''The budget has no lines''; end if;
    if exists (select 1 from jsonb_each_text(nd->''lines'') x where coalesce(x.value, ''0'')::numeric < 0) then raise exception ''Budget amounts can''''t be negative''; end if;
    return new;
  end if;
  if new.coll = ''invoices'' then';
begin
  if position(o1 in d) = 0 or position(o2 in d) = 0 or position(o3 in d) = 0 then raise exception 'pattern not found'; end if;
  d := replace(replace(replace(d, o1, n1), o2, n2), o3, n3);
  execute d;
end $mig$;
