-- Presence in the performance index (13 Nov 2026).
-- A working day counts as present when the person opened SLATE OS (day_log, computer or phone) or wrote the day plan
-- (work_logs). Days with neither are absent. The Principal or the COO can mark a day as approved leave, which counts
-- as half an absence. The app does the scoring; the database only answers which days each person was present or on leave.
create table if not exists private.perf_leave (
  user_id uuid not null references public.profiles(id),
  day date not null,
  by_id uuid not null references public.profiles(id),
  at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table private.perf_leave enable row level security;
revoke all on private.perf_leave from public, anon, authenticated;

-- Who may see whose presence: the Principal and the COO everyone; a POD leader their own POD; everyone else only themselves.
-- Discipline (13 Nov 2026): for each day plan also the time it was written, how many lines were short (under 20
-- characters of text and today's part together), the latest day any line was closed, and how many lines are still open.
drop function if exists public.perf_presence(date, date);
create or replace function public.perf_presence(p_from date, p_to date)
returns table (user_id uuid, day date, opened boolean, plan boolean, leave boolean,
               plan_at timestamptz, short_n int, lines_n int, closed_max date, open_n int)
language sql stable security definer set search_path to '' as $$
  with me as (select id, designation::text d, pod_id from public.profiles where id = auth.uid()),
  seen as (
    select p.id from public.profiles p, me
    where private.is_top() or p.id = me.id or (me.d = 'pod_leader' and me.pod_id is not null and p.pod_id = me.pod_id)
  ),
  x as (
    select l.user_id, l.day, 1 o, 0 w, 0 v from public.day_log l where l.day between p_from and p_to
    union all
    select w.user_id, w.day, 0, 1, 0 from public.work_logs w where w.day between p_from and p_to
    union all
    select v.user_id, v.day, 0, 0, 1 from private.perf_leave v where v.day between p_from and p_to
  ),
  wl as (
    select w.user_id, w.day, w.submitted_at,
      (select count(*) from jsonb_array_elements(w.lines) l
        where length(trim(coalesce(l->>'text','') || case when coalesce(l->>'part','') <> coalesce(l->>'text','') then ' ' || coalesce(l->>'part','') else '' end)) < 20)::int short_n,
      jsonb_array_length(w.lines) lines_n,
      (select max(((l->>'closedAt')::timestamptz at time zone 'Asia/Dhaka')::date) from jsonb_array_elements(w.lines) l where l ? 'closedAt') closed_max,
      (select count(*) from jsonb_array_elements(w.lines) l where coalesce(l->>'status','planned') = 'planned')::int open_n
    from public.work_logs w where w.day between p_from and p_to
  )
  select x.user_id, x.day, max(o) = 1, max(w) = 1, max(v) = 1,
         wl.submitted_at, wl.short_n, wl.lines_n, wl.closed_max, wl.open_n
  from x left join wl on wl.user_id = x.user_id and wl.day = x.day
  where x.user_id in (select id from seen)
  group by x.user_id, x.day, wl.submitted_at, wl.short_n, wl.lines_n, wl.closed_max, wl.open_n;
$$;

-- Principal or COO: mark (p_on = true) or clear a day of approved leave.
create or replace function public.perf_leave_set(p_user uuid, p_day date, p_on boolean)
returns boolean language plpgsql security definer set search_path to '' as $$
begin
  if not private.is_top() then raise exception 'Only the Principal or the COO can mark leave.'; end if;
  if private.reviewer_live() then return p_on; end if;
  if p_on then
    insert into private.perf_leave (user_id, day, by_id) values (p_user, p_day, auth.uid())
    on conflict (user_id, day) do update set by_id = excluded.by_id, at = now();
  else
    delete from private.perf_leave where user_id = p_user and day = p_day;
  end if;
  return p_on;
end $$;

revoke all on function public.perf_presence(date, date) from public, anon;
revoke all on function public.perf_leave_set(uuid, date, boolean) from public, anon;
grant execute on function public.perf_presence(date, date) to authenticated;
grant execute on function public.perf_leave_set(uuid, date, boolean) to authenticated;
