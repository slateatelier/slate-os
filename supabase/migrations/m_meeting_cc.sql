-- Meeting minutes: "Share the minutes with (did not attend)" (1 Nov 2026).
--  * A meeting's minutes can be shared with people who were not there (data.cc), without recording them as attendees.
--  * They are told when the minutes are finalised, and anyone added to the list later is told when it is saved.
--  * Everything else in the meeting notifications stays exactly as it was.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

create or replace function private.docs_meeting_notify() returns trigger
language plpgsql security definer set search_path to '' as $function$
declare
  od jsonb := case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end;
  nd jsonb := new.data;
  actor text := coalesce(private.person_name(auth.uid()), 'SLATE OS');
  ttl text; body text; a text; was_sched boolean;
  ncc jsonb := case when jsonb_typeof(nd->'cc') = 'array' then nd->'cc' else '[]'::jsonb end;
  occ jsonb := case when jsonb_typeof(od->'cc') = 'array' then od->'cc' else '[]'::jsonb end;
begin
  if new.coll <> 'pmeetings' then return null; end if;
  begin
    ttl := coalesce(nullif(nd->>'title', ''), 'Meeting');
    body := concat_ws(E'\n', ttl, private.meeting_when(nd), case when new.project_id is not null then private.project_line(new.project_id) end);
    was_sched := coalesce(od->>'status', '') = 'scheduled';
    if nd->>'status' = 'scheduled' then
      for a in select jsonb_array_elements_text(case when jsonb_typeof(nd->'attendees') = 'array' then nd->'attendees' else '[]'::jsonb end) loop
        if not was_sched or not (case when jsonb_typeof(od->'attendees') = 'array' then od->'attendees' else '[]'::jsonb end) ? a then
          perform private.notify(private.as_uuid(a), 'meeting_invite', actor || ' invited you to a meeting', body);
        elsif (nd->>'date', nd->>'time', nd->>'venue') is distinct from (od->>'date', od->>'time', od->>'venue') then
          perform private.notify(private.as_uuid(a), 'meeting_changed',
            case when (nd->>'date', nd->>'time') is distinct from (od->>'date', od->>'time')
                 then 'Meeting moved by ' || actor || ': reply again' else 'Meeting details changed by ' || actor end, body);
        end if;
      end loop;
    elsif nd->>'status' = 'final' and coalesce(od->>'status', '') <> 'final' then
      perform private.notify(private.as_uuid(x.a), 'minutes_published', 'Minutes published by ' || actor,
        concat_ws(E'\n', body, nullif((select count(*) from jsonb_array_elements(case when jsonb_typeof(nd->'actions') = 'array' then nd->'actions' else '[]'::jsonb end) t
                                        where t->>'owner' = x.a), 0)::text || ' action(s) for you'))
      from jsonb_array_elements_text(case when jsonb_typeof(nd->'attendees') = 'array' then nd->'attendees' else '[]'::jsonb end) x(a);
      -- shared with people who were not there
      for a in select jsonb_array_elements_text(ncc) loop
        perform private.notify(private.as_uuid(a), 'minutes_published', 'Minutes shared with you by ' || actor, body);
      end loop;
    elsif nd->>'status' = 'final' then
      -- finalised minutes shared later with more people
      for a in select jsonb_array_elements_text(ncc) loop
        if not occ ? a then
          perform private.notify(private.as_uuid(a), 'minutes_published', 'Minutes shared with you by ' || actor, body);
        end if;
      end loop;
    elsif nd->>'status' = 'cancelled' and was_sched then
      for a in select jsonb_array_elements_text(case when jsonb_typeof(od->'attendees') = 'array' then od->'attendees' else '[]'::jsonb end) loop
        perform private.notify(private.as_uuid(a), 'meeting_cancelled', 'Meeting called off by ' || actor,
          concat_ws(E'\n', body, nullif(nd->>'cancelNote', '')));
      end loop;
    end if;
  exception when others then
    raise warning 'meeting notification skipped: %', sqlerrm;
  end;
  return null;
end $function$;

commit;
