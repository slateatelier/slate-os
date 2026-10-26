-- Adoption on Home: each person sees their own adoption status (same signals as People → Adoption), as one percentage.
-- Own row only; counts, no content. Shown on Home for two weeks around go-live (until 10 Nov 2026).
create or replace function public.my_adoption()
returns table(seen_at timestamptz, last_action timestamptz, devices int, devices_ok int,
              msgs_open int, oldest_msg timestamptz, updates_7d int)
language sql
stable
security definer
set search_path to ''
as $function$
  select ps.seen_at,
         (select max(a.at) from public.activity_log a where a.actor = p.id and a.action <> 'notify'),
         (select count(*) from public.push_subs s where s.user_id = p.id)::int,
         (select count(*) from public.push_subs s where s.user_id = p.id and s.last_ok is not null)::int,
         (select count(*) from public.notifications n where n.user_id = p.id and n.kind = 'message' and n.ref_id is null and n.reply is null and n.read_at is null)::int,
         (select min(n.created_at) from public.notifications n where n.user_id = p.id and n.kind = 'message' and n.ref_id is null and n.reply is null and n.read_at is null),
         (select count(*) from public.activity_log a where a.actor = p.id and a.at > now() - interval '7 days'
            and a.action in ('insert','update','reply')
            and a.table_name in ('tasks','lead','projects','meetings','pmeetings','message','podreq','tasklib'))::int
    from public.profiles p
    left join public.presence_seen ps on ps.user_id = p.id
   where p.id = (select auth.uid()) and p.active
$function$;
revoke all on function public.my_adoption() from public, anon;
grant execute on function public.my_adoption() to authenticated;
