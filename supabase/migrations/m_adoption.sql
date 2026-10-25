-- Adoption: the Principal and the COO see who is using SLATE OS, and anyone silent for 2 days is nudged.

-- One row per active person: last opened, phones with notifications, unanswered messages, updates this week.
-- Counts only; no task or message content. Principal and COO only.
create or replace function public.adoption_stats()
returns table(user_id uuid, seen_at timestamptz, last_action timestamptz, devices int, devices_ok int,
              msgs_open int, oldest_msg timestamptz, unread int, updates_7d int, nudged_at timestamptz)
language sql
stable
security definer
set search_path to ''
as $function$
  select p.id,
         ps.seen_at,
         (select max(a.at) from public.activity_log a where a.actor = p.id and a.action <> 'notify'),
         (select count(*) from public.push_subs s where s.user_id = p.id)::int,
         (select count(*) from public.push_subs s where s.user_id = p.id and s.last_ok is not null)::int,
         (select count(*) from public.notifications n where n.user_id = p.id and n.kind = 'message' and n.ref_id is null and n.reply is null and n.read_at is null)::int,
         (select min(n.created_at) from public.notifications n where n.user_id = p.id and n.kind = 'message' and n.ref_id is null and n.reply is null and n.read_at is null),
         (select count(*) from public.notifications n where n.user_id = p.id and n.read_at is null)::int,
         (select count(*) from public.activity_log a where a.actor = p.id and a.at > now() - interval '7 days'
            and a.action in ('insert','update','reply')
            and a.table_name in ('tasks','lead','projects','meetings','pmeetings','message','podreq','tasklib'))::int,
         (select max(n.created_at) from public.notifications n where n.user_id = p.id and n.kind = 'nudge')
    from public.profiles p
    left join public.presence_seen ps on ps.user_id = p.id
   where p.active and private.is_approver()
$function$;
revoke all on function public.adoption_stats() from public, anon;
grant execute on function public.adoption_stats() to authenticated;

-- Working days (Sun–Thu) at 10:30 Dhaka: anyone who hasn't opened SLATE OS for 2 days gets one push,
-- at most every 2 days, saying what is waiting for them. The Principal is never nudged.
create or replace function private.adoption_nudge()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare r record; n_msg int; n_due int;
        wk text := to_char((now() at time zone 'Asia/Dhaka')::date + 7, 'YYYY-MM-DD');
begin
  for r in
    select p.id from public.profiles p
      left join public.presence_seen ps on ps.user_id = p.id
     where p.active and p.designation <> 'principal'
       and p.created_at < now() - interval '1 day'
       and greatest(coalesce(ps.seen_at, 'epoch'), coalesce((select max(a.at) from public.activity_log a where a.actor = p.id and a.action <> 'notify'), 'epoch'))
           < now() - interval '2 days'
       and not exists (select 1 from public.notifications n where n.user_id = p.id and n.kind = 'nudge' and n.created_at > now() - interval '47 hours')
  loop
    select count(*) into n_msg from public.notifications n
     where n.user_id = r.id and n.kind = 'message' and n.ref_id is null and n.reply is null and n.read_at is null;
    select count(*) into n_due from public.docs d
     where d.assignee = r.id and d.coll in ('tasks','lead')
       and coalesce(d.data->>'doneAt', '') = '' and coalesce((d.data->>'archived')::boolean, false) = false
       and coalesce(d.data->>'target', '') <> '' and d.data->>'target' <= wk;
    insert into public.notifications (user_id, kind, title, body)
    values (r.id, 'nudge', 'SLATE OS is waiting for you',
            case when n_msg + n_due = 0 then 'You haven''t opened SLATE OS for 2 days. Take two minutes to check your week.'
                 else concat_ws(' and ',
                        case when n_msg > 0 then n_msg || ' unanswered message' || case when n_msg > 1 then 's' else '' end end,
                        case when n_due > 0 then n_due || ' task' || case when n_due > 1 then 's' else '' end || ' due this week or overdue' end)
                      || '. Open SLATE OS to catch up.' end);
  end loop;
end $function$;
revoke all on function private.adoption_nudge() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'slate-adoption-nudge';
select cron.schedule('slate-adoption-nudge', '30 4 * * 0-4', 'select private.adoption_nudge()');
