-- SLATE OS · construction support (28 Oct 2026)
-- 1. A project's POD leader may start construction support and mark the building handed over (project key 'support').
-- 2. On-call site visits, drawing corrections and the handover billing check are flagged unscored and leave the dashboard's scores.
-- Run in Supabase › SQL Editor. Safe to run more than once.
do $mig$
declare d text;
  anchor text := $o$      elsif k = 'type' then
        if not (is_lead and coalesce(od->>'type', '') = '') then raise exception 'Only the Principal or COO changes a project''s type'; end if;$o$;
begin
  d := pg_get_functiondef('private.docs_guard'::regproc);
  if position('elsif k = ''support'' then' in d) = 0 then
    if position(anchor in d) = 0 then raise exception 'docs_guard has changed; update this migration'; end if;
    d := replace(d, anchor, $n$      elsif k = 'support' then
        if not is_lead then raise exception 'Only the project''s pod leader or the COO records construction support'; end if;
$n$ || anchor);
    execute d;
  end if;
end $mig$;

do $mig$
declare d text;
  anchor text := $o$    and coalesce((t.data->>'legacy')::boolean, false) = false$o$;
begin
  d := pg_get_functiondef('public.dash_rows'::regproc);
  if position('unscored' in d) = 0 then
    if position(anchor in d) = 0 then raise exception 'dash_rows has changed; update this migration'; end if;
    d := replace(d, anchor, anchor || $n$
    and coalesce((t.data->>'unscored')::boolean, false) = false$n$);
    execute d;
  end if;
end $mig$;

-- 3. Clients dashboard: the Principal and the COO keep each client's type and priority in Finance (clients/<key>).
do $mig$
declare d text;
  anchor text := $o$'budgets', 'intakes') then$o$;
begin
  d := pg_get_functiondef('private.fin_guard'::regproc);
  if position($o$'intakes', 'clients')$o$ in d) = 0 then
    if position(anchor in d) = 0 then raise exception 'fin_guard has changed; update this migration'; end if;
    d := replace(d, anchor, $n$'budgets', 'intakes', 'clients') then$n$);
    execute d;
  end if;
end $mig$;
