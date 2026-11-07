-- SLATE OS · Day plan before opening SLATE OS (Principal, 7 Nov 2026)
-- POD leaders, POD members and the Drafting Pool write the day's plan (and close yesterday's lines) before SLATE OS opens
-- on a working day. Settings: config/settings → planGate {from: 'YYYY-MM-DD', off: bool, open: {'YYYY-MM-DD': 'all' | [user ids]}}.
-- 1. Only the Principal or the COO changes planGate (switch it on or off, or open SLATE OS for a day).
-- 2. The gate starts on Sunday 9 Nov 2026.
-- Plan lines may now carry: part (today's part of a task running for several days), wait {on, since} (waiting on someone),
-- moved (times the finish-by date was moved), lateWhy, why (reason a line was stopped), extra (added the next morning).
-- No change to the work_logs checks: those fields ride on the existing lines.
-- Safe to run more than once.

create or replace function private.plan_gate_guard()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.path = 'config/settings'
     and (new.data->'planGate') is distinct from (case when tg_op = 'UPDATE' then old.data->'planGate' else null end)
     and auth.uid() is not null   -- the SQL editor and server jobs set it directly
     and not (private.is_top() or private.is_owner()) then
    raise exception 'Only the Principal or the COO changes the day plan rule';
  end if;
  return new;
end $$;
revoke all on function private.plan_gate_guard() from public, anon, authenticated;

drop trigger if exists b1_plan_gate_guard on public.docs;
create trigger b1_plan_gate_guard before insert or update on public.docs
  for each row when (new.path = 'config/settings') execute function private.plan_gate_guard();

-- switch it on from Sunday 9 Nov 2026 (keeps any day already opened)
update public.docs
   set data = jsonb_set(data, '{planGate}',
                        coalesce(data->'planGate', '{}'::jsonb) || jsonb_build_object('from', '2026-11-09', 'off', false))
 where path = 'config/settings'
   and coalesce(data->'planGate'->>'from', '') = '';
