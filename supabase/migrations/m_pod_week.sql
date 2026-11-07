-- SLATE OS · POD weekly project check-in (Principal, 7 Nov 2026)
-- On the first working day of each week (Sunday, or the next working day) every POD leader goes through every
-- project of the POD and gives its status and a one-line update, so no project is missed or forgotten.
-- It is part of the morning gate: after the day plan, SLATE OS opens once the week's check-in is in.
-- One check-in per POD per week (week = the Sunday it starts). The Principal and the COO are told when it is in.
-- rows: [{pid, st, note, next, nextDate}]  st: ok | slow | client | others | help | hold | idle
-- missing: projects not in SLATE OS yet / anything missing from the list; need: what the POD needs from the Principal or the COO.
-- Safe to run more than once.

create table if not exists public.pod_weeks (
  pod        text not null,
  week       date not null,
  rows       jsonb not null default '[]'::jsonb,
  missing    text not null default '',
  need       text not null default '',
  by         uuid references public.profiles(id) on delete set null,
  at         timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (pod, week)
);
alter table public.pod_weeks enable row level security;

create or replace function private.pod_weeks_check()
returns trigger language plpgsql security definer set search_path to '' as $$
declare r jsonb; d date := (now() at time zone 'Asia/Dhaka')::date;
begin
  if extract(dow from new.week) <> 0 then raise exception 'A check-in week starts on a Sunday'; end if;
  if new.week > d then raise exception 'That week hasn''t started'; end if;
  if new.week < d - 13 then raise exception 'Check-ins older than last week are closed'; end if;
  if jsonb_typeof(new.rows) <> 'array' then raise exception 'The check-in must be a list of projects'; end if;
  for r in select * from jsonb_array_elements(new.rows) loop
    if coalesce(r->>'pid', '') = '' then raise exception 'Every line needs its project'; end if;
    if coalesce(r->>'st', '') not in ('ok', 'slow', 'client', 'others', 'help', 'hold', 'idle') then
      raise exception 'Give every project a status';
    end if;
    if coalesce(r->>'st', '') <> 'hold' and length(btrim(coalesce(r->>'note', ''))) < 10 then
      raise exception 'Write a line on every project (at least 10 characters)';
    end if;
  end loop;
  if auth.uid() is not null then new.by := auth.uid(); end if;
  if tg_op = 'UPDATE' then new.at := old.at; end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.pod_weeks_check() from public, anon, authenticated;
drop trigger if exists pod_weeks_check on public.pod_weeks;
create trigger pod_weeks_check before insert or update on public.pod_weeks
  for each row execute function private.pod_weeks_check();

drop trigger if exists zz_reviewer_guard on public.pod_weeks;
create trigger zz_reviewer_guard before insert or delete or update on public.pod_weeks
  for each row execute function private.reviewer_guard();

-- seen by the POD's own people, the Principal and the COO; written by the POD's leader (or the Principal / COO)
drop policy if exists pod_weeks_select on public.pod_weeks;
create policy pod_weeks_select on public.pod_weeks for select to authenticated
  using (private.is_top() or private.is_approver() or pod = private.my_pod());
drop policy if exists pod_weeks_insert on public.pod_weeks;
create policy pod_weeks_insert on public.pod_weeks for insert to authenticated
  with check (private.is_active() and (private.is_top() or private.is_approver() or (private.is_pod_leader() and pod = private.my_pod())));
drop policy if exists pod_weeks_update on public.pod_weeks;
create policy pod_weeks_update on public.pod_weeks for update to authenticated
  using (private.is_top() or private.is_approver() or (private.is_pod_leader() and pod = private.my_pod()))
  with check (private.is_active() and (private.is_top() or private.is_approver() or (private.is_pod_leader() and pod = private.my_pod())));
grant select, insert, update on public.pod_weeks to authenticated;
revoke all on public.pod_weeks from anon;

-- tell the Principal and the COO when a POD's check-in is in (once per POD per week)
create or replace function private.pod_weeks_notify()
returns trigger language plpgsql security definer set search_path to '' as $$
declare n int; nh int; nw int; ref text := 'podweek:' || new.pod || '@' || new.week;
begin
  n  := jsonb_array_length(new.rows);
  nh := (select count(*) from jsonb_array_elements(new.rows) x where x->>'st' in ('help', 'slow'));
  nw := (select count(*) from jsonb_array_elements(new.rows) x where x->>'st' in ('client', 'others'));
  insert into public.notifications (user_id, kind, title, body, task_ref)
  select p.id, 'podweek', 'Weekly check-in: ' || replace(new.pod, 'Pod', 'POD'),
         n || ' project' || case when n = 1 then '' else 's' end
           || case when nh > 0 then ' · ' || nh || ' slow or needing help' else '' end
           || case when nw > 0 then ' · ' || nw || ' waiting' else '' end
           || case when btrim(new.need) <> '' then ' · needs something from you' else '' end,
         ref
    from public.profiles p
   where p.active and p.designation in ('principal', 'coo') and p.id is distinct from new.by
     and not exists (select 1 from public.notifications x where x.user_id = p.id and x.task_ref = ref);
  return new;
end $$;
revoke all on function private.pod_weeks_notify() from public, anon, authenticated;
drop trigger if exists pod_weeks_notify on public.pod_weeks;
create trigger pod_weeks_notify after insert on public.pod_weeks
  for each row execute function private.pod_weeks_notify();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pod_weeks') then
    alter publication supabase_realtime add table public.pod_weeks;
  end if;
end $$;
