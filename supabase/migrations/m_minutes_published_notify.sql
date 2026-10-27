-- SLATE OS · minutes published → every attendee is told (27 Oct 2026)
-- * Weekly meeting: when the COO publishes the minutes, everyone marked present or late gets a notification
--   (the organiser already got one; the COO, as the one publishing, is skipped).
-- * Project, studio and other meetings: when the minutes are finalised, every SLATE attendee gets a notification,
--   with how many actions are theirs. Saving final minutes again does not repeat it.
-- The app shows the same news on Home and in the bell; these rows drive the phone alert.
-- Both functions are patched at a fixed anchor so the rest of each stays exactly as it is.

do $mig$
declare src text;
  w_old text := $a$perform private.notify(private.as_uuid(nd->>'organiser'), 'minutes_published', 'Minutes published by ' || actor, body);$a$;
  w_new text := $b$perform private.notify(private.as_uuid(nd->>'organiser'), 'minutes_published', 'Minutes published by ' || actor, body);
      perform private.notify(private.as_uuid(x.a), 'minutes_published', 'Minutes published by ' || actor, body || E'\nYou attended this meeting')
      from jsonb_array_elements_text(case when jsonb_typeof(nd->'attendees') = 'array' then nd->'attendees' else '[]'::jsonb end) x(a)
      where x.a is distinct from nd->>'organiser';$b$;
  p_old text := $c$    elsif nd->>'status' = 'cancelled' and was_sched then$c$;
  p_new text := $d$    elsif nd->>'status' = 'final' and coalesce(od->>'status', '') <> 'final' then
      perform private.notify(private.as_uuid(x.a), 'minutes_published', 'Minutes published by ' || actor,
        concat_ws(E'\n', body, nullif((select count(*) from jsonb_array_elements(case when jsonb_typeof(nd->'actions') = 'array' then nd->'actions' else '[]'::jsonb end) t
                                        where t->>'owner' = x.a), 0)::text || ' action(s) for you'))
      from jsonb_array_elements_text(case when jsonb_typeof(nd->'attendees') = 'array' then nd->'attendees' else '[]'::jsonb end) x(a);
    elsif nd->>'status' = 'cancelled' and was_sched then$d$;
begin
  select pg_get_functiondef('private.docs_notify'::regproc) into src;
  if position(w_new in src) = 0 then
    if position(w_old in src) = 0 then raise exception 'docs_notify anchor not found'; end if;
    execute replace(src, w_old, w_new);
  end if;

  select pg_get_functiondef('private.docs_meeting_notify'::regproc) into src;
  if position($e$nd->>'status' = 'final' and coalesce(od->>'status', '') <> 'final'$e$ in src) = 0 then
    if position(p_old in src) = 0 then raise exception 'docs_meeting_notify anchor not found'; end if;
    execute replace(src, p_old, p_new);
  end if;
end $mig$;
