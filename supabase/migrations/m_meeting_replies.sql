-- SLATE OS · meeting replies (26 Oct 2026), applied as meeting_replies
-- Everyone invited to a scheduled meeting must reply: Accept, Tentative or Decline (Tentative and Decline need a reason).
-- * Replies live in the meeting as data.rsvp = { <user id>: { r: yes|maybe|no, note, at, for: "<date> <time>" } }.
--   A reply counts only for the date and time it was given for; moving the meeting asks everyone to reply again.
-- * Replies are written only through public.meeting_respond, by the invitee themself. Any other save of the meeting
--   (the organiser editing it, minutes being written) keeps the replies already given.
-- * The organiser is told of each Decline or Tentative, and when everyone has replied.
-- * No reply 24 hours after the invite (or 3 hours before the start, whichever comes first): the invitee gets a nudge
--   and the organiser is told who hasn't replied. Once per person, per date and time.

-- 1. guard: replies only through meeting_respond; every other save keeps them
do $mig$
declare src text; anchor text := $a$  if uid is null then return coalesce(new, old); end if;
$a$;
begin
  select pg_get_functiondef('private.docs_guard'::regproc) into src;
  if position('slate.meeting_rsvp' in src) = 0 then
    if position(anchor in src) = 0 then raise exception 'docs_guard anchor not found'; end if;
    src := replace(src, anchor, anchor || $b$  -- meeting replies: written only through meeting_respond; any other save keeps the replies already given
  if rw.coll = 'pmeetings' and tg_op <> 'DELETE' then
    if current_setting('slate.meeting_rsvp', true) = '1' then return new; end if;
    if tg_op = 'INSERT' then
      new.data := new.data - 'rsvp';
    elsif (new.data->'rsvp') is distinct from (old.data->'rsvp') then
      new.data := case when old.data ? 'rsvp' then jsonb_set(new.data, '{rsvp}', old.data->'rsvp') else new.data - 'rsvp' end;
    end if;
  end if;
$b$);
    execute src;
  end if;
end $mig$;

-- 2. helpers: a meeting's date-time "version" and start
create or replace function private.meeting_ver(d jsonb)
returns text language sql immutable set search_path to '' as $$
  select coalesce(d->>'date', '') || ' ' || coalesce(d->>'time', '')
$$;
create or replace function private.meeting_start(d jsonb)
returns timestamptz language plpgsql immutable set search_path to '' as $$
begin
  if coalesce(d->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(d->>'time', '') !~ '^\d{1,2}:\d{2}$' then return null; end if;
  return ((d->>'date') || ' ' || (d->>'time'))::timestamp at time zone 'Asia/Dhaka';
exception when others then return null;
end $$;
create or replace function private.meeting_replied(d jsonb, who text)
returns boolean language sql immutable set search_path to '' as $$
  select coalesce(jsonb_typeof(d->'rsvp'->who) = 'object' and d->'rsvp'->who->>'for' = private.meeting_ver(d), false)
$$;

-- 3. reply to an invite
create or replace function public.meeting_respond(p_id text, p_choice text, p_note text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare
  uid uuid := auth.uid(); m public.docs; d jsonb; note text := nullif(trim(coalesce(p_note, '')), '');
  ver text; st timestamptz; prev text; ttl text; who text; inv text[]; waiting int; n_yes int; n_maybe int; n_no int;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if not private.is_active() then raise exception 'Your account is read-only'; end if;
  if p_choice not in ('yes','maybe','no') then raise exception 'Choose Accept, Tentative or Decline'; end if;
  if p_choice <> 'yes' and coalesce(length(note), 0) < 3 then raise exception 'Add a short reason so the organiser knows'; end if;
  select * into m from public.docs where path = 'pmeetings/' || p_id for update;
  if not found then raise exception 'Meeting not found'; end if;
  d := m.data;
  if not (jsonb_typeof(d->'attendees') = 'array' and (d->'attendees') ? uid::text) then raise exception 'You aren''t invited to this meeting'; end if;
  if m.created_by = uid then raise exception 'You set this meeting up'; end if;
  if coalesce(d->>'status', '') <> 'scheduled' then raise exception 'This meeting is no longer taking replies'; end if;
  st := private.meeting_start(d);
  if st is not null and st <= now() then raise exception 'This meeting has already started'; end if;
  ver := private.meeting_ver(d);
  prev := case when private.meeting_replied(d, uid::text) then d->'rsvp'->uid::text->>'r' end;

  perform set_config('slate.meeting_rsvp', '1', true);
  update public.docs
     set data = jsonb_set(case when jsonb_typeof(data->'rsvp') = 'object' then data else data || '{"rsvp":{}}'::jsonb end,
                          array['rsvp', uid::text],
                          jsonb_build_object('r', p_choice, 'note', coalesce(left(note, 300), ''), 'for', ver,
                                             'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
   where path = m.path
   returning data into d;
  perform set_config('slate.meeting_rsvp', '', true);

  -- tell the organiser
  begin
    ttl := coalesce(nullif(d->>'title', ''), 'Meeting');
    who := coalesce(private.person_name(uid), 'Someone');
    if p_choice <> 'yes' and (prev is distinct from p_choice or note is not null) then
      perform private.notify(m.created_by, 'meeting_reply',
        who || case p_choice when 'no' then ' declined: ' else ' is tentative: ' end || ttl,
        concat_ws(E'\n', private.meeting_when(d), '“' || note || '”'));
    end if;
    select array_agg(a) into inv from jsonb_array_elements_text(d->'attendees') a
      join public.profiles p on p.id = private.as_uuid(a) and p.active
     where private.as_uuid(a) is distinct from m.created_by;
    select count(*) filter (where not private.meeting_replied(d, a)),
           count(*) filter (where private.meeting_replied(d, a) and d->'rsvp'->a->>'r' = 'yes'),
           count(*) filter (where private.meeting_replied(d, a) and d->'rsvp'->a->>'r' = 'maybe'),
           count(*) filter (where private.meeting_replied(d, a) and d->'rsvp'->a->>'r' = 'no')
      into waiting, n_yes, n_maybe, n_no from unnest(coalesce(inv, '{}')) a;
    if waiting = 0 and prev is null and coalesce(array_length(inv, 1), 0) > 0 then
      perform private.notify(m.created_by, 'meeting_reply', 'Everyone has replied: ' || ttl,
        concat_ws(E'\n', private.meeting_when(d),
          concat_ws(' · ', n_yes || ' accepted', nullif(n_maybe, 0) || ' tentative', nullif(n_no, 0) || ' declined')));
    end if;
  exception when others then
    raise warning 'meeting reply notification skipped: %', sqlerrm;
  end;
end $$;
revoke all on function public.meeting_respond(text, text, text) from public, anon;
grant execute on function public.meeting_respond(text, text, text) to authenticated;

-- 4. a moved meeting asks for replies again
do $mig$
declare src text; old_line text := $a$perform private.notify(private.as_uuid(a), 'meeting_changed', 'Meeting moved by ' || actor, body);$a$;
begin
  select pg_get_functiondef('private.docs_meeting_notify'::regproc) into src;
  if position('reply again' in src) = 0 then
    if position(old_line in src) = 0 then raise exception 'docs_meeting_notify anchor not found'; end if;
    src := replace(src, old_line, $b$perform private.notify(private.as_uuid(a), 'meeting_changed',
            case when (nd->>'date', nd->>'time') is distinct from (od->>'date', od->>'time')
                 then 'Meeting moved by ' || actor || ': reply again' else 'Meeting details changed by ' || actor end, body);$b$);
    execute src;
  end if;
end $mig$;

-- 5. nudges: no reply after 24 hours, or 3 hours before the start
create or replace function private.meeting_reply_nudges()
returns void language plpgsql security definer set search_path to '' as $$
begin
  with due as (
    select m.path, m.data d, m.created_by org, private.meeting_ver(m.data) ver, a.uid
    from public.docs m
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(m.data->'attendees') = 'array' then m.data->'attendees' else '[]'::jsonb end) a(uid)
    join public.profiles pr on pr.id = private.as_uuid(a.uid) and pr.active
    where m.coll = 'pmeetings' and m.data->>'status' = 'scheduled'
      and private.meeting_start(m.data) > now()
      and private.as_uuid(a.uid) is distinct from m.created_by
      and not private.meeting_replied(m.data, a.uid)
      and (private.meeting_start(m.data) <= now() + interval '3 hours'
           or coalesce(nullif(m.data->>'updatedAt', ''), nullif(m.data->>'schedAt', ''), nullif(m.data->>'createdAt', ''), '2000-01-01')::timestamptz <= now() - interval '24 hours')
  ), nudge as (
    insert into public.notifications (user_id, kind, title, body, task_ref)
    select private.as_uuid(uid), 'meeting_reply_due', left('Reply needed: ' || coalesce(nullif(d->>'title', ''), 'Meeting'), 90),
           left(concat_ws(E'\n', private.meeting_when(d), coalesce(private.person_name(org), 'The organiser') || ' is waiting for your Accept, Tentative or Decline.'), 320),
           'rsvp:' || path || '@' || ver
    from due
    where not exists (select 1 from public.notifications n where n.user_id = private.as_uuid(due.uid) and n.task_ref = 'rsvp:' || due.path || '@' || due.ver)
    returning 1
  )
  insert into public.notifications (user_id, kind, title, body, task_ref)
  select org, 'meeting_awaiting', left('No reply yet: ' || coalesce(nullif(min(d->>'title'), ''), 'Meeting'), 90),
         left(concat_ws(E'\n', private.meeting_when(min(d::text)::jsonb),
              'Waiting on ' || string_agg(coalesce(private.person_name(private.as_uuid(uid)), 'someone'), ', ') || '. They have been reminded.'), 320),
         'rsvpo:' || path || '@' || ver
  from due
  join public.profiles op on op.id = due.org and op.active
  where not exists (select 1 from public.notifications n where n.user_id = due.org and n.task_ref = 'rsvpo:' || due.path || '@' || due.ver)
  group by org, path, ver;
end $$;
select cron.schedule('slate-meeting-reply-nudges', '*/15 * * * *', 'select private.meeting_reply_nudges()');
