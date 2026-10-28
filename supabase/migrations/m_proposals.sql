-- SLATE OS · Proposed projects (28 Oct 2026)
-- Projects SLATE has proposed but not yet won, kept in proposals/<id>. Only the Principal and the COO can see, add,
-- change or delete them: no one else can read them, even directly from the database, and they stay out of everyone
-- else's activity log. When a proposal is confirmed it becomes an ordinary client project (a new projects/<id>).
-- The Principal and the COO are notified when the other one logs a client response or changes the status, and on the
-- follow-up date (then every 3 days while it is overdue). Run in Supabase › SQL Editor. Safe to run more than once.

-- 1. Principal or COO (by designation, not the approver flag)
create or replace function private.is_top() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and designation in ('principal', 'coo'))
$$;

-- 2. allow the new collection
do $mig$
declare d text;
begin
  d := pg_get_functiondef('private.docs_derive'::regproc);
  if position('''proposals''' in d) = 0 then
    if position('''data'',''agreements'') then' in d) = 0 then raise exception 'docs_derive has changed; update this migration'; end if;
    execute replace(d, '''data'',''agreements'') then', '''data'',''agreements'',''proposals'') then');
  end if;
end $mig$;

-- the write guard: proposals are written only by the Principal and the COO
do $mig$
declare d text; a text := '  ch := private.changed_keys(od, nd);';
begin
  d := pg_get_functiondef('private.docs_guard'::regproc);
  if position('rw.coll = ''proposals''' in d) = 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'docs_guard has changed; update this migration'; end if;
    execute replace(d, a, a || $n$
  -- proposed projects: the Principal and the COO only
  if rw.coll = 'proposals' then
    if not private.is_top() then raise exception 'Only the Principal or the COO manages proposed projects'; end if;
    return coalesce(new, old);
  end if;$n$);
  end if;
end $mig$;

-- 3. only the Principal and the COO, for every read and write (restrictive: on top of the existing rules)
drop policy if exists docs_proposals_top on public.docs;
create policy docs_proposals_top on public.docs as restrictive for all to authenticated
  using (left(path, 10) <> 'proposals/' or (select private.is_top()))
  with check (left(path, 10) <> 'proposals/' or (select private.is_top()));
drop policy if exists log_proposals_top on public.activity_log;
create policy log_proposals_top on public.activity_log as restrictive for select to authenticated
  using (table_name <> 'proposals' or (select private.is_top()));

-- 4. tell the other one when a client response is logged or the status changes
create or replace function private.docs_proposal_notify() returns trigger language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); nm text; e jsonb; n_old int; ttl text; body text; u uuid;
begin
  nm := coalesce(nullif(new.data->>'name', ''), 'Proposal') || coalesce(' · ' || nullif(new.data->>'client', ''), '');
  n_old := case when tg_op = 'UPDATE' and jsonb_typeof(old.data->'log') = 'array' then jsonb_array_length(old.data->'log') else 0 end;
  if tg_op = 'INSERT' then
    ttl := 'New proposed project: ' || nm; body := coalesce(nullif(new.data->>'scopeNote', ''), 'Proposed projects');
  elsif coalesce(new.data->>'status', 'open') <> coalesce(old.data->>'status', 'open') then
    ttl := case new.data->>'status' when 'won' then 'Proposal confirmed: ' when 'lost' then 'Proposal lost: ' when 'dropped' then 'Proposal dropped: ' else 'Proposal reopened: ' end || nm;
    body := coalesce(nullif(new.data->>'outcomeNote', ''), case when new.data->>'status' = 'won' then 'It is now a client project.' else 'Proposed projects' end);
  elsif jsonb_typeof(new.data->'log') = 'array' and jsonb_array_length(new.data->'log') > n_old then
    e := new.data->'log'->-1;
    ttl := 'Client response logged: ' || nm;
    body := concat_ws(' · ', nullif(e->>'kindL', ''), nullif(e->>'respL', ''))
            || coalesce(E'\n“' || nullif(e->>'note', '') || '”', '')
            || coalesce(E'\nNext follow-up ' || to_char(nullif(new.data->>'next', '')::date, 'FMDD Mon'), '');
  else return null; end if;
  for u in select id from public.profiles where active and designation in ('principal', 'coo') and id is distinct from me loop
    insert into public.notifications (user_id, kind, title, body) values (u, 'proposal', ttl, body);
  end loop;
  return null;
end $$;
drop trigger if exists i_docs_proposal_notify on public.docs;
create trigger i_docs_proposal_notify after insert or update on public.docs
  for each row when (new.coll = 'proposals') execute function private.docs_proposal_notify();

-- 5. follow-up reminders, working days at 9:15 Dhaka: on the follow-up date, then every 3 days while overdue
--    (a date that falls on a Friday or Saturday is reminded on the Sunday)
create or replace function private.proposal_followups() returns void language plpgsql security definer set search_path = '' as $$
declare td date := (now() at time zone 'Asia/Dhaka')::date; r record; u uuid; last jsonb; dd int;
begin
  if extract(dow from td) in (5, 6) then return; end if;
  for r in select data from public.docs where coll = 'proposals' and coalesce(data->>'status', 'open') = 'open'
             and coalesce(data->>'next', '') ~ '^\d{4}-\d{2}-\d{2}$' and (data->>'next')::date <= td loop
    dd := td - (r.data->>'next')::date;
    if not (dd = 0 or dd % 3 = 0 or (extract(dow from td) = 0 and dd in (1, 2))) then continue; end if;
    last := case when jsonb_typeof(r.data->'log') = 'array' and jsonb_array_length(r.data->'log') > 0 then r.data->'log'->-1 end;
    for u in select id from public.profiles where active and designation in ('principal', 'coo') loop
      insert into public.notifications (user_id, kind, title, body)
      values (u, 'proposal',
              'Follow up' || case when dd > 0 then ' (' || dd || ' day' || case when dd = 1 then '' else 's' end || ' overdue)' else ' today' end
                || ': ' || coalesce(nullif(r.data->>'name', ''), 'Proposal') || coalesce(' · ' || nullif(r.data->>'client', ''), ''),
              coalesce('Last: ' || to_char((last->>'at')::timestamptz at time zone 'Asia/Dhaka', 'FMDD Mon') || ' · '
                       || concat_ws(' · ', nullif(last->>'kindL', ''), nullif(last->>'respL', ''))
                       || coalesce(E'\n“' || nullif(last->>'note', '') || '”', ''), 'No client response logged yet.'));
    end loop;
  end loop;
end $$;
select cron.unschedule('slate-proposal-followups') where exists (select 1 from cron.job where jobname = 'slate-proposal-followups');
select cron.schedule('slate-proposal-followups', '15 3 * * 0-4', 'select private.proposal_followups()');
