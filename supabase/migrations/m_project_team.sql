-- SLATE OS · project team (25 Oct 2026)
-- Studio operation / Development / Management project types can hold several pods and named people.
-- Any project's pod leader can ask to add people: another pod's members join as temporary members,
-- drafting-pool and other support people join for good. The COO (or the Principal) approves each one.
-- Approved members see the project and its tasks, and can be given its tasks directly.
-- Also: tasks made from a Principal/COO message, and weekly-meeting organiser hand-over and attendance.

-- every pod on a project: pod, pod2 and the pods list (studio-work projects)
create or replace function private.project_pods_of(pid text)
 returns text[] language sql stable security definer set search_path to ''
as $$
  select coalesce((
    select array(select distinct x from unnest(
             array[nullif(d.data->>'pod', ''), nullif(d.data->>'pod2', '')]
             || coalesce((select array_agg(e) from jsonb_array_elements_text(
                  case when jsonb_typeof(d.data->'pods') = 'array' then d.data->'pods' else '[]'::jsonb end) e), '{}'::text[])) x
           where x is not null and x <> '' and x <> 'Studio')
      from public.docs d where d.path = 'projects/' || pid), '{}'::text[])
$$;

-- an approved, current member of an active project (temporary members lapse after their end date)
create or replace function private.member_ok(pid text, p uuid)
 returns boolean language sql stable security definer set search_path to ''
as $$
  select pid is not null and p is not null and exists (
    select 1 from public.docs d
     where d.path = 'projects/' || pid
       and coalesce(d.data->>'status', 'active') = 'active'
       and jsonb_typeof(d.data->'members'->(p::text)) = 'object'
       and d.data->'members'->(p::text)->>'status' = 'approved'
       and coalesce(nullif(d.data->'members'->(p::text)->>'until', ''), '9999-12-31')
           >= to_char((now() at time zone 'Asia/Dhaka')::date, 'YYYY-MM-DD'))
$$;

create or replace function private.can_see_project_doc(pid text)
 returns boolean language sql stable security definer set search_path to ''
as $$
  select private.is_approver() or private.has_pod_view_doc(pid)
      or private.member_ok(pid, auth.uid())
      or exists (select 1 from public.docs t where t.coll = 'tasks' and t.project_id = pid and t.assignee = auth.uid())
      or (private.my_designation() = 'design_associate_lead'
          and exists (select 1 from public.docs p where p.path = 'projects/' || pid and coalesce(p.data->>'status', 'active') = 'active'
                      and lower(trim(coalesce(p.data->>'pod', ''))) <> 'chalk create'))
      or (private.is_chalk_lead() and private.is_chalk_project(pid))
$$;

create or replace function private.can_see_task_doc(p_private boolean, p_assignee uuid, pid text)
 returns boolean language sql stable security definer set search_path to ''
as $$
  select case
    when p_private then private.is_owner() or p_assignee = auth.uid()
    else private.is_approver()
      or p_assignee = auth.uid()
      or private.has_pod_view_doc(pid, p_assignee)
      or private.member_ok(pid, auth.uid())
      or (private.my_designation() = 'design_associate_lead'
          and exists (select 1 from public.profiles a where a.id = p_assignee and a.designation = 'design_associate'))
      or (private.is_chalk_lead() and private.is_chalk_project(pid))
  end
$$;

-- who organises a given Sunday under the rotation (same rule as the app)
create or replace function private.rota_organiser(p_date text)
 returns text language plpgsql stable security definer set search_path to ''
as $$
declare r jsonb; n int; k int; st date;
begin
  if p_date is null or p_date !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  select data into r from public.docs where path = 'meetcfg/rota';
  if r is null or jsonb_typeof(r->'ids') <> 'array' or coalesce(r->>'start', '') !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  n := jsonb_array_length(r->'ids'); st := (r->>'start')::date;
  if n = 0 or p_date::date < st then return null; end if;
  k := round((p_date::date - st) / 7.0)::int;
  return r->'ids'->>(((k % n) + n) % n);
end $$;

-- studio-work projects get their own code prefix
create or replace function private.project_code(d jsonb, p_no text)
 returns text language plpgsql immutable set search_path to ''
as $$
declare k numeric; size text; parts text[]; pre text;
begin
  if lower(trim(coalesce(d->>'pod', ''))) = 'chalk create' then
    return 'CHK-' || p_no;
  end if;
  pre := case d->>'type' when 'studioops' then 'OPS' when 'studiodev' then 'DEV' when 'studiomgmt' then 'MGT' else null end;
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

-- notifications for project team requests and decisions
create or replace function private.docs_notify_members()
 returns trigger language plpgsql security definer set search_path to ''
as $$
declare
  om jsonb := case when tg_op = 'UPDATE' then coalesce(old.data->'members', '{}'::jsonb) else '{}'::jsonb end;
  nm jsonb := coalesce(new.data->'members', '{}'::jsonb);
  actor text := coalesce(private.person_name(auth.uid()), 'SLATE OS');
  proj text := concat_ws(' · ', nullif(new.data->>'code', ''), nullif(new.data->>'name', ''));
  k text; o jsonb; n jsonb; who text; extra text;
begin
  if new.coll <> 'projects' or jsonb_typeof(nm) <> 'object' then return null; end if;
  begin
  for k in select x from jsonb_object_keys(nm) x union select x from jsonb_object_keys(case when jsonb_typeof(om) = 'object' then om else '{}'::jsonb end) x loop
    o := case when jsonb_typeof(om->k) = 'object' then om->k end;
    n := case when jsonb_typeof(nm->k) = 'object' then nm->k end;
    if o is not distinct from n then continue; end if;
    who := coalesce(private.person_name(private.as_uuid(k)), 'Someone');
    extra := case when coalesce((n->>'temp')::boolean, false) then ' · temporary' || coalesce(' until ' || private.fmt_d(nullif(n->>'until', '')), '') else '' end;
    if n is not null and n->>'status' = 'pending' and (o is null or o->>'status' is distinct from 'pending' or o->>'until' is distinct from n->>'until') then
      perform private.notify_approvers('member_request', 'Project team request · ' || actor, concat_ws(E'\n', who || coalesce(' (' || nullif(n->>'team', '') || ')', '') || ' → ' || proj || extra, nullif(n->>'note', '')));
    elsif n is not null and n->>'status' = 'approved' and (o is null or o->>'status' is distinct from 'approved') then
      if o is not null and o->>'by' is not null then
        perform private.notify(private.as_uuid(o->>'by'), 'member_approved', 'Team request approved by ' || actor, who || ' → ' || proj || extra);
      end if;
      perform private.notify(private.as_uuid(k), 'member_added', 'You’ve been added to a project', proj || extra || E'\nAdded by ' || actor);
    elsif n is null and o is not null and o->>'status' = 'pending' and o->>'by' is distinct from auth.uid()::text then
      perform private.notify(private.as_uuid(o->>'by'), 'member_declined', 'Team request declined by ' || actor, who || ' → ' || proj);
    end if;
  end loop;
  exception when others then raise warning 'member notification skipped: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists g_docs_notify_members on public.docs;
create trigger g_docs_notify_members after insert or update on public.docs
  for each row when (new.coll = 'projects') execute function private.docs_notify_members();

-- (applied as project_team_notify_pending) member notifications wait until a requested project is approved:
-- docs_notify_members returns early while status <> 'active', and on pending → active treats every member as new.
