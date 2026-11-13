-- Entry PIN (PCs only). Each person sets a 4-digit PIN on their first morning; after that the
-- computer entry in day_log is written only when the right PIN is typed at the morning greeting.
-- Phones are unchanged. The Principal or COO can clear a forgotten PIN (the person sets a new one next morning).

create table if not exists private.entry_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  set_at timestamptz not null default now(),
  fails int not null default 0,
  locked_until timestamptz
);
revoke all on private.entry_pins from public, anon, authenticated;

-- writes the computer entry for today (no checks; only called from the PIN functions below)
create or replace function private.entry_log_in(p_user uuid) returns void
language plpgsql security definer set search_path to '' as $$
declare d date := (now() at time zone 'Asia/Dhaka')::date;
begin
  insert into public.day_log (user_id, day, device, in_at) values (p_user, d, 'computer', now())
  on conflict (user_id, day, device) do update set in_at = coalesce(public.day_log.in_at, excluded.in_at);
end $$;
revoke all on function private.entry_log_in(uuid) from public, anon, authenticated;

create or replace function public.entry_pin_status() returns jsonb
language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'set', exists(select 1 from private.entry_pins where user_id = auth.uid()),
    'locked_until', (select case when locked_until > now() then locked_until end from private.entry_pins where user_id = auth.uid()));
$$;

create or replace function public.entry_pin_set(p_pin text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare u uuid := auth.uid();
begin
  if u is null then return jsonb_build_object('ok', false, 'msg', 'Not signed in'); end if;
  if p_pin !~ '^[0-9]{4}$' then return jsonb_build_object('ok', false, 'msg', 'Use 4 digits'); end if;
  if p_pin ~ '^(.)\1{3}$' or p_pin in ('0123','1234','2345','3456','4567','5678','6789','9876','8765','7654','6543','5432','4321','3210') then
    return jsonb_build_object('ok', false, 'msg', 'Too easy to guess. Pick another');
  end if;
  if exists(select 1 from private.entry_pins where user_id = u) then
    return jsonb_build_object('ok', false, 'msg', 'PIN already set');
  end if;
  insert into private.entry_pins (user_id, pin_hash) values (u, extensions.crypt(p_pin, extensions.gen_salt('bf')));
  perform private.entry_log_in(u);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.entry_pin_in(p_pin text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare u uuid := auth.uid(); r private.entry_pins%rowtype; left_n int;
begin
  if u is null then return jsonb_build_object('ok', false, 'msg', 'Not signed in'); end if;
  select * into r from private.entry_pins where user_id = u for update;
  if not found then return jsonb_build_object('ok', false, 'unset', true); end if;
  if r.locked_until > now() then return jsonb_build_object('ok', false, 'locked_until', r.locked_until); end if;
  if coalesce(p_pin, '') ~ '^[0-9]{4}$' and extensions.crypt(p_pin, r.pin_hash) = r.pin_hash then
    update private.entry_pins set fails = 0, locked_until = null where user_id = u;
    perform private.entry_log_in(u);
    return jsonb_build_object('ok', true);
  end if;
  if r.fails + 1 >= 5 then
    update private.entry_pins set fails = 0, locked_until = now() + interval '15 minutes' where user_id = u;
    return jsonb_build_object('ok', false, 'locked_until', now() + interval '15 minutes');
  end if;
  update private.entry_pins set fails = r.fails + 1 where user_id = u;
  left_n := 5 - (r.fails + 1);
  return jsonb_build_object('ok', false, 'left', left_n);
end $$;

create or replace function public.entry_pin_reset(p_user uuid) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if not private.is_top() then raise exception 'Only the Principal or COO can reset a PIN'; end if;
  delete from private.entry_pins where user_id = p_user;
end $$;

-- who has a PIN (Principal/COO only; for the Entry log)
create or replace function public.entry_pin_list() returns table(user_id uuid, set_at timestamptz)
language sql stable security definer set search_path to '' as $$
  select e.user_id, e.set_at from private.entry_pins e where private.is_top();
$$;

-- Once a person has a PIN, the plain computer entry no longer counts: only the PIN writes it.
-- (People without a PIN yet, and phones, keep working as before.)
create or replace function public.log_day_in(p_device text) returns void
language plpgsql security definer set search_path to '' as $$
declare d date := (now() at time zone 'Asia/Dhaka')::date; dev text := case when p_device = 'mobile' then 'mobile' else 'computer' end;
begin
  if (select auth.uid()) is null then return; end if;
  if dev = 'computer' and exists(select 1 from private.entry_pins where user_id = (select auth.uid())) then return; end if;
  insert into public.day_log (user_id, day, device, in_at) values ((select auth.uid()), d, dev, now())
  on conflict (user_id, day, device) do update set in_at = coalesce(public.day_log.in_at, excluded.in_at);
end $$;

-- Presence: a day_log row counts as "in" only when it has an entry time (a sign-out alone is not an entry)
create or replace function public.perf_presence(p_from date, p_to date)
 returns table(user_id uuid, day date, opened boolean, plan boolean, leave boolean, plan_at timestamptz, short_n integer, lines_n integer, closed_max date, open_n integer, absent boolean)
 language sql stable security definer set search_path to '' as $function$
  with me as (select id, designation::text d, pod_id from public.profiles where id = auth.uid()),
  seen as (
    select p.id from public.profiles p, me
    where private.is_top() or p.id = me.id or (me.d = 'pod_leader' and me.pod_id is not null and p.pod_id = me.pod_id)
  ),
  x as (
    select l.user_id, l.day, 1 o, 0 w, 0 v, 0 a from public.day_log l where l.day between p_from and p_to and l.in_at is not null
    union all
    select w.user_id, w.day, 0, 1, 0, 0 from public.work_logs w where w.day between p_from and p_to
    union all
    select v.user_id, v.day, 0, 0, (v.kind = 'leave')::int, (v.kind = 'absent')::int from private.perf_leave v where v.day between p_from and p_to
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
         wl.submitted_at, wl.short_n, wl.lines_n, wl.closed_max, wl.open_n, max(a) = 1
  from x left join wl on wl.user_id = x.user_id and wl.day = x.day
  where x.user_id in (select id from seen)
  group by x.user_id, x.day, wl.submitted_at, wl.short_n, wl.lines_n, wl.closed_max, wl.open_n;
$function$;

revoke all on function public.entry_pin_status(), public.entry_pin_set(text), public.entry_pin_in(text),
  public.entry_pin_reset(uuid), public.entry_pin_list() from public, anon;
grant execute on function public.entry_pin_status(), public.entry_pin_set(text), public.entry_pin_in(text),
  public.entry_pin_reset(uuid), public.entry_pin_list() to authenticated;
