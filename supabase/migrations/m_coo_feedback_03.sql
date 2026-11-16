-- SLATE OS · COO feedback 03 (16 Nov 2026). Data only; no rules change.
-- 1. Archive / Done did nothing on "Fix project dates before scoring starts (6 items)": the task was saved in the shared
--    task list although it belongs to the COO, whose tasks are private. The database refuses every change to such a task
--    ("Tasks for this person are private; only the Principal assigns them"). It moves to the COO's private list
--    (lead/<COO>/tasks/<same id>), unchanged otherwise, so Done and Archive work again. It is the only such task (checked
--    16 Nov 2026); the step also catches any other task on a private person, if one has appeared since.
-- 2. Administration area:
--  * New studio area STUDIO ADMINISTRATION (type studioadmin) for running the office: IT, assets, facilities, rent,
--    utilities, ID cards, supplies. Like HR and Finance it is not open to the team: only the Principal, the COO
--    and anyone with a task in it can see it (private.can_see_project_doc already works this way for new types).
--  * The COO's office tasks that went into STUDIO TASKS when she picked "Operation" move into it:
--    ID card for employees, meeting room keyboard & mouse, IT inventory list, CC camera, foam for door/window seal.
--    Titles, people, dates, history and points are unchanged; a "moved" line is added to each task's history.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.
-- To check first which tasks will move, run only the SELECT at the bottom.

begin;

-- 1. private people's tasks out of the shared list
-- (coll, parent, doc_id, project_id and assignee are filled in from the path by docs_derive)
insert into public.docs (path, data, created_by, created_at)
select 'lead/' || d.assignee::text || '/tasks/' || d.doc_id, d.data, d.created_by, d.created_at
from public.docs d join public.profiles p on p.id = d.assignee
where d.coll = 'tasks' and p.is_private
on conflict (path) do nothing;

delete from public.docs d using public.profiles p
where p.id = d.assignee and d.coll = 'tasks' and p.is_private
  and exists (select 1 from public.docs l where l.path = 'lead/' || d.assignee::text || '/tasks/' || d.doc_id);

-- 2. Administration area

insert into public.docs (path, coll, doc_id, data)
select 'projects/studioAdmArea0001', 'projects', 'studioAdmArea0001',
  jsonb_build_object('name', 'STUDIO ADMINISTRATION', 'type', 'studioadmin', 'pod', 'Studio', 'pod2', '', 'pods', '[]'::jsonb,
    'katha', '', 'client', '', 'location', '', 'agStatus', 'internal', 'scope', '[]'::jsonb,
    'note', 'Studio work: running the office (IT, assets, facilities, rent, utilities, supplies)',
    'closed', false, 'status', 'active',
    'createdAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'createdBy', d.data->>'createdBy',
    'approvedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'approvedBy', d.data->>'approvedBy')
from (select data from public.docs where path = 'projects/studioDevArea0001') d
where not exists (select 1 from public.docs x where x.coll = 'projects' and x.data->>'type' = 'studioadmin')
on conflict (path) do nothing;

update public.docs
set data = data || jsonb_build_object('projectId',
      (select x.doc_id from public.docs x where x.coll = 'projects' and x.data->>'type' = 'studioadmin' order by x.created_at limit 1),
      'history', coalesce(data->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', '9700a1d6-577a-4168-8a39-25f55f8cc2fc',
        'type', 'moved', 'note', 'Moved into STUDIO ADMINISTRATION from STUDIO TASKS')))
where coll in ('tasks', 'lead') and project_id = 'studioOpsArea0001'
  -- (if the app already made the area before this ran, that one is used)
  and assignee in (select id from public.profiles where designation = 'coo' and active)
  and (data->>'title' ilike 'ID CARD%' or data->>'title' ilike 'MEETING ROOM KEYBOARD%' or data->>'title' ilike 'IT INVENTORY%'
       or data->>'title' ilike 'CC CAMERA%' or data->>'title' ilike 'FOAM FOR DOOR%');

commit;

-- Check (run alone, before or after):
-- select coll, doc_id, data->>'title' as title, project_id from public.docs
-- where coll in ('tasks','lead') and (data->>'title' ilike 'ID CARD%' or data->>'title' ilike 'MEETING ROOM KEYBOARD%'
--   or data->>'title' ilike 'IT INVENTORY%' or data->>'title' ilike 'CC CAMERA%' or data->>'title' ilike 'FOAM FOR DOOR%');
