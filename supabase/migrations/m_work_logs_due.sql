-- Daily plan: finish-by dates and task requests (4 Nov 2026)
-- 1. Each plan line may carry a finish-by date (`due`, YYYY-MM-DD): the day of the plan or later, within 60 days.
--    The app brings a line back each morning until that date (Finished / Finish today / Ongoing / Stopped).
-- 2. Someone with no task for the day can ask for one: a plan line with `ask` {at, to}. `to` must be their own
--    POD leader (or the Design Associate Lead for the Drafting Pool, or any manager in their team) or the COO.
--    The person asked gets a notification (phone push), at most one per person per day.
-- Safe to run more than once.

create or replace function private.work_logs_check()
returns trigger language plpgsql security definer set search_path to '' as $$
declare l jsonb; n int; dd date;
begin
  if jsonb_typeof(new.lines) <> 'array' then raise exception 'The plan must be a list of lines'; end if;
  n := jsonb_array_length(new.lines);
  if n < 1 then raise exception 'Write at least one line: what you are working on today'; end if;
  if n > 8 then raise exception 'Keep the plan to 8 lines or fewer'; end if;
  for l in select * from jsonb_array_elements(new.lines) loop
    if length(btrim(coalesce(l->>'text', ''))) < 10 then
      raise exception 'Write what you will do on each line (at least 10 characters)';
    end if;
    if coalesce(l->>'status', 'planned') not in ('planned', 'done', 'carried', 'stopped') then
      raise exception 'Unknown status on a line';
    end if;
    if l ? 'due' and coalesce(l->>'due', '') <> '' then
      if (l->>'due') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'The finish-by date is not a date'; end if;
      dd := (l->>'due')::date;
      if dd < new.day then raise exception 'A finish-by date can''t be before the day of the plan'; end if;
      if dd > new.day + 60 then raise exception 'Pick a finish-by date within 60 days'; end if;
    end if;
  end loop;
  if new.day > (now() at time zone 'Asia/Dhaka')::date then raise exception 'A plan can''t be written for a future day'; end if;
  if new.day < (now() at time zone 'Asia/Dhaka')::date - 10 then raise exception 'Logs older than 10 days are closed'; end if;
  if tg_op = 'UPDATE' then new.submitted_at := old.submitted_at; end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.work_logs_check() from public, anon, authenticated;

-- a request for a task: tell the person asked (once per person per day)
create or replace function private.work_logs_ask()
returns trigger language plpgsql security definer set search_path to '' as $$
declare l jsonb; who text; me record; tid uuid; ref text;
begin
  if new.day <> (now() at time zone 'Asia/Dhaka')::date or private.is_reviewer_id(new.user_id) then return new; end if;
  select id, coalesce(nullif(full_name, ''), 'Someone') nm, team, pod_id into me from public.profiles where id = new.user_id;
  ref := 'ask:' || new.user_id || '@' || new.day;
  if exists (select 1 from public.notifications x where x.task_ref = ref) then return new; end if;
  for l in select * from jsonb_array_elements(new.lines) loop
    continue when jsonb_typeof(l->'ask') is distinct from 'object' or coalesce(l->'ask'->>'to', '') !~ '^[0-9a-f-]{36}$';
    continue when coalesce(l->>'status', 'planned') <> 'planned';
    tid := (l->'ask'->>'to')::uuid;
    continue when tid = new.user_id or not exists (
      select 1 from public.profiles p
       where p.id = tid and p.active
         and (p.designation = 'coo'
              or (p.team = me.team and (p.designation in ('pod_leader', 'design_associate_lead') or p.is_manager))));
    insert into public.notifications (user_id, kind, title, body, task_ref)
    values (tid, 'task_ask', me.nm || ' needs a task for today', left(btrim(l->>'text'), 300), ref);
    exit;
  end loop;
  return new;
end $$;
revoke all on function private.work_logs_ask() from public, anon, authenticated;
drop trigger if exists work_logs_ask on public.work_logs;
create trigger work_logs_ask after insert or update on public.work_logs
  for each row execute function private.work_logs_ask();
