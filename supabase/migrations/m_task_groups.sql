-- Group tasks (COO's feedback, 9 Nov 2026)
-- A group task is one piece of work shared by several people. SLATE OS keeps one copy per person (linked by joint.id),
-- but nobody finishes it alone:
--   * without parts: anyone in the group marks the whole task done, and every copy is sent (or finished) on that same day,
--     so if it is late, everyone is late;
--   * with parts (grp.subs): each person ticks only their own part; the whole task finishes, for everyone, on the day the
--     last part is ticked.
-- Members can't write each other's copies, so these three functions do it for them. They check who is asking, then write
-- with the flag slate.task_group, which docs_guard honours (the same pattern as slate.meeting_rsvp).

-- 1. docs_guard lets the group functions through (only they set the flag, inside this transaction)
do $$
declare d text;
begin
  d := pg_get_functiondef('private.docs_guard'::regproc);
  if position('slate.task_group' in d) = 0 then
    d := replace(d, E'  if uid is null then return coalesce(new, old); end if;\n',
      E'  if uid is null then return coalesce(new, old); end if;\n'
      || E'  -- group tasks: written only through task_group_done / task_group_subs / task_group_tick\n'
      || E'  if rw.coll in (''tasks'',''lead'') and current_setting(''slate.task_group'', true) = ''1'' then return coalesce(new, old); end if;\n');
    if position('slate.task_group' in d) = 0 then raise exception 'docs_guard: insertion point not found'; end if;
    execute d;
  end if;
end $$;

-- who may act on a group: someone in it, the project's POD leader, the Principal or the COO
create or replace function private.grp_can(p_joint text) returns boolean
language sql stable security definer set search_path to '' as $$
  select private.is_approver() or exists (
    select 1 from public.docs x
    where x.coll in ('tasks','lead') and x.data->'joint'->>'id' = p_joint
      and (x.assignee = auth.uid() or private.leads_doc(x.project_id)))
$$;

-- 2. the whole group done on one day
create or replace function public.task_group_done(p_joint text, p_date date default null, p_note text default '')
returns integer language plpgsql security definer set search_path to '' as $$
declare
  uid uuid := auth.uid(); r public.docs; n int := 0; d text; nowt text := to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  who text; left_parts text;
begin
  if uid is null or not private.is_active() then raise exception 'Not signed in'; end if;
  if coalesce(p_joint,'') = '' then raise exception 'Not a group task'; end if;
  if not private.grp_can(p_joint) then raise exception 'Only someone in this group, its POD leader or the COO can finish it'; end if;
  d := coalesce(p_date, (now() at time zone 'Asia/Dhaka')::date)::text;
  if d > (now() at time zone 'Asia/Dhaka')::date::text then raise exception 'The done date can''t be in the future'; end if;
  -- parts: every part must be ticked first
  select string_agg(coalesce(e->>'t','part'), ', ') into left_parts
  from (select data from public.docs where coll in ('tasks','lead') and data->'joint'->>'id' = p_joint and not coalesce((data->>'archived')::boolean,false) limit 1) x,
       jsonb_array_elements(case when jsonb_typeof(x.data->'grp'->'subs')='array' then x.data->'grp'->'subs' else '[]'::jsonb end) e
  where coalesce(e->>'done','') = '';
  if left_parts is not null then raise exception 'Every part has to be finished first. Still open: %', left_parts; end if;
  who := coalesce((select split_part(full_name, ' ', 1) from public.profiles where id = uid), 'someone');
  perform set_config('slate.task_group', '1', true);
  for r in select * from public.docs where coll in ('tasks','lead') and data->'joint'->>'id' = p_joint
             and not coalesce((data->>'archived')::boolean,false)
             and coalesce(data->>'doneAt','') = '' and coalesce(jsonb_typeof(data->'verify'),'null') <> 'object' loop
    if private.verify_on(private.verify_cat(r.project_id, r.data)) then
      update public.docs set data = data
        || jsonb_build_object('verify', jsonb_build_object('at', d, 'by', r.assignee::text, 'ts', nowt, 'note', coalesce(p_note,''), 'grp', uid::text), 'stage', 'review')
        || jsonb_build_object('history', coalesce(data->'history','[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', nowt, 'by', uid::text, 'type', 'submitted', 'to', d, 'note', 'Group task: done for the whole group by ' || who || coalesce(nullif(' · ' || p_note, ' · '), ''))))
      where path = r.path;
    else
      update public.docs set data = data
        || jsonb_build_object('doneAt', d, 'doneBy', uid::text)
        || jsonb_build_object('history', coalesce(data->'history','[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', nowt, 'by', uid::text, 'type', 'done', 'to', d, 'note', 'Group task: done for the whole group by ' || who || coalesce(nullif(' · ' || p_note, ' · '), ''))))
      where path = r.path;
    end if;
    n := n + 1;
  end loop;
  perform set_config('slate.task_group', '0', true);
  return n;
end $$;

-- 3. the parts: [{id, t (what), who (a person in the group or empty), done (date), at, by}]
--    anyone who can act on the group sets the list; ticks already given are kept as they were
create or replace function public.task_group_subs(p_joint text, p_subs jsonb)
returns integer language plpgsql security definer set search_path to '' as $$
declare
  uid uuid := auth.uid(); cur jsonb; e jsonb; o jsonb; out_ jsonb := '[]'::jsonb; mem text[]; n int;
begin
  if uid is null or not private.is_active() then raise exception 'Not signed in'; end if;
  if not private.grp_can(p_joint) then raise exception 'Only someone in this group, its POD leader or the COO changes its parts'; end if;
  if jsonb_typeof(p_subs) <> 'array' or jsonb_array_length(p_subs) > 30 then raise exception 'Up to 30 parts'; end if;
  select array_agg(distinct assignee::text) into mem from public.docs where coll in ('tasks','lead') and data->'joint'->>'id' = p_joint and not coalesce((data->>'archived')::boolean,false);
  select case when jsonb_typeof(data->'grp'->'subs')='array' then data->'grp'->'subs' else '[]'::jsonb end into cur
  from public.docs where coll in ('tasks','lead') and data->'joint'->>'id' = p_joint limit 1;
  for e in select * from jsonb_array_elements(p_subs) loop
    if length(trim(coalesce(e->>'t',''))) < 2 then raise exception 'Write what each part is'; end if;
    if coalesce(e->>'who','') <> '' and not (e->>'who' = any(mem)) then raise exception 'A part goes to someone in the group'; end if;
    o := null;
    select x into o from jsonb_array_elements(cur) x where x->>'id' = e->>'id' limit 1;
    out_ := out_ || jsonb_build_array(jsonb_build_object('id', coalesce(nullif(e->>'id',''), md5(random()::text)), 't', left(trim(e->>'t'), 160), 'who', coalesce(e->>'who',''),
      'done', coalesce(o->>'done',''), 'at', coalesce(o->>'at',''), 'by', coalesce(o->>'by','')));
  end loop;
  perform set_config('slate.task_group', '1', true);
  update public.docs set data = jsonb_set(data, '{grp}', coalesce(data->'grp','{}'::jsonb) || jsonb_build_object('subs', out_, 'by', uid::text))
  where coll in ('tasks','lead') and data->'joint'->>'id' = p_joint;
  get diagnostics n = row_count;
  perform set_config('slate.task_group', '0', true);
  return n;
end $$;

-- 4. tick (or untick) one part: its owner, or the POD leader / COO. The last tick finishes the whole group that day.
create or replace function public.task_group_tick(p_joint text, p_sub text, p_done boolean)
returns text language plpgsql security definer set search_path to '' as $$
declare
  uid uuid := auth.uid(); cur jsonb; s jsonb; nw jsonb := '[]'::jsonb; e jsonb; td text := (now() at time zone 'Asia/Dhaka')::date::text;
  nowt text := to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); boss boolean; open_ int;
begin
  if uid is null or not private.is_active() then raise exception 'Not signed in'; end if;
  select case when jsonb_typeof(data->'grp'->'subs')='array' then data->'grp'->'subs' else '[]'::jsonb end into cur
  from public.docs where coll in ('tasks','lead') and data->'joint'->>'id' = p_joint and not coalesce((data->>'archived')::boolean,false) limit 1;
  select x into s from jsonb_array_elements(coalesce(cur,'[]'::jsonb)) x where x->>'id' = p_sub limit 1;
  if s is null then raise exception 'Part not found'; end if;
  boss := private.is_approver() or exists (select 1 from public.docs x where x.coll in ('tasks','lead') and x.data->'joint'->>'id' = p_joint and private.leads_doc(x.project_id));
  if not (boss or s->>'who' = uid::text or (coalesce(s->>'who','') = '' and private.grp_can(p_joint))) then
    raise exception 'You can tick only your own part';
  end if;
  if not p_done and exists (select 1 from public.docs where coll in ('tasks','lead') and data->'joint'->>'id' = p_joint
                              and (coalesce(data->>'doneAt','') <> '' or jsonb_typeof(data->'verify') = 'object')) then
    raise exception 'The whole task is already done';
  end if;
  for e in select * from jsonb_array_elements(cur) loop
    if e->>'id' = p_sub then
      e := e || case when p_done then jsonb_build_object('done', td, 'at', nowt, 'by', uid::text) else jsonb_build_object('done', '', 'at', '', 'by', '') end;
    end if;
    nw := nw || jsonb_build_array(e);
  end loop;
  perform set_config('slate.task_group', '1', true);
  update public.docs set data = jsonb_set(data, '{grp}', coalesce(data->'grp','{}'::jsonb) || jsonb_build_object('subs', nw))
     || jsonb_build_object('history', coalesce(data->'history','[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', nowt, 'by', uid::text, 'type', 'part', 'to', case when p_done then td else '' end, 'note', (case when p_done then 'Part done: ' else 'Part reopened: ' end) || coalesce(s->>'t',''))))
  where coll in ('tasks','lead') and data->'joint'->>'id' = p_joint;
  perform set_config('slate.task_group', '0', true);
  select count(*) into open_ from jsonb_array_elements(nw) x where coalesce(x->>'done','') = '';
  if p_done and open_ = 0 then
    perform public.task_group_done(p_joint, td::date, 'Every part finished');
    return 'all';
  end if;
  return 'ok';
end $$;

revoke all on function public.task_group_done(text, date, text) from public, anon;
revoke all on function public.task_group_subs(text, jsonb) from public, anon;
revoke all on function public.task_group_tick(text, text, boolean) from public, anon;
grant execute on function public.task_group_done(text, date, text) to authenticated;
grant execute on function public.task_group_subs(text, jsonb) to authenticated;
grant execute on function public.task_group_tick(text, text, boolean) to authenticated;
