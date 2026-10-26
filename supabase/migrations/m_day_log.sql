-- Entry log (More › Entry log), Principal and COO only.
-- One row per person, per day, per device type (computer / mobile), so phone use is recorded separately.
--   in_at  : first tap on the morning greeting on that device type (server time)
--   out_at : the latest time SLATE OS was closed (or last used) that day on that device type; a reopen and close replaces it
--   out_src: 'closed' (the app was closed) or 'active' (last activity seen; the close itself wasn't caught)
create table if not exists public.day_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  device text not null check (device in ('computer','mobile')),
  in_at timestamptz,
  out_at timestamptz,
  out_src text check (out_src in ('closed','active')),
  primary key (user_id, day, device)
);
alter table public.day_log enable row level security;

drop policy if exists day_log_select on public.day_log;
create policy day_log_select on public.day_log for select to authenticated
  using ((select private.is_owner()) or (select private.is_coo()));
-- no insert/update/delete policies: rows are written only through the functions below

create or replace function public.log_day_in(p_device text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare d date := (now() at time zone 'Asia/Dhaka')::date; dev text := case when p_device = 'mobile' then 'mobile' else 'computer' end;
begin
  if (select auth.uid()) is null then return; end if;
  insert into public.day_log (user_id, day, device, in_at) values ((select auth.uid()), d, dev, now())
  on conflict (user_id, day, device) do update set in_at = coalesce(public.day_log.in_at, excluded.in_at);
end $function$;

create or replace function public.log_day_out(p_device text, p_src text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare d date := (now() at time zone 'Asia/Dhaka')::date; dev text := case when p_device = 'mobile' then 'mobile' else 'computer' end;
        src text := case when p_src = 'closed' then 'closed' else 'active' end;
begin
  if (select auth.uid()) is null then return; end if;
  insert into public.day_log (user_id, day, device, out_at, out_src) values ((select auth.uid()), d, dev, now(), src)
  on conflict (user_id, day, device) do update set out_at = excluded.out_at, out_src = excluded.out_src;
end $function$;

revoke all on function public.log_day_in(text) from public, anon;
revoke all on function public.log_day_out(text, text) from public, anon;
grant execute on function public.log_day_in(text) to authenticated;
grant execute on function public.log_day_out(text, text) to authenticated;

-- 'noreply': the computer was left on in the evening and nobody answered "Are you still working?" (asked from 9 pm);
-- Out = the time asked + 5 minutes (p_at, accepted only within the last 15 minutes).
alter table public.day_log drop constraint if exists day_log_out_src_check;
alter table public.day_log add constraint day_log_out_src_check check (out_src in ('closed','active','noreply'));
drop function if exists public.log_day_out(text, text);
create or replace function public.log_day_out(p_device text, p_src text, p_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare d date := (now() at time zone 'Asia/Dhaka')::date; dev text := case when p_device = 'mobile' then 'mobile' else 'computer' end;
        src text := case when p_src in ('closed','noreply') then p_src else 'active' end;
        t timestamptz := now();
begin
  if (select auth.uid()) is null then return; end if;
  if src = 'noreply' and p_at is not null and p_at between now() - interval '15 minutes' and now() then t := p_at; end if;
  insert into public.day_log (user_id, day, device, out_at, out_src) values ((select auth.uid()), d, dev, t, src)
  on conflict (user_id, day, device) do update set out_at = excluded.out_at, out_src = excluded.out_src;
end $function$;
revoke all on function public.log_day_out(text, text, timestamptz) from public, anon;
grant execute on function public.log_day_out(text, text, timestamptz) to authenticated;
