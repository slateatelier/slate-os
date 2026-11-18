-- SLATE OS · COO feedback 04 (18 Nov 2026), release 2.066. Run once in the Supabase SQL editor. Safe to run twice.
-- 1. Approval chain: requests reach the COO first (the Principal is told only when no COO is active, or the COO raised it).
--    The COO decides the everyday ones and the Principal gets an "FYI" note when she does. The ones that need the Principal
--    she checks and sends on: apprchain/<COO>/items/<key> → the Principal is notified "Checked by the COO · to approve".
-- 2. New collections: apprchain (the COO's "checked" marks), blockers (a task's blocker and its way forward),
--    leave (dated leave: apply → COO approves) and bdays (date of birth, month and day only).

-- collections allowed
create or replace function private.docs_derive()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare seg text[] := string_to_array(new.path, '/'); nseg int := array_length(string_to_array(new.path, '/'), 1);
begin
  new.coll := seg[1];
  if nseg = 2 then new.parent := null; new.doc_id := seg[2];
  elsif new.coll = 'data' and nseg = 4 then new.parent := seg[3]; new.doc_id := seg[4];
  elsif nseg = 4 then new.parent := seg[2]; new.doc_id := seg[4];
  else raise exception 'Unsupported path %', new.path; end if;
  if new.coll not in ('config','meetcfg','members','projects','tasks','lead','pmeetings','meetings','tasklib',
                      'types','podnames','podreq','podjoin','rolereq','farlog','data','agreements','proposals','clients',
                      'apprchain','blockers','leave','bdays') then
    raise exception 'Unknown collection %', new.coll;
  end if;
  if new.path = 'config/settings' then
    new.data := new.data - 'roster' - 'managers' - 'approvers' - 'privateIds' - 'ownerId';
  end if;
  new.project_id := case when new.coll in ('projects','agreements') then new.doc_id
                         when new.coll in ('tasks','lead','pmeetings') then nullif(new.data->>'projectId', '')
                         when new.coll = 'blockers' then nullif(new.data->>'projectId', '') end;
  new.assignee := case when new.coll in ('tasks','lead') then coalesce(private.as_uuid(new.data->>'assignee'),
                         case when new.coll = 'lead' then private.as_uuid(new.parent) end) end;
  new.is_private := new.coll = 'lead';
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by);
  else new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end $function$;

-- who writes the new collections (edit of private.docs_guard: two inserted blocks, the rest unchanged)
do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('private.docs_guard'::regproc);
  if position('apprchain' in d) > 0 then return; end if;
  n := replace(d,
    E'    if rw.coll = ''data'' and rw.parent = uid::text then return old; end if;\n',
    E'    if rw.coll = ''data'' and rw.parent = uid::text then return old; end if;\n'
    || E'    if rw.coll = ''apprchain'' and rw.parent = uid::text and is_appr then return old; end if;\n'
    || E'    if rw.coll = ''leave'' and (is_appr or (rw.parent = uid::text and od->>''status'' = ''pending'')) then return old; end if;\n'
    || E'    if rw.coll = ''blockers'' and is_appr then return old; end if;\n');
  n := replace(n,
    E'  if rw.coll in (''podnames'',''podreq'') then\n    if rw.parent = uid::text and (is_appr',
    E'  if rw.coll = ''apprchain'' then\n'
    || E'    if rw.parent = uid::text and is_appr then return new; end if;\n'
    || E'    raise exception ''Only the COO marks requests as checked, in her own name'';\n'
    || E'  elsif rw.coll = ''leave'' then\n'
    || E'    if is_appr then return new; end if;\n'
    || E'    if rw.parent = uid::text and coalesce(nd->>''status'', '''') = ''pending'' and coalesce(od->>''status'', ''pending'') = ''pending'' then return new; end if;\n'
    || E'    raise exception ''Leave is applied for in your own name; the COO approves it'';\n'
    || E'  elsif rw.coll = ''bdays'' then\n'
    || E'    if is_appr or rw.doc_id = uid::text then return new; end if;\n'
    || E'    raise exception ''Only you or the COO set your birthday'';\n'
    || E'  elsif rw.coll = ''blockers'' then\n'
    || E'    if is_appr then return new; end if;\n'
    || E'    if (nd->''fix'', nd->''dec'') is distinct from (od->''fix'', od->''dec'') then raise exception ''The way forward is written by the COO and approved by the Principal''; end if;\n'
    || E'    if coalesce(nd->>''status'', '''') not in (''open'', ''cleared'') then raise exception ''Only the COO and the Principal move a blocker on''; end if;\n'
    || E'    return new;\n'
    || E'  end if;\n\n'
    || E'  if rw.coll in (''podnames'',''podreq'') then\n    if rw.parent = uid::text and (is_appr');
  if n = d or position('apprchain' in n) = 0 or position('''blockers'' and is_appr then return old' in n) = 0 then
    raise exception 'docs_guard did not change as expected';
  end if;
  execute n;
end $do$;

-- reading: the COO's checked marks are for the Principal and the COO
do $do$
declare q text;
begin
  select qual into q from pg_policies where schemaname = 'public' and tablename = 'docs' and policyname = 'docs_select';
  if position('apprchain' in q) > 0 then return; end if;
  q := regexp_replace(q, '\n\s*ELSE true\s*\nEND\s*$', E'\n    WHEN ''apprchain''::text THEN ( SELECT private.is_approver() AS is_approver)\n    ELSE true\nEND');
  if position('apprchain' in q) = 0 then raise exception 'docs_select did not change as expected'; end if;
  execute format('alter policy docs_select on public.docs using (%s)', q);
end $do$;

-- requests reach the COO first
create or replace function private.notify_approvers(p_kind text, p_title text, p_body text, p_principal_only boolean default false)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare u uuid; has_coo boolean;
begin
  has_coo := not p_principal_only and exists (select 1 from public.profiles where active and designation <> 'principal'
                and (designation = 'coo' or is_approver) and id is distinct from auth.uid());
  for u in select id from public.profiles
           where active and case when has_coo then designation <> 'principal' and (designation = 'coo' or is_approver)
                                 else designation = 'principal' end loop
    perform private.notify(u, p_kind, p_title,
      case when has_coo and p_kind in ('project_request','extra_request','pod_request','nick_request')
           then concat_ws(E'\n', p_body, 'Check it, then send it to the Principal') else p_body end);
  end loop;
end $function$;

-- the Principal gets an FYI when the COO decides
create or replace function private.notify(p_user uuid, p_kind text, p_title text, p_body text)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare pu uuid; ft text; fb text;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  if not exists (select 1 from public.profiles where id = p_user and active) then return; end if;
  insert into public.notifications (user_id, kind, title, body) values (p_user, p_kind, left(p_title, 90), left(coalesce(p_body, ''), 320));
  if p_kind in ('date_approved','date_declined','task_verified','task_returned','assign_approved','assign_declined','phase_approved','phase_declined',
                'minutes_returned','minutes_published','lib_approved','lib_declined','pod_approved','pod_declined','nick_approved','nick_declined',
                'extra_approved','extra_declined','project_approved','project_declined','leave_approved','leave_declined','blocker_returned')
     and coalesce(p_body, '') not like '%You attended this meeting'
     and exists (select 1 from public.profiles where id = auth.uid() and active and designation <> 'principal' and (designation = 'coo' or is_approver)) then
    ft := left('FYI · ' || p_title, 90); fb := left(coalesce(p_body, ''), 320);
    for pu in select id from public.profiles where active and designation = 'principal' and id <> p_user loop
      if not exists (select 1 from public.notifications where user_id = pu and kind = 'fyi' and title = ft and body = fb and created_at > now() - interval '2 minutes') then
        insert into public.notifications (user_id, kind, title, body) values (pu, 'fyi', ft, fb);
      end if;
    end loop;
  end if;
end $function$;

-- notifications for the new collections
create or replace function private.docs_notify_chain()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  od jsonb := case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end;
  nd jsonb := new.data;
  actor text := coalesce(private.person_name(auth.uid()), 'SLATE OS');
  u uuid; who uuid; ttl text;
begin
  begin
  if new.coll = 'apprchain' and tg_op = 'INSERT' then
    for u in select id from public.profiles where active and designation = 'principal' loop
      perform private.notify(u, 'chain_checked', 'Checked by ' || actor || ' · to approve',
        concat_ws(E'\n', nullif(nd->>'label', ''), case when coalesce(nd->>'note', '') <> '' then '“' || (nd->>'note') || '”' end));
    end loop;

  elsif new.coll = 'blockers' and (nd->>'status') is distinct from (od->>'status') then
    ttl := concat_ws(E'\n', coalesce(nullif(nd->>'title', ''), 'A task'), private.project_line(new.project_id));
    who := private.as_uuid(nd->>'assignee');
    if nd->>'status' = 'open' then
      perform private.notify_approvers('blocker', 'Blocked · ' || actor,
        concat_ws(E'\n', ttl, case when coalesce(nd->>'what', '') <> '' then '“' || (nd->>'what') || '”' end));
    elsif nd->>'status' = 'proposed' then
      for u in select id from public.profiles where active and designation = 'principal' loop
        perform private.notify(u, 'blocker_fix', 'Way forward to approve · ' || actor,
          concat_ws(E'\n', ttl, 'Blocked: ' || coalesce(nd->>'what', ''), 'Way forward: ' || coalesce(nd->'fix'->>'text', '')));
      end loop;
    elsif nd->>'status' = 'approved' then
      perform private.notify(who, 'blocker_approved', 'Way forward approved by ' || actor,
        concat_ws(E'\n', ttl, coalesce(nd->'fix'->>'text', '')));
      perform private.notify(private.as_uuid(nd->>'by'), 'blocker_approved', 'Way forward approved by ' || actor,
        concat_ws(E'\n', ttl, coalesce(nd->'fix'->>'text', '')));
      perform private.notify(private.as_uuid(nd->'fix'->>'by'), 'blocker_approved', 'Way forward approved by ' || actor,
        concat_ws(E'\n', ttl, coalesce(nd->'fix'->>'text', '')));
    elsif nd->>'status' = 'returned' then
      perform private.notify(private.as_uuid(nd->'fix'->>'by'), 'blocker_returned', 'Way forward returned by ' || actor,
        concat_ws(E'\n', ttl, coalesce('“' || nullif(nd->'dec'->>'note', '') || '”', '')));
    elsif nd->>'status' = 'cleared' then
      perform private.notify_approvers('blocker_cleared', 'Unblocked · ' || actor, ttl);
    end if;

  elsif new.coll = 'leave' and (nd->>'status') is distinct from (od->>'status') then
    ttl := concat_ws(' · ', coalesce(nullif(nd->>'type', ''), 'Leave'),
      private.fmt_d(nd->>'from') || case when coalesce(nd->>'to', '') <> '' and nd->>'to' <> nd->>'from' then ' to ' || private.fmt_d(nd->>'to') else '' end);
    if nd->>'status' = 'pending' then
      perform private.notify_approvers('leave_request', 'Leave to approve · ' || actor, concat_ws(E'\n', ttl, nullif(nd->>'note', '')));
    elsif nd->>'status' in ('approved','declined') and private.as_uuid(new.parent) is distinct from auth.uid() then
      perform private.notify(private.as_uuid(new.parent), 'leave_' || (nd->>'status'), 'Leave ' || (nd->>'status') || ' by ' || actor,
        concat_ws(E'\n', ttl, nullif(nd->>'decNote', '')));
    end if;
  end if;
  exception when others then
    raise warning 'notification skipped: %', sqlerrm;
  end;
  return null;
end $function$;

drop trigger if exists e4_docs_notify_chain on public.docs;
create trigger e4_docs_notify_chain after insert or update on public.docs
  for each row when (new.coll in ('apprchain','blockers','leave')) execute function private.docs_notify_chain();
