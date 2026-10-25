-- SLATE OS · 25 Oct 2026
-- 1. Activity log: the Principal and the COO see everything; everyone sees their own entries;
--    team leaders (pod leaders, the drafting lead, the Chalk Create lead) see their team's entries
--    (messages, notifications and account events stay with the people involved).
-- 2. Issue reports from the floating "Report an issue" button.
-- 3. Last seen: a heartbeat while SLATE OS is open.
-- 4. Message replies: Done, Already done (when), Will do it (by when), Need help (note), Remind me,
--    Make it a task; and follow-ups from the sender.

-- 1 ---------------------------------------------------------------------------------------------
create or replace function private.leads_team_of(p uuid)
 returns boolean language sql stable security definer set search_path to ''
as $$
  select p is not null and p <> auth.uid() and exists (
    select 1 from public.profiles me, public.profiles a
     where me.id = auth.uid() and me.active and a.id = p and (
           (me.pod_id is not null and (me.designation = 'pod_leader' or me.is_manager) and a.pod_id = me.pod_id)
        or (me.designation = 'design_associate_lead' and a.team is not null and a.team = me.team)
        or (me.is_chalk_lead and lower(trim(coalesce(a.team, ''))) = 'chalk create')))
$$;

drop policy if exists log_select_docs on public.activity_log;
drop policy if exists log_select on public.activity_log;
create policy log_select on public.activity_log for select to authenticated using (
  case when is_private then ((select private.is_owner()) or subject_user = (select auth.uid()))
  else ((select private.is_approver())
        or actor = (select auth.uid())
        or subject_user = (select auth.uid())
        or (table_name not in ('message','notification','account')
            and (private.leads_team_of(actor) or private.leads_team_of(subject_user))))
  end);

-- 2 ---------------------------------------------------------------------------------------------
create table if not exists public.issue_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  reporter uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  message text not null check (length(trim(message)) between 3 and 2000),
  screen text check (length(screen) <= 80),
  device text check (length(device) <= 240),
  status text not null default 'open' check (status in ('open','fixing','fixed','closed')),
  note text check (length(note) <= 1000),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz
);
create index if not exists issue_reports_reporter_idx on public.issue_reports (reporter);
alter table public.issue_reports enable row level security;
revoke all on public.issue_reports from anon;
grant select, insert, update on public.issue_reports to authenticated;
drop policy if exists issue_insert on public.issue_reports;
drop policy if exists issue_select on public.issue_reports;
drop policy if exists issue_update on public.issue_reports;
create policy issue_insert on public.issue_reports for insert to authenticated
  with check (reporter = (select auth.uid()) and (select private.is_active()) and status = 'open');
create policy issue_select on public.issue_reports for select to authenticated
  using (reporter = (select auth.uid()) or (select private.is_approver()));
create policy issue_update on public.issue_reports for update to authenticated
  using ((select private.is_approver())) with check ((select private.is_approver()));

create or replace function private.issue_reports_after()
 returns trigger language plpgsql security definer set search_path to ''
as $$
declare who text := coalesce(private.person_name(new.reporter), 'Team member');
begin
  if tg_op = 'INSERT' then
    perform private.notify_approvers('issue_report', 'Issue reported · ' || who, concat_ws(E'\n', left(new.message, 260), nullif(new.screen, '')));
    insert into public.activity_log (actor, table_name, row_id, action, subject_user, is_private, after)
    values (new.reporter, 'issue', new.id::text, 'report', new.reporter, false, jsonb_build_object('message', new.message, 'screen', new.screen));
  elsif new.status is distinct from old.status or new.note is distinct from old.note then
    perform private.notify(new.reporter, 'issue_update', 'Your report: ' || case new.status when 'fixing' then 'being fixed' when 'fixed' then 'fixed' when 'closed' then 'closed' else 'reopened' end,
      concat_ws(E'\n', left(new.message, 160), nullif(new.note, '')));
    insert into public.activity_log (actor, table_name, row_id, action, subject_user, is_private, before, after)
    values (auth.uid(), 'issue', new.id::text, 'status', new.reporter, false, jsonb_build_object('status', old.status), jsonb_build_object('status', new.status, 'note', new.note, 'message', new.message));
  end if;
  return null;
end $$;
drop trigger if exists issue_reports_after on public.issue_reports;
create trigger issue_reports_after after insert or update on public.issue_reports
  for each row execute function private.issue_reports_after();

create or replace function private.issue_reports_stamp()
 returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  new.updated_by := auth.uid(); new.updated_at := now();
  new.reporter := old.reporter; new.message := old.message; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists issue_reports_stamp on public.issue_reports;
create trigger issue_reports_stamp before update on public.issue_reports
  for each row execute function private.issue_reports_stamp();

-- 3 ---------------------------------------------------------------------------------------------
create table if not exists public.presence_seen (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  active_at timestamptz
);
alter table public.presence_seen enable row level security;
revoke all on public.presence_seen from anon;
grant select on public.presence_seen to authenticated;
drop policy if exists seen_select on public.presence_seen;
create policy seen_select on public.presence_seen for select to authenticated using ((select private.is_active()));

create or replace function public.touch_seen(p_active boolean default true)
 returns void language sql security definer set search_path to ''
as $$
  insert into public.presence_seen (user_id, seen_at, active_at)
  select auth.uid(), now(), case when p_active then now() end
   where auth.uid() is not null and exists (select 1 from public.profiles where id = auth.uid() and active)
  on conflict (user_id) do update
    set seen_at = now(), active_at = case when p_active then now() else public.presence_seen.active_at end
$$;
revoke all on function public.touch_seen(boolean) from public, anon;
grant execute on function public.touch_seen(boolean) to authenticated;

-- 4 ---------------------------------------------------------------------------------------------
alter table public.notifications
  add column if not exists done_at timestamptz,
  add column if not exists due_at timestamptz,
  add column if not exists reply_note text,
  add column if not exists task_ref text,
  add column if not exists followups int not null default 0;

drop function if exists public.message_reply(bigint, text, timestamptz);
create or replace function public.message_reply(p_id bigint, p_choice text, p_remind_at timestamptz default null,
                                                p_at timestamptz default null, p_note text default null, p_task text default null)
 returns void language plpgsql security definer set search_path to ''
as $$
declare n public.notifications; root public.notifications; label text; detail text; me text;
        note text := nullif(left(trim(coalesce(p_note, '')), 300), ''); tsk public.docs;
begin
  if not private.is_active() then raise exception 'Your account is read-only'; end if;
  select * into n from public.notifications where id = p_id and user_id = auth.uid() and kind = 'message';
  if not found then raise exception 'Message not found'; end if;
  -- a follow-up is answered on the original message
  if n.ref_id is not null then
    select * into root from public.notifications where id = n.ref_id and user_id = auth.uid() and kind = 'message';
  end if;
  if root.id is null then root := n; end if;

  label := case p_choice when 'done' then 'Done' when 'already' then 'Already done' when 'will' then 'Will do it'
                         when 'help' then 'Need help' when 'remind' then 'Set a reminder' when 'task' then 'Made it a task'
                         when 'on_it' then 'On it' when 'later' then 'Will do it later' else null end;
  if label is null then raise exception 'Choose one of the replies'; end if;
  detail := label;
  if p_choice = 'remind' then
    if p_remind_at is null or p_remind_at < now() or p_remind_at > now() + interval '30 days' then
      raise exception 'Choose a reminder time in the next 30 days';
    end if;
  elsif p_choice = 'already' then
    if p_at is null or p_at > now() + interval '5 minutes' or p_at < now() - interval '90 days' then
      raise exception 'Choose when it was done (not in the future)';
    end if;
    detail := 'Already done · ' || to_char(p_at at time zone 'Asia/Dhaka', 'FMDD Mon, FMHH12:MI am');
  elsif p_choice = 'will' then
    if p_at is null or p_at < now() - interval '1 day' or p_at > now() + interval '180 days' then
      raise exception 'Choose the date you will finish it';
    end if;
    detail := 'Will do it by ' || to_char(p_at at time zone 'Asia/Dhaka', 'FMDD Mon');
  elsif p_choice = 'help' then
    if note is null then raise exception 'Write what help you need'; end if;
    detail := 'Need help: ' || note;
  elsif p_choice = 'task' then
    select * into tsk from public.docs where path = p_task and coll in ('tasks','lead') and data->>'fromMsg' in (root.id::text, n.id::text);
    if tsk.path is null then raise exception 'Create the task first'; end if;
    detail := 'Made it a task' || coalesce(' → ' || private.person_name(coalesce(tsk.assignee, private.as_uuid(tsk.data->'assignReq'->>'to'))), '');
  end if;

  me := coalesce(private.person_name(auth.uid()), 'Team member');
  update public.notifications
     set reply = case when p_choice = 'remind' then coalesce(reply, 'remind') else p_choice end,
         replied_at = case when p_choice = 'remind' and reply is not null then replied_at else now() end,
         remind_at = case when p_choice = 'remind' then p_remind_at else remind_at end,
         reminded_at = case when p_choice = 'remind' then null else reminded_at end,
         done_at = case p_choice when 'done' then now() when 'already' then p_at when 'will' then null else done_at end,
         due_at = case when p_choice = 'will' then p_at else due_at end,
         reply_note = case when p_choice in ('help','done','already','will','task') and note is not null then note else reply_note end,
         task_ref = case when p_choice = 'task' then p_task else task_ref end,
         read_at = coalesce(read_at, now())
   where id in (root.id, n.id);
  if p_choice <> 'remind' and root.sender is not null then
    insert into public.notifications (user_id, kind, title, body, sender, ref_id)
    values (root.sender, 'reply', left(me || ': ' || detail, 90),
            left(concat_ws(E'\n', case when p_choice not in ('help') then note end, 'Re: ' || root.body), 320), auth.uid(), root.id);
  end if;
  insert into public.activity_log (actor, table_name, row_id, action, subject_user, is_private, after)
  values (auth.uid(), 'message', root.id::text, case when p_choice = 'remind' then 'remind' else 'reply' end, root.sender, false,
          jsonb_build_object('reply', detail, 'message', root.body, 'from', root.sender, 'remind_at', p_remind_at, 'at', p_at, 'note', note, 'task', p_task));
end $$;
revoke all on function public.message_reply(bigint, text, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.message_reply(bigint, text, timestamptz, timestamptz, text, text) to authenticated;

-- the sender nudges people about a message
create or replace function public.message_followup(p_ids bigint[], p_note text default null)
 returns integer language plpgsql security definer set search_path to ''
as $$
declare r public.notifications; c int := 0; actor text; note text := nullif(left(trim(coalesce(p_note, '')), 300), '');
begin
  if not private.is_active() then raise exception 'Your account is read-only'; end if;
  if not private.is_approver() then raise exception 'Only the Principal and the COO send follow-ups'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Choose who to follow up'; end if;
  actor := coalesce(private.person_name(auth.uid()), 'SLATE OS');
  for r in select * from public.notifications where id = any(p_ids) and sender = auth.uid() and kind = 'message' and ref_id is null loop
    if r.followups >= 20 then continue; end if;
    insert into public.notifications (user_id, kind, title, body, sender, ref_id)
    values (r.user_id, 'message', 'Follow-up from ' || actor, left(coalesce(note || E'\n\n', '') || 'Re: ' || r.body, 700), auth.uid(), r.id);
    update public.notifications set followups = followups + 1 where id = r.id;
    c := c + 1;
  end loop;
  if c > 0 then
    insert into public.activity_log (actor, table_name, row_id, action, after)
    values (auth.uid(), 'message', null, 'followup', jsonb_build_object('ids', to_jsonb(p_ids), 'note', note));
  end if;
  return c;
end $$;
revoke all on function public.message_followup(bigint[], text) from public, anon;
grant execute on function public.message_followup(bigint[], text) to authenticated;

drop function if exists public.my_sent_messages(integer);
create or replace function public.my_sent_messages(p_limit integer default 40)
 returns table(id bigint, created_at timestamptz, to_user uuid, body text, read_at timestamptz, reply text, replied_at timestamptz,
               done_at timestamptz, due_at timestamptz, reply_note text, task_ref text, followups int)
 language sql stable security definer set search_path to ''
as $$
  select n.id, n.created_at, n.user_id, n.body, n.read_at, n.reply, n.replied_at, n.done_at, n.due_at, n.reply_note, n.task_ref, n.followups
    from public.notifications n
   where n.sender = auth.uid() and n.kind = 'message' and n.ref_id is null and private.is_approver()
   order by n.created_at desc limit least(greatest(p_limit, 1), 300)
$$;
revoke all on function public.my_sent_messages(integer) from public, anon;
grant execute on function public.my_sent_messages(integer) to authenticated;
