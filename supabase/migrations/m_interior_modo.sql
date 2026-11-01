-- MODO interior projects (1 Nov 2026). Data only; nothing about the structure changes.
--  * The Principal's decision: interior projects are their own category ("Interior design", tagged MODO),
--    with their own phases (I0 Brief and survey to I5 Execution and handover) and their own project details.
--  * Moves the 7 interior projects now filed as "Private client" (every project whose name ends in "(INTERIOR)"):
--    Desdemona C9, C10, C11, D5, F11, Edison Hermia B7 and Titania A-5. None of them has phases or tasks yet.
--  * Fills the building and unit from the name (e.g. DESDEMONA C10 (INTERIOR) -> building DESDEMONA, unit C10).
--    Area, rooms, type of space and execution are left for the POD leader or COO to add in Edit project.
--  * Project codes, names, clients, fees and everything else stay as they are.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

update public.docs
set data = data
  || jsonb_build_object('type', 'interior')
  || case when coalesce(data->>'intBuilding', '') = '' then jsonb_build_object('intBuilding',
       trim(regexp_replace(regexp_replace(data->>'name', '\s*\(INTERIOR\)\s*$', '', 'i'), '\s+\S+$', ''))) else '{}'::jsonb end
  || case when coalesce(data->>'intUnit', '') = '' then jsonb_build_object('intUnit',
       substring(regexp_replace(data->>'name', '\s*\(INTERIOR\)\s*$', '', 'i') from '(\S+)$')) else '{}'::jsonb end
where coll = 'projects'
  and data->>'name' ~* '\(INTERIOR\)\s*$'
  and coalesce(data->>'type', '') = 'private'
  and data->'std' is null;

commit;
