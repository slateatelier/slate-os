-- SLATE OS · project timeline / client clock (28 Oct 2026)
-- A POD leader sets the timeline and the client's review days; only the Principal or the COO confirms deemed approval (D7),
-- approves an at-risk start (R5) or changes SLATE days; nobody changes the original plan once it is set (R4).
-- Run in Supabase › SQL Editor. Safe to run more than once.
do $mig$
declare d text;
  anchor text := $o$          raise exception 'Only the Principal or COO changes a project''s pace';
        end if;$o$;
begin
  d := pg_get_functiondef('private.docs_guard'::regproc);
  if position('changes the original timeline' in d) = 0 then
    if position(anchor in d) = 0 then raise exception 'docs_guard has changed; update this migration'; end if;
    d := replace(d, anchor, anchor || $n$
        if (nd->'std'->'deemed') is distinct from (od->'std'->'deemed') or (nd->'std'->'risk') is distinct from (od->'std'->'risk') then
          raise exception 'Only the Principal or the COO confirms a deemed approval or an at-risk start';
        end if;
        if (nd->'std'->'sd') is distinct from (od->'std'->'sd') then
          raise exception 'Only the Principal or the COO changes SLATE days';
        end if;
        if coalesce(od->'std'->'tl'->>'start', '') <> '' and ((nd->'std'->'tl'->'base') is distinct from (od->'std'->'tl'->'base')
            or (nd->'std'->'tl'->>'start') is distinct from (od->'std'->'tl'->>'start')) then
          raise exception 'Nobody changes the original timeline once it is set';
        end if;$n$);
    execute d;
  end if;
end $mig$;
