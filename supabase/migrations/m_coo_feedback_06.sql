-- SLATE OS · COO feedback 06 (23 Nov 2026), release 2.069. Run once in the Supabase SQL editor. Safe to run twice.
-- 1. Task reminders: a task's remind {at, rep, sentAt} sends "Reminder: <task>" to the person at that time (checked every minute).
--    rep = daily | weekly | monthly | quarterly | halfyearly | yearly moves the reminder on after it is sent; '' or 'task' sends once.
-- 2. COO tasks made automatically, in her lists (each once, path lead/<COO>/tasks/auto-…):
--    a new lead → Proposals; a proposal confirmed → Agreements; a follow-up date on an open lead or proposal → Follow ups
--    (one task per lead/proposal, moved to the new date; archived when it closes); a phase submitted to the client on a
--    client project → Invoice, with the matching payment stage from the fee record when one is found.

-- one COO task, made once (or moved to a new date when p_move); the task guard is bypassed the same way as group tasks
create or replace function private.coo_auto_task(p_key text, p_list text, p_area text, p_title text, p_target date,
  p_note text default '', p_prio text default 'high', p_project text default null, p_move boolean default false)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare coo uuid; pid text; pth text; ex public.docs; now_t text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); tg text := to_char(p_target, 'YYYY-MM-DD');
begin
  select id into coo from public.profiles where active and designation = 'coo' limit 1;
  if coo is null then return; end if;
  pid := coalesce(p_project, (select doc_id from public.docs where coll = 'projects' and data->>'type' = p_area order by created_at limit 1),
                  (select doc_id from public.docs where coll = 'projects' and data->>'type' = 'studiomgmt' order by created_at limit 1));
  if pid is null then return; end if;
  pth := 'lead/' || coo::text || '/tasks/auto-' || p_key;
  select * into ex from public.docs where path = pth;
  perform set_config('slate.task_group', '1', true);
  if ex.path is null then
    insert into public.docs (path, data) values (pth, jsonb_build_object(
      'projectId', pid, 'title', left(p_title, 160), 'kind', 'Task', 'assignee', coo::text, 'target', tg, 'originalTarget', tg,
      'phase', '', 'gate', null, 'revisions', 0, 'doneAt', null, 'doneBy', null, 'request', null, 'archived', false,
      'repeat', '', 'start', null, 'stage', 'todo', 'nextId', null, 'parentId', null, 'list', p_list, 'prio', p_prio,
      'auto', p_key, 'note', coalesce(p_note, ''), 'createdAt', now_t,
      'history', jsonb_build_array(jsonb_build_object('at', now_t, 'by', '', 'type', 'created', 'assignee', coo::text, 'to', tg, 'note', 'Made by SLATE OS' || coalesce(': ' || nullif(p_note, ''), '')))));
  elsif p_move and (coalesce(ex.data->>'target', '') is distinct from tg or coalesce(ex.data->>'doneAt', '') <> '' or coalesce((ex.data->>'archived')::boolean, false)) then
    update public.docs set data = data || jsonb_build_object('target', tg, 'doneAt', null, 'doneBy', null, 'stage', 'todo', 'archived', false, 'note', coalesce(p_note, ''),
        'history', coalesce(data->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now_t, 'by', '', 'type', 'target', 'to', tg, 'note', 'Follow-up date moved')))
      where path = pth;
  end if;
  perform set_config('slate.task_group', '', true);
exception when others then
  perform set_config('slate.task_group', '', true);
  raise warning 'COO auto task skipped: %', sqlerrm;
end $function$;

create or replace function private.coo_auto_archive(p_key text)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare coo uuid;
begin
  select id into coo from public.profiles where active and designation = 'coo' limit 1;
  if coo is null then return; end if;
  perform set_config('slate.task_group', '1', true);
  update public.docs set data = data || jsonb_build_object('archived', true)
   where path = 'lead/' || coo::text || '/tasks/auto-' || p_key and coalesce(data->>'doneAt', '') = '' and not coalesce((data->>'archived')::boolean, false);
  perform set_config('slate.task_group', '', true);
exception when others then
  perform set_config('slate.task_group', '', true);
  raise warning 'COO auto archive skipped: %', sqlerrm;
end $function$;

create or replace function private.docs_coo_auto()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  od jsonb := case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end;
  nd jsonb := new.data;
  td date := (now() at time zone 'Asia/Dhaka')::date;
  nm text; k text; ph text; fin jsonb; ms jsonb; hit jsonb; note text; kw text;
begin
  begin
  if new.coll = 'proposals' then
    nm := coalesce(nullif(nd->>'name', ''), nullif(nd->>'client', ''), 'Proposal')
          || case when nullif(nd->>'name', '') is not null and nullif(nd->>'client', '') is not null then ' · ' || (nd->>'client') else '' end;
    -- a new lead: make the proposal
    if coalesce((nd->>'lead')::boolean, false) and (tg_op = 'INSERT' or not coalesce((od->>'lead')::boolean, false)) then
      perform private.coo_auto_task('lead-' || new.doc_id, 'Proposals', 'studiobd', 'Proposal for the new lead: ' || nm, td,
        concat_ws(' · ', nullif(nd->>'phone', ''), nullif(nd->>'location', '')), 'high');
    end if;
    -- confirmed: the agreement
    if nd->>'status' = 'won' and coalesce(od->>'status', '') <> 'won' then
      perform private.coo_auto_task('agr-' || new.doc_id, 'Agreements', 'studiobd', 'Agreement: ' || nm || ' · prepare, sign, scan and file', td, '', 'high');
      perform private.coo_auto_archive('fu-' || new.doc_id);
    elsif coalesce(nd->>'status', 'open') in ('lost', 'dropped') then
      perform private.coo_auto_archive('fu-' || new.doc_id);
    -- the next follow-up date
    elsif coalesce(nd->>'status', 'open') = 'open' and coalesce(nd->>'next', '') ~ '^\d{4}-\d{2}-\d{2}$' and (nd->>'next') is distinct from (od->>'next') then
      perform private.coo_auto_task('fu-' || new.doc_id, 'Follow ups', 'studiobd',
        'Follow up' || case when coalesce((nd->>'lead')::boolean, false) then ' lead' else '' end || ': ' || nm, (nd->>'next')::date,
        nullif(nd->>'phone', ''), 'med', null, true);
    end if;

  elsif new.coll = 'projects' and jsonb_typeof(nd->'std'->'sentAt') = 'object'
        and coalesce(nd->>'pod', '') <> 'Studio' and coalesce(nd->>'agStatus', '') <> 'internal' and coalesce(nd->>'type', '') not like 'studio%' then
    for ph in select x from jsonb_object_keys(nd->'std'->'sentAt') x loop
      if coalesce(nd->'std'->'sentAt'->>ph, '') = '' or coalesce(od->'std'->'sentAt'->>ph, '') <> '' then continue; end if;
      nm := concat_ws(' · ', nullif(nd->>'code', ''), nullif(nd->>'name', ''));
      kw := case when ph in ('3', '3r') then 'design' when ph = '4' then '(authority|rajuk|approval)' when ph in ('6', '7', '8') then '(working|wd)'
                 when ph = '9' then 'as.?built' when ph = '0' then '(brief|feasib)' when ph = '1' then 'concept' when ph = '2' then 'development'
                 when ph = '5' then 'marketing' else null end;
      select data into fin from public.fin_docs where coll = 'projects' and (data->>'osId' = new.doc_id
        or (coalesce(data->>'osId', '') = '' and upper(coalesce(data->>'code', '')) = upper(coalesce(nd->>'code', '-')))) limit 1;
      ms := case when jsonb_typeof(fin->'milestones') = 'array' then fin->'milestones' else '[]'::jsonb end;
      hit := null;
      if kw is not null then
        select m into hit from jsonb_array_elements(ms) m where coalesce(m->>'label', '') ~* kw limit 1;
      end if;
      note := case when hit is not null then 'Payment stage: ' || (hit->>'label') || coalesce(' (' || nullif(hit->>'pct', '') || '%)', '')
                   when jsonb_array_length(ms) > 0 then 'Check the payment stages: ' || (select string_agg(coalesce(m->>'label', '') || coalesce(' ' || nullif(m->>'pct', '') || '%', ''), ' · ') from jsonb_array_elements(ms) m)
                   else 'No fee stages recorded: check the agreement' end;
      perform private.coo_auto_task('inv-' || new.doc_id || '-' || ph, 'Invoice', 'studiofin',
        'Invoice: ' || coalesce(nullif(nm, ''), 'project') || ' · phase ' || ph || ' submitted' || case when hit is not null and coalesce(hit->>'pct', '') <> '' then ' (' || (hit->>'pct') || '%)' else '' end,
        td, note || ' · submitted ' || (nd->'std'->'sentAt'->>ph), 'high');
    end loop;
  end if;
  exception when others then
    raise warning 'COO auto skipped: %', sqlerrm;
  end;
  return null;
end $function$;

drop trigger if exists e5_docs_coo_auto on public.docs;
create trigger e5_docs_coo_auto after insert or update on public.docs
  for each row when (new.coll in ('proposals', 'projects')) execute function private.docs_coo_auto();

-- task reminders, every minute
create or replace function private.task_reminders()
 returns void language plpgsql security definer set search_path to ''
as $function$
declare r record; at timestamptz; rep text; step interval; nxt timestamptz; who uuid;
begin
  perform set_config('slate.task_group', '1', true);
  for r in select path, doc_id, coll, data, assignee, project_id from public.docs
            where coll in ('tasks', 'lead') and jsonb_typeof(data->'remind') = 'object'
              and coalesce(data->'remind'->>'at', '') <> '' and coalesce(data->'remind'->>'sentAt', '') = ''
              and (data->'remind'->>'at')::timestamptz <= now()
              and coalesce(data->>'doneAt', '') = '' and not coalesce((data->>'archived')::boolean, false)
            for update skip locked loop
    at := (r.data->'remind'->>'at')::timestamptz; rep := coalesce(r.data->'remind'->>'rep', '');
    who := coalesce(r.assignee, private.as_uuid(r.data->>'assignee'));
    if who is not null and exists (select 1 from public.profiles where id = who and active) then
      insert into public.notifications (user_id, kind, title, body, task_ref)
      values (who, 'task_reminder', left('Reminder: ' || coalesce(nullif(r.data->>'title', ''), 'a task'), 90),
              left(concat_ws(E'\n', private.project_line(r.project_id), nullif(r.data->>'note', '')), 320), r.doc_id);
    end if;
    step := case rep when 'daily' then interval '1 day' when 'weekly' then interval '7 days' when 'monthly' then interval '1 month'
                     when 'quarterly' then interval '3 months' when 'halfyearly' then interval '6 months' when 'yearly' then interval '1 year' else null end;
    if step is null then
      update public.docs set data = jsonb_set(data, '{remind,sentAt}', to_jsonb(to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) where path = r.path;
    else
      nxt := at; while nxt <= now() loop nxt := nxt + step; end loop;
      update public.docs set data = jsonb_set(data, '{remind,at}', to_jsonb(to_char(nxt at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) where path = r.path;
    end if;
  end loop;
  perform set_config('slate.task_group', '', true);
end $function$;

do $do$ begin
  perform cron.unschedule('slate-task-reminders') where exists (select 1 from cron.job where jobname = 'slate-task-reminders');
  perform cron.schedule('slate-task-reminders', '* * * * *', 'select private.task_reminders()');
end $do$;
