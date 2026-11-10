-- Shared junior architects (10 Nov 2026, Principal's decision)
-- Ratri and Rafi (and Mahi's replacement when they join) belong to no POD: team "Shared (all PODs)".
-- * They see every live POD project and its tasks (not Chalk Create).
-- * Every POD leader gives them work directly on the POD's own projects, sets and approves its dates,
--   and checks it. The COO is not in the daily path.
-- * POD leaders see their day plans; a mentor (a POD leader) sees their whole day log.
-- * shared_load(): each shared person's open work per POD (counts and dates only) for POD leaders.
-- * 11:00: no plan -> the person, and the POD leader whose project they last worked on (or the mentor).
-- * Overload: 8 or more open tasks due in the next 7 days (or late) -> the COO, once a week per person.

alter table public.profiles add column if not exists mentor_id uuid references public.profiles(id) on delete set null;

create or replace function private.is_shared_member(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p is not null and exists (select 1 from public.profiles x where x.id = p and x.active
                                   and coalesce(x.team, '') ilike 'shared%'
                                   and x.designation not in ('principal', 'coo'))
$$;

-- roster sync: a mentor set in Settings/HR reaches profiles.mentor_id
create or replace function public.apply_roster(p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare k text; v jsonb;
begin
  if p_patch ? 'roster' then
    for k, v in select * from jsonb_each(p_patch->'roster') loop
      update public.profiles set
        team       = case when v ? 'team' then nullif(v->>'team', '') else team end,
        team_at    = case when v ? 'teamAt' then (v->>'teamAt')::timestamptz when v ? 'team' then now() else team_at end,
        role_label = case when v ? 'role' then nullif(v->>'role', '') else role_label end,
        label      = case when v ? 'label' then nullif(v->>'label', '') else label end,
        mentor_id  = case when v ? 'mentor' then private.as_uuid(nullif(v->>'mentor', '')) else mentor_id end
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

-- projects: shared architects see every live project except Chalk Create (as the Drafting Pool)
create or replace function private.can_see_project_doc(pid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_approver() or private.has_pod_view_doc(pid)
      or private.member_ok(pid, auth.uid())
      or exists (select 1 from public.docs p where p.path = 'projects/' || pid and coalesce(p.data->>'status', 'active') = 'active'
                 and p.data->>'type' in ('studioops','studiodev','studiomgmt') and private.is_active()
                 and not private.is_chalk_person(auth.uid()))
      or exists (select 1 from public.docs t where t.coll = 'tasks' and t.project_id = pid and t.assignee = auth.uid())
      or ((private.my_designation() in ('design_associate_lead', 'design_associate') or private.is_shared_member(auth.uid()))
          and private.is_active()
          and exists (select 1 from public.docs p where p.path = 'projects/' || pid and coalesce(p.data->>'status', 'active') = 'active'
                      and lower(trim(coalesce(p.data->>'pod', ''))) <> 'chalk create'))
      or (private.is_chalk_lead() and private.is_chalk_project(pid))
$$;

-- tasks: shared architects see the tasks of every POD project (as a POD junior sees their POD's);
-- POD leaders see a shared architect's tasks on their own POD's projects (already through has_pod_view_doc)
create or replace function private.can_see_task_doc(p_private boolean, p_assignee uuid, pid text) returns boolean
language sql stable security definer set search_path = '' as $$
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
      or (private.is_shared_member(auth.uid()) and pid is not null and cardinality(private.project_pods_of(pid)) > 0
          and not private.is_chalk_project(pid))
      or (private.is_chalk_lead() and private.is_chalk_project(pid))
  end
$$;

-- day log: POD leaders see the shared architects' plans (the app shows only the lines on their POD's projects);
-- the mentor sees the mentee's
create or replace function private.can_see_work_log(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user = auth.uid()
      or private.is_top() or private.is_approver()
      or (private.is_pod_leader() and exists (
            select 1 from public.profiles a where a.id = p_user and a.pod_id is not null and a.pod_id = private.my_pod()))
      or (private.is_pod_leader() and private.is_shared_member(p_user))
      or exists (select 1 from public.profiles a where a.id = p_user and a.mentor_id = auth.uid())
      or exists (
            select 1 from public.profiles me, public.profiles a
             where me.id = auth.uid() and a.id = p_user and me.active
               and coalesce(me.team, '') ilike 'drafting%' and a.team = me.team
               and (me.designation = 'design_associate_lead' or me.is_manager))
$$;

-- task rules: the project's POD leader gives work to a shared architect directly, sets its dates,
-- approves their date requests and checks the work
do $mig$
declare def text; n int := 0;
  reps text[][] := array[
    array['and (a.pod_id is not distinct from my_pod_id or private.is_drafting_member(a.id))));',
          'and (a.pod_id is not distinct from my_pod_id or private.is_drafting_member(a.id) or private.is_shared_member(a.id))));'],
    array['or (is_dlead and private.is_drafting_member(new.assignee))) then',
          'or (is_dlead and private.is_drafting_member(new.assignee))
              or (private.leads_doc(new.project_id) and private.is_shared_member(new.assignee))) then'],
    array['if coalesce(nd->>''target'', '''') <> '''' and not private.lead_window() then',
          'if coalesce(nd->>''target'', '''') <> '''' and not private.lead_window() and not private.is_shared_member(new.assignee) then'],
    array['and not private.is_drafting_member(new.assignee) /* da_drafting_assign */ then',
          'and not private.is_drafting_member(new.assignee) /* da_drafting_assign */ and not private.is_shared_member(new.assignee) then'],
    array['if not (is_lead and private.lead_window()) then raise exception',
          'if not (is_lead and (private.lead_window() or private.is_shared_member(old.assignee))) then raise exception'],
    array['and not private.is_drafting_member(new.assignee) then',
          'and not private.is_drafting_member(new.assignee) and not private.is_shared_member(new.assignee) then']
  ];
  i int;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'private' and p.proname = 'docs_guard';
  if position('is_shared_member' in def) > 0 then raise notice 'docs_guard already updated'; return; end if;
  for i in 1 .. array_length(reps, 1) loop
    if position(reps[i][1] in def) = 0 then raise exception 'docs_guard: text % not found', i; end if;
    def := overlay(def placing reps[i][2] from position(reps[i][1] in def) for length(reps[i][1]));
    n := n + 1;
  end loop;
  execute def;
  raise notice 'docs_guard: % changes', n;
end $mig$;

-- each shared architect's open work by POD: counts and dates only, for POD leaders, the Principal and the COO
create or replace function public.shared_load()
returns table (user_id uuid, pod text, open_n int, due7_n int, next_due text, last_due text)
language sql stable security definer set search_path = '' as $$
  with d as (select to_char((now() at time zone 'Asia/Dhaka')::date, 'YYYY-MM-DD') t,
                    to_char((now() at time zone 'Asia/Dhaka')::date + 7, 'YYYY-MM-DD') t7)
  select x.assignee, coalesce((private.project_pods_of(x.project_id))[1], 'Studio') pod,
         count(*)::int,
         count(*) filter (where coalesce(x.data->>'target', '') <> '' and x.data->>'target' <= d.t7)::int,
         min(nullif(x.data->>'target', '')) filter (where x.data->>'target' >= d.t),
         max(nullif(x.data->>'target', ''))
    from public.docs x, d
   where (private.is_top() or private.is_pod_leader())
     and x.coll = 'tasks' and private.is_shared_member(x.assignee)
     and coalesce(x.data->>'doneAt', '') = '' and not coalesce((x.data->>'archived')::boolean, false)
     and not x.is_private
   group by x.assignee, 2
$$;
revoke all on function public.shared_load() from public, anon;
grant execute on function public.shared_load() to authenticated;

-- 11:00 reminders: shared architects too; their missing plan goes to the POD leader whose project they last
-- worked on (or the mentor); the COO hears once a week when one is overloaded
create or replace function private.work_log_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'Asia/Dhaka')::date; r record; wk text := to_char((now() at time zone 'Asia/Dhaka')::date, 'IYYY-IW');
begin
  -- holidays in Settings
  if exists (select 1 from public.docs s, jsonb_array_elements(case when jsonb_typeof(s.data->'holidays') = 'array' then s.data->'holidays' else '[]'::jsonb end) x
              where s.path = 'config/settings' and x->>'d' = to_char(d, 'YYYY-MM-DD')) then return; end if;
  -- each person in a POD, the Drafting Pool or the shared architects without a plan
  insert into public.notifications (user_id, kind, title, body, task_ref)
  select p.id, 'plan_missing', 'Write today''s plan',
         'Which projects and tasks are you working on today? Open SLATE OS and write your plan.',
         'plan:' || p.id || '@' || d
    from public.profiles p
   where p.active
     and ((p.pod_id is not null and coalesce(p.team, '') ilike 'pod%') or coalesce(p.team, '') ilike 'drafting%'
          or private.is_shared_member(p.id))
     and not private.is_reviewer_id(p.id)
     and not exists (select 1 from public.work_logs w where w.user_id = p.id and w.day = d)
     and not exists (select 1 from public.notifications n where n.user_id = p.id and n.task_ref = 'plan:' || p.id || '@' || d);
  -- each POD leader: who in the POD hasn't written it
  for r in
    select l.id lead_id, string_agg(coalesce(nullif(m.full_name, ''), 'Someone'), ', ' order by m.full_name) names
      from public.profiles l
      join public.profiles m on m.pod_id = l.pod_id and m.id <> l.id and m.active
     where l.active and l.pod_id is not null and (l.designation = 'pod_leader' or l.is_manager)
       and not private.is_reviewer_id(m.id)
       and not exists (select 1 from public.work_logs w where w.user_id = m.id and w.day = d)
     group by l.id
  loop
    insert into public.notifications (user_id, kind, title, body, task_ref)
    select r.lead_id, 'plan_missing_pod', 'No plan yet in your POD', 'Not written by 11:00: ' || r.names || '.', 'planpod:' || r.lead_id || '@' || d
     where not exists (select 1 from public.notifications n where n.user_id = r.lead_id and n.task_ref = 'planpod:' || r.lead_id || '@' || d);
  end loop;
  -- the Design Associate Lead: who in the Drafting Pool hasn't written it
  for r in
    select l.id lead_id, string_agg(coalesce(nullif(m.full_name, ''), 'Someone'), ', ' order by m.full_name) names
      from public.profiles l
      join public.profiles m on m.team = l.team and m.id <> l.id and m.active
     where l.active and coalesce(l.team, '') ilike 'drafting%' and (l.designation = 'design_associate_lead' or l.is_manager)
       and not private.is_reviewer_id(m.id)
       and not exists (select 1 from public.work_logs w where w.user_id = m.id and w.day = d)
     group by l.id
  loop
    insert into public.notifications (user_id, kind, title, body, task_ref)
    select r.lead_id, 'plan_missing_pod', 'No plan yet in the Drafting Pool', 'Not written by 11:00: ' || r.names || '.', 'planpod:' || r.lead_id || '@' || d
     where not exists (select 1 from public.notifications n where n.user_id = r.lead_id and n.task_ref = 'planpod:' || r.lead_id || '@' || d);
  end loop;
  -- shared architects: the POD leader whose project they last worked on, else the mentor
  for r in
    with s as (
      select m.id, coalesce(nullif(m.full_name, ''), 'Someone') nm, m.mentor_id,
             (select ln->>'projectId' from public.work_logs w, jsonb_array_elements(w.lines) with ordinality e(ln, o)
               where w.user_id = m.id and w.day < d and coalesce(ln->>'projectId', '') <> ''
               order by w.day desc, e.o desc limit 1) last_pid
        from public.profiles m
       where private.is_shared_member(m.id) and not private.is_reviewer_id(m.id)
         and not exists (select 1 from public.work_logs w where w.user_id = m.id and w.day = d))
    select coalesce(
             (select l.id from public.profiles l
               where l.active and l.pod_id is not null and (l.designation = 'pod_leader' or l.is_manager)
                 and s.last_pid is not null and l.pod_id = any(private.project_pods_of(s.last_pid))
               order by l.designation = 'pod_leader' desc limit 1),
             s.mentor_id) lead_id,
           string_agg(s.nm, ', ' order by s.nm) names
      from s group by 1
  loop
    continue when r.lead_id is null;
    insert into public.notifications (user_id, kind, title, body, task_ref)
    select r.lead_id, 'plan_missing_pod', 'No plan yet: shared architect', 'Not written by 11:00: ' || r.names || '.', 'planshared:' || r.lead_id || '@' || d
     where not exists (select 1 from public.notifications n where n.user_id = r.lead_id and n.task_ref = 'planshared:' || r.lead_id || '@' || d);
  end loop;
  -- overload: 8 or more open tasks due in the next 7 days -> the COO, once a week per person
  for r in
    select x.assignee id, coalesce(nullif(m.full_name, ''), 'A shared architect') nm, count(*) n
      from public.docs x join public.profiles m on m.id = x.assignee
     where x.coll = 'tasks' and private.is_shared_member(x.assignee) and not x.is_private
       and coalesce(x.data->>'doneAt', '') = '' and not coalesce((x.data->>'archived')::boolean, false)
       and coalesce(x.data->>'target', '') <> '' and x.data->>'target' <= to_char(d + 7, 'YYYY-MM-DD')
     group by 1, 2 having count(*) >= 8
  loop
    insert into public.notifications (user_id, kind, title, body, task_ref)
    select c.id, 'shared_overload', 'Shared architect overloaded: ' || r.nm,
           r.nm || ' has ' || r.n || ' open tasks due within 7 days or already late, across the PODs. Check with the POD leaders.',
           'sharedload:' || r.id || '@' || wk
      from public.profiles c
     where c.active and c.designation = 'coo'
       and not exists (select 1 from public.notifications n where n.user_id = c.id and n.task_ref = 'sharedload:' || r.id || '@' || wk);
  end loop;
end $$;

-- "No task today? Ask…": a shared architect's request goes to their mentor
do $mig$
declare def text; a text := 'or (p.team = me.team and (p.designation in (''pod_leader'', ''design_associate_lead'') or p.is_manager))));';
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='private' and p.proname='work_logs_ask';
  if position('mentor_id' in def) > 0 then return; end if;
  if position(a in def) = 0 then raise exception 'work_logs_ask: text not found'; end if;
  def := replace(def, a, 'or (p.team = me.team and (p.designation in (''pod_leader'', ''design_associate_lead'') or p.is_manager))
              or exists (select 1 from public.profiles mm where mm.id = new.user_id and mm.mentor_id = p.id)));');
  execute def;
end $mig$;

-- Ratri (mentor Akib) and Rafi (mentor Zamiul) become shared (applied by Claude, 10 Nov 2026)
-- update public.profiles set team = 'Shared (all PODs)', team_at = now(), mentor_id = '7ea68786-a39f-4d70-9c12-e63e0541d660' where id = '46ef88f2-f8a2-4803-b8b1-70a9c0636fc3';
-- update public.profiles set team = 'Shared (all PODs)', team_at = now(), mentor_id = '0b30474f-8f74-4817-bbc5-8d0c9bacc394' where id = '9d87a575-bab6-422c-8d02-a8bbda18232a';
