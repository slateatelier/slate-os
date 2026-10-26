-- SLATE OS · Meetings tab + HR and Finance studio areas (26 Oct 2026), applied as meetings_hub_1_hr_fin_areas … meetings_hub_4_notify (+ cron job)
-- * Two new studio-work areas, HR (studiohr, code HRM-…) and Finance (studiofin, code FIN-…), each with its area project.
--   Like Business development they are not open to everyone: the Principal, the COO, people with a task there or approved members.
-- * pmeetings now also holds studio meetings (in an area project) and "other" meetings (no project),
--   and meetings scheduled ahead (status 'scheduled', with time and venue) or called off (status 'cancelled').
--   A meeting with no project can be set up by anyone and changed only by whoever set it up (or the Principal / COO).
--   Attendees and whoever set a meeting up can always read it.
-- * Invites: attendees are notified when a meeting is scheduled, moved or called off, and 30 minutes before it starts.

-- 1. project codes for the new areas
create or replace function private.project_code(d jsonb, p_no text)
 returns text language plpgsql immutable set search_path to ''
as $$
declare k numeric; size text; parts text[]; pre text;
begin
  if lower(trim(coalesce(d->>'pod', ''))) = 'chalk create' then
    return 'CHK-' || p_no;
  end if;
  pre := case d->>'type' when 'studioops' then 'OPS' when 'studiodev' then 'DEV' when 'studiomgmt' then 'MGT' when 'studiobd' then 'BIZ'
                         when 'studiohr' then 'HRM' when 'studiofin' then 'FIN' else null end;
  if pre is not null then
    return left(pre || '-' || coalesce(nullif(upper(left(regexp_replace(coalesce(d->>'name', ''), '[^A-Za-z]', '', 'g'), 4)), ''), 'STU') || '-' || p_no, 24);
  end if;
  if d->>'pod' = 'Studio' then
    return left('STU-' || coalesce(nullif(upper(left(regexp_replace(coalesce(d->>'name', ''), '[^A-Za-z]', '', 'g'), 4)), ''), 'INT') || '-' || p_no, 24);
  end if;
  k := nullif(regexp_replace(coalesce(d->>'katha', ''), '[^0-9.]', '', 'g'), '')::numeric;
  size := case when k is null or k = 0 then null
               when k = trunc(k) then trunc(k)::text || 'K'
               else trim(trailing '0' from round(k, 2)::text) || 'K' end;
  parts := array_remove(array[private.area_code(coalesce(nullif(d->>'location', ''), d->>'name')),
                              private.plot_code(d->>'name', d->>'location'), size, p_no], null);
  return left(array_to_string(parts, '-'), 24);
end $$;

-- 2. the two area projects
insert into public.docs (path, coll, doc_id, data)
select 'projects/' || x.id, 'projects', x.id,
  jsonb_build_object('name', x.nm, 'type', x.tp, 'pod', 'Studio', 'pod2', '', 'pods', '[]'::jsonb,
    'katha', '', 'client', '', 'location', '', 'agStatus', 'internal', 'scope', '[]'::jsonb, 'note', x.note,
    'closed', false, 'status', 'active', 'createdAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'createdBy', d.data->>'createdBy',
    'approvedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'approvedBy', d.data->>'approvedBy')
from (values ('studioHrArea00001', 'STUDIO HR', 'studiohr', 'Studio work: people, recruitment, onboarding, leave, appraisals and policies'),
             ('studioFinArea0001', 'STUDIO FINANCE', 'studiofin', 'Studio work: billing follow-up, collections, budgets, payroll and compliance')) x(id, nm, tp, note)
cross join (select data from public.docs where path = 'projects/studioDevArea0001') d
on conflict (path) do nothing;

-- 3. meetings without a project: set up by anyone, changed by whoever set them up
do $mig$
declare src text; anchor text := $a$    if not private.can_see_project_doc(new.project_id) then
      raise exception 'Not one of your projects';$a$;
begin
  select pg_get_functiondef('private.docs_guard'::regproc) into src;
  if position('Only the person who set up this meeting' in src) = 0 then
    if position(anchor in src) = 0 then raise exception 'docs_guard anchor not found'; end if;
    src := replace(src, anchor, $b$    if new.project_id is null and (tg_op = 'INSERT' or old.project_id is null) then
      if tg_op = 'INSERT' or old.created_by = uid then return new; end if;
      raise exception 'Only the person who set up this meeting changes it';
    end if;
$b$ || anchor);
    execute src;
  end if;
end $mig$;

-- 4. attendees and whoever set a meeting up can read it; the organiser can update it
alter policy docs_select on public.docs using (
CASE coll
    WHEN 'tasks'::text THEN (private.can_see_task_doc(false, assignee, project_id) OR (created_by = ( SELECT auth.uid() AS uid)) OR ((( SELECT private.my_designation() AS my_designation) = 'design_associate_lead'::designation) AND private.is_drafting_member(private.as_uuid(((data -> 'assignReq'::text) ->> 'to'::text)))))
    WHEN 'lead'::text THEN private.can_see_task_doc(true, assignee, project_id)
    WHEN 'projects'::text THEN (private.can_see_project_doc(doc_id) OR (created_by = ( SELECT auth.uid() AS uid)))
    WHEN 'pmeetings'::text THEN (private.can_see_project_doc(project_id) OR (created_by = ( SELECT auth.uid() AS uid))
                                 OR (jsonb_typeof(data -> 'attendees') = 'array' AND (data -> 'attendees') ? (( SELECT auth.uid() AS uid))::text))
    WHEN 'farlog'::text THEN ((parent = (( SELECT auth.uid() AS uid))::text) OR ( SELECT private.is_approver() AS is_approver))
    WHEN 'data'::text THEN (parent = (( SELECT auth.uid() AS uid))::text)
    WHEN 'rolereq'::text THEN ( SELECT private.is_approver() AS is_approver)
    WHEN 'podreq'::text THEN ((parent = (( SELECT auth.uid() AS uid))::text) OR ( SELECT private.is_approver() AS is_approver))
    WHEN 'agreements'::text THEN ( SELECT private.is_approver() AS is_approver)
    ELSE true
END);
alter policy docs_update on public.docs using (
CASE coll
    WHEN 'tasks'::text THEN (private.can_see_task_doc(false, assignee, project_id) OR (created_by = ( SELECT auth.uid() AS uid)) OR ((( SELECT private.my_designation() AS my_designation) = 'design_associate_lead'::designation) AND private.is_drafting_member(private.as_uuid(((data -> 'assignReq'::text) ->> 'to'::text)))))
    WHEN 'lead'::text THEN private.can_see_task_doc(true, assignee, project_id)
    WHEN 'projects'::text THEN (private.can_see_project_doc(doc_id) OR (created_by = ( SELECT auth.uid() AS uid)))
    WHEN 'pmeetings'::text THEN (private.can_see_project_doc(project_id) OR (created_by = ( SELECT auth.uid() AS uid)))
    WHEN 'agreements'::text THEN ( SELECT private.is_approver() AS is_approver)
    ELSE true
END);

-- 5. invites, changes and call-offs
create or replace function private.meeting_when(d jsonb)
returns text language plpgsql stable set search_path to '' as $$
declare t text := '';
begin
  begin
    if coalesce(d->>'time', '') ~ '^\d{1,2}:\d{2}' then t := ', ' || trim(to_char((d->>'time')::time, 'FMHH12:MI AM')); end if;
  exception when others then t := ''; end;
  return concat_ws(' · ', private.fmt_d(d->>'date') || t, nullif(d->>'venue', ''));
end $$;

create or replace function private.docs_meeting_notify()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  od jsonb := case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end;
  nd jsonb := new.data;
  actor text := coalesce(private.person_name(auth.uid()), 'SLATE OS');
  ttl text; body text; a text; was_sched boolean;
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
          perform private.notify(private.as_uuid(a), 'meeting_changed', 'Meeting moved by ' || actor, body);
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
end $$;
create or replace trigger h_docs_meeting_notify after insert or update on public.docs
  for each row when (new.coll = 'pmeetings') execute function private.docs_meeting_notify();

-- 6. a reminder 30 minutes before a scheduled meeting (once per person, per date and time)
create or replace function private.meeting_reminders()
returns void language plpgsql security definer set search_path to '' as $$
begin
  insert into public.notifications (user_id, kind, title, body, task_ref)
  select pr.id, 'meeting_soon', left('In 30 minutes: ' || coalesce(nullif(m.data->>'title', ''), 'Meeting'), 90),
         left(concat_ws(E'\n', private.meeting_when(m.data), case when m.project_id is not null then private.project_line(m.project_id) end), 320),
         m.path || '@' || (m.data->>'date') || ' ' || (m.data->>'time')
  from public.docs m
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(m.data->'attendees') = 'array' then m.data->'attendees' else '[]'::jsonb end) a(uid)
  join public.profiles pr on pr.id = private.as_uuid(a.uid) and pr.active
  where m.coll = 'pmeetings' and m.data->>'status' = 'scheduled'
    and coalesce(m.data->>'time', '') ~ '^\d{1,2}:\d{2}$' and coalesce(m.data->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
    and (((m.data->>'date') || ' ' || (m.data->>'time'))::timestamp at time zone 'Asia/Dhaka') between now() and now() + interval '31 minutes'
    and not exists (select 1 from public.notifications n where n.user_id = pr.id and n.kind = 'meeting_soon'
                    and n.task_ref = m.path || '@' || (m.data->>'date') || ' ' || (m.data->>'time'));
end $$;
select cron.schedule('slate-meeting-reminders', '*/5 * * * *', 'select private.meeting_reminders()');
