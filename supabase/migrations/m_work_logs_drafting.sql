-- Daily work log: the Drafting Pool joins (3 Nov 2026)
-- The Drafting Pool now writes the day's plan like the PODs.
-- 1. The Design Associate Lead sees the Drafting Pool's logs (the Principal and the COO already see everyone's).
-- 2. The 11:00 reminder also goes to Drafting Pool members without a plan, and the Design Associate Lead
--    gets one line listing who in the Drafting Pool hasn't written it.
-- Writing a log needed no change: anyone active can write their own.

create or replace function private.can_see_work_log(p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select p_user = auth.uid()
      or private.is_top() or private.is_approver()
      or (private.is_pod_leader() and exists (
            select 1 from public.profiles a where a.id = p_user and a.pod_id is not null and a.pod_id = private.my_pod()))
      or exists (
            select 1 from public.profiles me, public.profiles a
             where me.id = auth.uid() and a.id = p_user and me.active
               and coalesce(me.team, '') ilike 'drafting%' and a.team = me.team
               and (me.designation = 'design_associate_lead' or me.is_manager))
$$;
revoke all on function private.can_see_work_log(uuid) from public, anon;
grant execute on function private.can_see_work_log(uuid) to authenticated;

create or replace function private.work_log_reminders()
returns void language plpgsql security definer set search_path to '' as $$
declare d date := (now() at time zone 'Asia/Dhaka')::date; r record;
begin
  -- holidays in Settings
  if exists (select 1 from public.docs s, jsonb_array_elements(case when jsonb_typeof(s.data->'holidays') = 'array' then s.data->'holidays' else '[]'::jsonb end) x
              where s.path = 'config/settings' and x->>'d' = to_char(d, 'YYYY-MM-DD')) then return; end if;
  -- each person in a POD or the Drafting Pool without a plan
  insert into public.notifications (user_id, kind, title, body, task_ref)
  select p.id, 'plan_missing', 'Write today''s plan',
         'Which projects and tasks are you working on today? Open SLATE OS and write your plan.',
         'plan:' || p.id || '@' || d
    from public.profiles p
   where p.active
     and ((p.pod_id is not null and coalesce(p.team, '') ilike 'pod%') or coalesce(p.team, '') ilike 'drafting%')
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
end $$;
revoke all on function private.work_log_reminders() from public, anon, authenticated;
