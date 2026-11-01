-- One list for the team's studio jobs: STUDIO TASKS (1 Nov 2026). Data only; nothing about the structure changes.
--  * The Principal's decision: studio work is not a project. Every studio job the team (POD leaders, members, drafting)
--    has goes into one list, STUDIO TASKS. The Principal and the COO still see the areas (Management, Development,
--    Business development, HR, Finance) as filters; nobody else does.
--  * "STUDIO OPERATION" is renamed "STUDIO TASKS" (its code and its tasks stay).
--  * The team's tasks in Studio Development, Studio Management and Studio Business development move into STUDIO TASKS
--    (16 tasks today). Task titles, people, dates, history and points are unchanged.
--  * The Principal's and the COO's own tasks (kept privately) stay where they are; HR and Finance are not touched.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

update public.docs set data = data || '{"name":"STUDIO TASKS"}'::jsonb
where coll = 'projects' and doc_id = 'studioOpsArea0001';

update public.docs
set project_id = 'studioOpsArea0001',
    data = data || jsonb_build_object('projectId', 'studioOpsArea0001',
      'history', coalesce(data->'history','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'at', now(), 'by', '9700a1d6-577a-4168-8a39-25f55f8cc2fc', 'type', 'moved',
        'note', 'Moved into STUDIO TASKS from ' || coalesce((select p.data->>'name' from public.docs p where p.coll = 'projects' and p.doc_id = public.docs.project_id), 'a studio area'))))
where coll = 'tasks' and project_id in ('studioDevArea0001', 'studioMgmtArea01', 'studioBizArea0001');

commit;
