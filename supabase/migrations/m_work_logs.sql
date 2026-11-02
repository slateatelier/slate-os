-- Daily work log (3 Nov 2026)
-- Every working morning each POD leader and POD member writes what they are working on today:
-- one or more lines, each with a project (or studio work), optionally one of their tasks, and a written
-- note of what they will do (at least 10 characters). The next morning they close yesterday's lines:
-- done, carried on to today, or stopped. The log is a record, not scored work.
-- Seen by: the person, their POD leader (same POD), the Principal and the COO.
-- At 11:00 Dhaka on working days, anyone in a POD without today's plan is reminded, and their POD leader
-- gets one line listing who hasn't written it.

create table if not exists public.work_logs (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  day          date not null,
  lines        jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.work_logs enable row level security;

-- every line needs a written note; between 1 and 8 lines; only this week's logs can change
create or replace function private.work_logs_check()
returns trigger language plpgsql security definer set search_path to '' as $$
declare l jsonb; n int;
begin
  if jsonb_typeof(new.lines) <> 'array' then raise exception 'The plan must be a list of lines'; end if;
  n := jsonb_array_length(new.lines);
  if n < 1 then raise exception 'Write at least one line: what you are working on today'; end if;
  if n > 8 then raise exception 'Keep the plan to 8 lines or fewer'; end if;
  for l in select * from jsonb_array_elements(new.lines) loop
    if length(btrim(coalesce(l->>'text', ''))) < 10 then
      raise exception 'Write what you will do on each line (at least 10 characters)';
    end if;
    if coalesce(l->>'status', 'planned') not in ('planned', 'done', 'carried', 'stopped') then
      raise exception 'Unknown status on a line';
    end if;
  end loop;
  if new.day > (now() at time zone 'Asia/Dhaka')::date then raise exception 'A plan can''t be written for a future day'; end if;
  if new.day < (now() at time zone 'Asia/Dhaka')::date - 10 then raise exception 'Logs older than 10 days are closed'; end if;
  if tg_op = 'UPDATE' then new.submitted_at := old.submitted_at; end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.work_logs_check() from public, anon, authenticated;
drop trigger if exists work_logs_check on public.work_logs;
create trigger work_logs_check before insert or update on public.work_logs
  for each row execute function private.work_logs_check();

-- review logins never write
drop trigger if exists zz_reviewer_guard on public.work_logs;
create trigger zz_reviewer_guard before insert or delete or update on public.work_logs
  for each row execute function private.reviewer_guard();

-- who sees a log: the person, the Principal and the COO, and the POD leader of the person's POD
create or replace function private.can_see_work_log(p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select p_user = auth.uid()
      or private.is_top() or private.is_approver()
      or (private.is_pod_leader() and exists (
            select 1 from public.profiles a where a.id = p_user and a.pod_id is not null and a.pod_id = private.my_pod()))
$$;
revoke all on function private.can_see_work_log(uuid) from public, anon;
grant execute on function private.can_see_work_log(uuid) to authenticated;

drop policy if exists work_logs_select on public.work_logs;
create policy work_logs_select on public.work_logs for select to authenticated
  using (private.can_see_work_log(user_id));
drop policy if exists work_logs_insert on public.work_logs;
create policy work_logs_insert on public.work_logs for insert to authenticated
  with check (user_id = auth.uid() and private.is_active());
drop policy if exists work_logs_update on public.work_logs;
create policy work_logs_update on public.work_logs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and private.is_active());

grant select, insert, update on public.work_logs to authenticated;
revoke all on public.work_logs from anon;

-- live updates on Home
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_logs') then
    alter publication supabase_realtime add table public.work_logs;
  end if;
end $$;

-- 11:00 Dhaka, Sunday to Thursday: remind anyone in a POD without today's plan; tell each POD leader who hasn't written it
create or replace function private.work_log_reminders()
returns void language plpgsql security definer set search_path to '' as $$
declare d date := (now() at time zone 'Asia/Dhaka')::date; r record;
begin
  -- holidays in Settings
  if exists (select 1 from public.docs s, jsonb_array_elements(case when jsonb_typeof(s.data->'holidays') = 'array' then s.data->'holidays' else '[]'::jsonb end) x
              where s.path = 'config/settings' and x->>'d' = to_char(d, 'YYYY-MM-DD')) then return; end if;
  -- each person without a plan
  insert into public.notifications (user_id, kind, title, body, task_ref)
  select p.id, 'plan_missing', 'Write today''s plan',
         'Which projects and tasks are you working on today? Open SLATE OS and write your plan.',
         'plan:' || p.id || '@' || d
    from public.profiles p
   where p.active and p.pod_id is not null and coalesce(p.team, '') ilike 'pod%'
     and not private.is_reviewer_id(p.id)
     and not exists (select 1 from public.work_logs w where w.user_id = p.id and w.day = d)
     and not exists (select 1 from public.notifications n where n.user_id = p.id and n.task_ref = 'plan:' || p.id || '@' || d);
  -- each POD leader: who in the POD hasn't written it
  for r in
    select l.id lead_id, l.pod_id, string_agg(coalesce(nullif(m.full_name, ''), 'Someone'), ', ' order by m.full_name) names
      from public.profiles l
      join public.profiles m on m.pod_id = l.pod_id and m.id <> l.id and m.active
     where l.active and l.pod_id is not null and (l.designation = 'pod_leader' or l.is_manager)
       and not private.is_reviewer_id(m.id)
       and not exists (select 1 from public.work_logs w where w.user_id = m.id and w.day = d)
     group by l.id, l.pod_id
  loop
    insert into public.notifications (user_id, kind, title, body, task_ref)
    select r.lead_id, 'plan_missing_pod', 'No plan yet in your POD', 'Not written by 11:00: ' || r.names || '.', 'planpod:' || r.lead_id || '@' || d
     where not exists (select 1 from public.notifications n where n.user_id = r.lead_id and n.task_ref = 'planpod:' || r.lead_id || '@' || d);
  end loop;
end $$;
revoke all on function private.work_log_reminders() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'slate-work-log-reminders';
select cron.schedule('slate-work-log-reminders', '0 5 * * 0-4', 'select private.work_log_reminders()');
