-- Chalk Create: a separate SBU inside SLATE OS.
-- Its lead (ticked by the Principal) and the Principal assign Chalk work; no COO approval.
-- The COO can view and edit Chalk work but never assigns Chalk people. SLATE staff do not see Chalk.

alter table public.profiles add column if not exists is_chalk_lead boolean not null default false;

create or replace function private.is_chalk_lead()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and is_chalk_lead)
$$;
create or replace function private.is_chalk_person(p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p is not null and exists (select 1 from public.profiles where id = p and team = 'Chalk Create')
$$;
create or replace function private.is_chalk_project(pid text)
returns boolean language sql stable security definer set search_path = '' as $$
  select pid is not null and exists (select 1 from public.docs where path = 'projects/' || pid and data->>'pod' = 'Chalk Create')
$$;

-- who can read a project: the Chalk lead sees Chalk projects; the drafting lead no longer sees them
create or replace function private.can_see_project_doc(pid text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approver() or private.has_pod_view_doc(pid)
      or exists (select 1 from public.docs t where t.coll = 'tasks' and t.project_id = pid and t.assignee = auth.uid())
      or (private.my_designation() = 'design_associate_lead'
          and exists (select 1 from public.docs p where p.path = 'projects/' || pid and coalesce(p.data->>'status', 'active') = 'active'
                      and coalesce(p.data->>'pod', '') <> 'Chalk Create'))
      or (private.is_chalk_lead() and private.is_chalk_project(pid))
$$;
create or replace function private.can_see_task_doc(p_private boolean, p_assignee uuid, pid text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_private then private.is_owner() or p_assignee = auth.uid()
    else private.is_approver()
      or p_assignee = auth.uid()
      or private.has_pod_view_doc(pid, p_assignee)
      or (private.my_designation() = 'design_associate_lead'
          and exists (select 1 from public.profiles a where a.id = p_assignee and a.designation = 'design_associate'))
      or (private.is_chalk_lead() and private.is_chalk_project(pid))
  end
$$;

-- people settings: only the Principal ticks the Chalk lead
create or replace function public.apply_roster(p_patch jsonb)
returns void language plpgsql set search_path = '' as $$
declare k text; v jsonb;
begin
  if p_patch ? 'roster' then
    for k, v in select * from jsonb_each(p_patch->'roster') loop
      update public.profiles set
        team       = case when v ? 'team' then nullif(v->>'team', '') else team end,
        team_at    = case when v ? 'teamAt' then (v->>'teamAt')::timestamptz when v ? 'team' then now() else team_at end,
        role_label = case when v ? 'role' then nullif(v->>'role', '') else role_label end,
        label      = case when v ? 'label' then nullif(v->>'label', '') else label end
      where id = private.as_uuid(k);
    end loop;
  end if;
  if p_patch ? 'managers' then
    update public.profiles set is_manager = (id::text in (select jsonb_array_elements_text(p_patch->'managers')))
    where is_manager is distinct from (id::text in (select jsonb_array_elements_text(p_patch->'managers')));
  end if;
  if p_patch ? 'approvers' then
    update public.profiles set is_approver = (id::text in (select jsonb_array_elements_text(p_patch->'approvers')))
    where is_approver is distinct from (id::text in (select jsonb_array_elements_text(p_patch->'approvers')));
  end if;
  if p_patch ? 'privateIds' then
    update public.profiles set is_private = (id::text in (select jsonb_array_elements_text(p_patch->'privateIds')))
    where is_private is distinct from (id::text in (select jsonb_array_elements_text(p_patch->'privateIds')));
  end if;
  if p_patch ? 'chalkLeads' then
    update public.profiles set is_chalk_lead = (id::text in (select jsonb_array_elements_text(p_patch->'chalkLeads')))
    where is_chalk_lead is distinct from (id::text in (select jsonb_array_elements_text(p_patch->'chalkLeads')));
  end if;
end $$;

do $do$
declare def text;
begin
  -- profiles guard: the Chalk lead tick is the Principal's alone
  def := pg_get_functiondef('private.guard_profiles'::regproc);
  if position('is_chalk_lead' in def) = 0 then
    def := replace(def, '(new.designation, new.role_label, new.is_manager, new.is_approver, new.is_private)',
                        '(new.designation, new.role_label, new.is_manager, new.is_approver, new.is_private, new.is_chalk_lead)');
    def := replace(def, '(old.designation, old.role_label, old.is_manager, old.is_approver, old.is_private)',
                        '(old.designation, old.role_label, old.is_manager, old.is_approver, old.is_private, old.is_chalk_lead)');
    if position('new.is_chalk_lead' in def) = 0 then raise exception 'guard_profiles anchor not found'; end if;
    execute def;
  end if;

  -- project codes: Chalk projects are CHK-<number>
  def := pg_get_functiondef('private.project_code'::regproc);
  if position('Chalk Create' in def) = 0 then
    def := replace(def, $a$  if d->>'pod' = 'Studio' then$a$,
                        $b$  if d->>'pod' = 'Chalk Create' then
    return 'CHK-' || p_no;
  end if;
  if d->>'pod' = 'Studio' then$b$);
    if position('CHK-' in def) = 0 then raise exception 'project_code anchor not found'; end if;
    execute def;
  end if;

  -- write rules
  def := pg_get_functiondef('private.docs_guard'::regproc);
  if position('Chalk Create' in def) = 0 then
    def := replace(def, $a$  ch text[]; k text; ph text; pr public.profiles; my_pod_id text; is_dlead boolean; req_ok boolean;$a$,
                        $b$  ch text[]; k text; ph text; pr public.profiles; my_pod_id text; is_dlead boolean; req_ok boolean; chalk boolean;$b$);
    def := replace(def, $a$  ch := private.changed_keys(od, nd);
$a$, $b$  ch := private.changed_keys(od, nd);

  -- Chalk Create: run by its lead and the Principal. The COO can view and edit, but never assigns Chalk work.
  if rw.coll in ('projects','tasks','pmeetings') and tg_op <> 'DELETE' then
    chalk := case when rw.coll = 'projects' then coalesce(nd->>'pod', '') = 'Chalk Create' or coalesce(od->>'pod', '') = 'Chalk Create'
                  else private.is_chalk_project(new.project_id) or (tg_op = 'UPDATE' and private.is_chalk_project(old.project_id)) end;
    if rw.coll = 'tasks' and new.assignee is not null and (tg_op = 'INSERT' or new.assignee is distinct from old.assignee) then
      if private.is_chalk_person(new.assignee) and not is_own and not (chalk and private.is_chalk_lead()) then
        raise exception 'Only the Principal and the Chalk Create lead assign work to Chalk Create';
      end if;
      if chalk and not is_own and not (private.is_chalk_person(new.assignee)
            or exists (select 1 from public.profiles x where x.id = new.assignee and x.is_chalk_lead)) then
        raise exception 'Chalk Create work goes to Chalk Create people';
      end if;
      if chalk and is_appr and not is_own and not private.is_chalk_lead() then
        raise exception 'Only the Principal and the Chalk Create lead assign Chalk work';
      end if;
    end if;
    if chalk then
      if rw.coll = 'projects' and tg_op = 'UPDATE' and not is_own
         and (coalesce(nd->>'pod', '') = 'Chalk Create') <> (coalesce(od->>'pod', '') = 'Chalk Create') then
        raise exception 'Only the Principal moves a project in or out of Chalk Create';
      end if;
      if rw.coll = 'tasks' and not private.history_appends(od->'history', nd->'history') then
        raise exception 'Task history is append-only';
      end if;
      if is_own or is_appr or private.is_chalk_lead() then return new; end if;
      -- Chalk members carry on under the normal rules for their own tasks (done, stage, date requests)
    end if;
  end if;
$b$);
    if position('Chalk Create lead' in def) = 0 then raise exception 'docs_guard anchor not found'; end if;
    execute def;
  end if;
end $do$;

-- date requests and assignment requests on Chalk work go to the Chalk lead and the Principal, not the COO
create or replace function private.notify_route(p_project text, p_kind text, p_title text, p_body text, p_principal_only boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  if private.is_chalk_project(p_project) then
    for u in select id from public.profiles where active and (designation = 'principal' or is_chalk_lead) loop
      perform private.notify(u, p_kind, p_title, p_body);
    end loop;
  else
    perform private.notify_approvers(p_kind, p_title, p_body, p_principal_only);
  end if;
end $$;

do $do$
declare def text;
begin
  def := pg_get_functiondef('private.docs_notify'::regproc);
  if position('notify_route' in def) = 0 then
    def := replace(def, $a$perform private.notify_approvers('assign_request',$a$, $b$perform private.notify_route(new.project_id, 'assign_request',$b$);
    def := replace(def, $a$perform private.notify_approvers('date_request',$a$, $b$perform private.notify_route(new.project_id, 'date_request',$b$);
    if position('notify_route(new.project_id, ''date_request''' in def) = 0 then raise exception 'docs_notify anchor not found'; end if;
    execute def;
  end if;
end $do$;
