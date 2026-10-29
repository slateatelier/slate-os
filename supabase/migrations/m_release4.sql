-- Release 4 (30 Oct 2026): work goes to the people who do it.
-- 1. The drafting lead gives drafting checklist items to drafters as dated tasks (drafting queue).
-- 2. POD leaders verify their POD's everyday project tasks; the Principal and the COO keep phase gates,
--    client deliverables and studio work.
-- 3. The POD leaders' setup window (settings.leadUntil): they set dates and mark their POD's work done themselves.
-- 4. A task's assignee records when they sent it to their POD leader to check (sentCheck).
-- 5. A morning brief at 09:00 and an end-of-day check at 17:30, Sunday to Thursday.
-- The guard is patched in place from its live definition, so earlier changes to it stay as they are.
-- Run it once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

create or replace function private.lead_window() returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce((select (now() at time zone 'Asia/Dhaka')::date <= (s.data->>'leadUntil')::date
                     from public.docs s where s.path = 'config/settings' and coalesce(s.data->>'leadUntil', '') <> ''), false)
$$;

create or replace function private.r4_patch(src text, a text, b text) returns text
language plpgsql as $$
begin
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then
    raise exception 'Release 4 patch: expected exactly one match for: %', left(a, 120);
  end if;
  return replace(src, a, b);
end $$;

do $mig$
declare src text := pg_get_functiondef('private.docs_guard'::regproc);
begin
  -- 2 + 3: who may complete or verify work
  src := private.r4_patch(src,
$a$    vf_can := is_appr and not private.is_chalk_project(new.project_id) and new.assignee is distinct from uid
              and (tg_op = 'INSERT' or old.assignee is distinct from uid);$a$,
$b$    vf_can := (is_appr and not private.is_chalk_project(new.project_id) and new.assignee is distinct from uid
              and (tg_op = 'INSERT' or old.assignee is distinct from uid))
           -- release 4: the POD leader during the setup window, on the POD's projects
           or (private.leads_doc(new.project_id) and private.lead_window())
           -- release 4: the POD leader verifies the POD's everyday project tasks (not gates, deliverables or studio work)
           or (tg_op = 'UPDATE' and private.leads_doc(new.project_id) and new.assignee is distinct from uid and old.assignee is distinct from uid
               and private.verify_cat(new.project_id, nd) in ('task','repeat')
               and exists (select 1 from public.profiles a where a.id = new.assignee and a.pod_id is not distinct from my_pod_id));$b$);

  -- 1: checklist: the drafting lead hands drafting items out; anyone on the project ticks their own items
  src := private.r4_patch(src,
$a$        if not (is_lead or private.has_pod_view_doc(rw.doc_id)) then raise exception 'Not your project''s checklist'; end if;$a$,
$b$        if not (is_lead or private.has_pod_view_doc(rw.doc_id) or is_dlead or private.can_see_project_doc(rw.doc_id)) then raise exception 'Not your project''s checklist'; end if;$b$);
  src := private.r4_patch(src,
$a$          and coalesce(od->'cl'->phk->itid->>'who', v->>'who', '') <> uid::text) then$a$,
$b$          and coalesce(od->'cl'->phk->itid->>'who', v->>'who', '') <> uid::text
          and not (is_dlead
                   and private.changed_keys(coalesce(od->'cl'->phk->itid, '{}'::jsonb), v) <@ array['who','at','by']
                   and (coalesce(v->>'who', '') = '' or private.is_drafting_member(private.as_uuid(v->>'who')))
                   and (coalesce(od->'cl'->phk->itid->>'who', '') = '' or private.is_drafting_member(private.as_uuid(od->'cl'->phk->itid->>'who'))))) then$b$);

  -- 1: the drafting lead creates a dated task for a drafter from a checklist item
  src := private.r4_patch(src,
$a$      if is_dlead then
        if new.assignee is null and req_ok$a$,
$b$      if is_dlead and jsonb_typeof(nd->'clRef') = 'object' and private.is_drafting_member(new.assignee)
         and coalesce(nd->>'doneAt', '') = '' and coalesce(jsonb_typeof(nd->'verify'), 'null') <> 'object'
         and not private.is_chalk_project(new.project_id) and private.can_see_project_doc(new.project_id) then
        return new;
      end if;
      if is_dlead then
        if new.assignee is null and req_ok$b$);
  -- 1: ... and moves it to another drafter
  src := private.r4_patch(src,
$a$      elsif k in ('assignee','assignReq') then
        if not is_lead then raise exception 'Only the pod leader or COO reassigns tasks'; end if;$a$,
$b$      elsif k = 'assignee' and is_dlead and jsonb_typeof(od->'clRef') = 'object'
            and private.is_drafting_member(old.assignee) and private.is_drafting_member(new.assignee) then
        null;
      elsif k in ('assignee','assignReq') then
        if not is_lead then raise exception 'Only the pod leader or COO reassigns tasks'; end if;$b$);

  -- 3: dates during the setup window
  src := private.r4_patch(src,
$a$      if coalesce(nd->>'target', '') <> '' then raise exception 'Pod leaders propose target dates; the COO approves them'; end if;$a$,
$b$      if coalesce(nd->>'target', '') <> '' and not private.lead_window() then raise exception 'Pod leaders propose target dates; the COO approves them'; end if;$b$);
  src := private.r4_patch(src,
$a$      elsif k in ('target','originalTarget','revisions') then
        raise exception 'Target dates change only when the COO approves a request';$a$,
$b$      elsif k in ('target','originalTarget','revisions') then
        if not (is_lead and private.lead_window()) then raise exception 'Target dates change only when the COO approves a request'; end if;$b$);

  -- 4: the assignee records when they sent the work to be checked
  src := private.r4_patch(src,
$a$      elsif k in ('doneAt','doneBy','stage','request','nextId','revCount','verify') then$a$,
$b$      elsif k in ('doneAt','doneBy','stage','request','nextId','revCount','verify','sentCheck') then$b$);

  execute src;
end $mig$;

drop function private.r4_patch(text, text, text);

-- 5. morning brief (09:00) and end-of-day check (17:30), Sunday to Thursday; only when there is something to say
create or replace function private.morning_brief() returns void
language plpgsql security definer set search_path to '' as $$
declare r record; td text := to_char((now() at time zone 'Asia/Dhaka')::date, 'YYYY-MM-DD');
        wk text := to_char((now() at time zone 'Asia/Dhaka')::date + 7, 'YYYY-MM-DD'); parts text[];
begin
  for r in
    select p.id,
      count(*) filter (where d.data->>'target' < td) over_n,
      count(*) filter (where d.data->>'target' = td) today_n,
      count(*) filter (where d.data->>'target' > td and d.data->>'target' <= wk) week_n,
      min(d.data->>'title') filter (where d.data->>'target' = td) first_today
    from public.profiles p
    join public.docs d on d.assignee = p.id and d.coll in ('tasks','lead')
     and coalesce(d.data->>'doneAt', '') = '' and coalesce((d.data->>'archived')::boolean, false) = false
     and jsonb_typeof(d.data->'verify') is distinct from 'object'
     and coalesce(d.data->>'target', '') <> '' and d.data->>'target' <= wk
    where p.active and p.designation <> 'principal'
    group by p.id
  loop
    if r.over_n + r.today_n + r.week_n = 0 then continue; end if;
    if exists (select 1 from public.notifications n where n.user_id = r.id and n.kind = 'brief' and n.created_at > now() - interval '20 hours') then continue; end if;
    parts := array_remove(array[
      case when r.today_n > 0 then r.today_n || ' due today' || case when r.today_n = 1 and r.first_today is not null then ' (' || left(r.first_today, 60) || ')' else '' end end,
      case when r.over_n > 0 then r.over_n || ' overdue' end,
      case when r.week_n > 0 then r.week_n || ' more this week' end], null);
    insert into public.notifications (user_id, kind, title, body)
    values (r.id, 'brief', 'Good morning: your day in SLATE OS', array_to_string(parts, ' · ') || '.');
  end loop;
end $$;

create or replace function private.day_wrap() returns void
language plpgsql security definer set search_path to '' as $$
declare r record; td text := to_char((now() at time zone 'Asia/Dhaka')::date, 'YYYY-MM-DD');
begin
  for r in
    select p.id, count(*) n, string_agg(left(d.data->>'title', 50), '; ' order by d.data->>'title') titles
    from public.profiles p
    join public.docs d on d.assignee = p.id and d.coll in ('tasks','lead')
     and coalesce(d.data->>'doneAt', '') = '' and coalesce((d.data->>'archived')::boolean, false) = false
     and jsonb_typeof(d.data->'verify') is distinct from 'object' and coalesce(d.data->>'stage', '') <> 'review'
     and d.data->>'target' = td and jsonb_typeof(d.data->'request') is distinct from 'object'
    where p.active and p.designation <> 'principal'
    group by p.id
  loop
    if exists (select 1 from public.notifications n where n.user_id = r.id and n.kind = 'daywrap' and n.created_at > now() - interval '20 hours') then continue; end if;
    insert into public.notifications (user_id, kind, title, body)
    values (r.id, 'daywrap', 'Before you leave',
            case when r.n = 1 then 'Due today and still open: ' || r.titles || '. Mark it done, or ask for a new date.'
                 else r.n || ' tasks due today are still open: ' || left(r.titles, 160) || '. Mark them done, or ask for new dates.' end);
  end loop;
end $$;

revoke all on function private.morning_brief() from public, anon, authenticated;
revoke all on function private.day_wrap() from public, anon, authenticated;
revoke all on function private.lead_window() from public, anon;

select cron.schedule('slate-morning-brief', '0 3 * * 0-4', 'select private.morning_brief()');
select cron.schedule('slate-day-wrap', '30 11 * * 0-4', 'select private.day_wrap()');

-- switch the app over to the new flow
update public.docs set data = data || '{"r4":true}'::jsonb where path = 'config/settings';

commit;
