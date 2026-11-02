-- Work waiting to be checked: remind the POD leader (3 Nov 2026)
-- When a POD member sends POD work (category task or repeat) to be checked and it has waited
-- 1 working day, the POD leader gets one reminder. Working days skip Friday, Saturday and the
-- holidays in Settings. One reminder per send: sending again (after a return) can remind again.
-- Only while POD leaders check their POD's work (Settings: r4). Runs on working days at 10:15 Dhaka.

-- working days from p_from up to yesterday (Dhaka), skipping Friday, Saturday and holidays
create or replace function private.work_days_since(p_from date)
returns int language sql stable security definer set search_path to '' as $$
  select count(*)::int
    from generate_series(p_from, (now() at time zone 'Asia/Dhaka')::date - 1, interval '1 day') g
   where extract(isodow from g) not in (5, 6)
     and not exists (
       select 1 from public.docs s, jsonb_array_elements(
                case when jsonb_typeof(s.data->'holidays') = 'array' then s.data->'holidays' else '[]'::jsonb end) x
        where s.path = 'config/settings' and x->>'d' = to_char(g, 'YYYY-MM-DD'))
$$;
revoke all on function private.work_days_since(date) from public, anon, authenticated;

create or replace function private.check_reminders()
returns void language plpgsql security definer set search_path to '' as $$
begin
  insert into public.notifications (user_id, kind, title, body, task_ref)
  select l.id, 'check_waiting',
         left('Waiting for your check: ' || coalesce(nullif(d.data->>'title', ''), 'Task'), 90),
         left(coalesce(nullif(a.full_name, ''), 'A POD member') || ' sent it ' ||
              private.work_days_since((d.data->'verify'->>'at')::date) || ' working day' ||
              case when private.work_days_since((d.data->'verify'->>'at')::date) > 1 then 's' else '' end ||
              ' ago. Open SLATE OS to check it or return it with a note.', 320),
         'check:' || d.path || '@' || coalesce(d.data->'verify'->>'ts', d.data->'verify'->>'at')
    from public.docs d
    join public.profiles a on a.id = d.assignee and a.active
    join public.profiles l on l.active and l.id <> a.id
         and coalesce(l.team, '') <> '' and l.team = a.team and l.team ilike 'pod%'
         and (l.is_manager or coalesce(l.role_label, '') ilike '%lead%')
   where d.coll = 'tasks'
     and coalesce((select (s.data->>'r4')::boolean from public.docs s where s.path = 'config/settings'), false)
     and jsonb_typeof(d.data->'verify') = 'object'
     and coalesce(d.data->>'doneAt', '') = ''
     and coalesce((d.data->>'archived')::boolean, false) = false
     and (d.data->'verify'->>'at') ~ '^\d{4}-\d{2}-\d{2}'
     and private.verify_cat(d.project_id, d.data) in ('task', 'repeat')
     and private.work_days_since((d.data->'verify'->>'at')::date) >= 1
     and not exists (select 1 from public.notifications n
                      where n.user_id = l.id
                        and n.task_ref = 'check:' || d.path || '@' || coalesce(d.data->'verify'->>'ts', d.data->'verify'->>'at'));
end $$;
revoke all on function private.check_reminders() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'slate-check-reminders';
select cron.schedule('slate-check-reminders', '15 4 * * 0-4', 'select private.check_reminders()');
