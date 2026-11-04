-- Drafting Pool: see every active project, and each other's tasks (4 Nov 2026)
-- The Drafting Pool works for every POD, so Design Associates (not only the Design Associate Lead) can pick any
-- active project in the day plan. Chalk Create projects stay out, as for the lead.
-- Design Associates also see tasks given to anyone in the Drafting Pool, so the day plan can suggest
-- "Drafting Pool tasks" and list the projects the pool is working on first.
-- They still don't see POD members' tasks on those projects.
-- Same bodies as live on 4 Nov 2026, with design_associate added. Safe to run more than once.

create or replace function private.can_see_project_doc(pid text)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_approver() or private.has_pod_view_doc(pid)
      or private.member_ok(pid, auth.uid())
      or exists (select 1 from public.docs p where p.path = 'projects/' || pid and coalesce(p.data->>'status', 'active') = 'active'
                 and p.data->>'type' in ('studioops','studiodev','studiomgmt') and private.is_active()
                 and not private.is_chalk_person(auth.uid()))
      or exists (select 1 from public.docs t where t.coll = 'tasks' and t.project_id = pid and t.assignee = auth.uid())
      or (private.my_designation() in ('design_associate_lead', 'design_associate') and private.is_active()
          and exists (select 1 from public.docs p where p.path = 'projects/' || pid and coalesce(p.data->>'status', 'active') = 'active'
                      and lower(trim(coalesce(p.data->>'pod', ''))) <> 'chalk create'))
      or (private.is_chalk_lead() and private.is_chalk_project(pid))
$$;

create or replace function private.can_see_task_doc(p_private boolean, p_assignee uuid, pid text)
returns boolean language sql stable security definer set search_path to '' as $$
  select case
    when p_private then private.is_owner() or private.is_coo() or p_assignee = auth.uid()
    else private.is_approver()
      or p_assignee = auth.uid()
      or private.has_pod_view_doc(pid, p_assignee)
      or private.member_ok(pid, auth.uid())
      or (private.my_designation() = 'design_associate_lead'
          and exists (select 1 from public.profiles a where a.id = p_assignee and a.designation = 'design_associate'))
      or (private.my_designation() = 'design_associate' and private.is_active()
          and exists (select 1 from public.profiles a where a.id = p_assignee and a.active
                      and a.designation in ('design_associate', 'design_associate_lead')))
      or (private.is_chalk_lead() and private.is_chalk_project(pid))
  end
$$;
