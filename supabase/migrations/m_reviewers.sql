-- Review logins (2 Nov 2026) — run once in the Supabase SQL editor (it runs as one transaction: all or nothing)
-- Two read-only logins for an outside (AI) reviewer: one sees exactly what the Principal sees, one what the COO sees.
-- * Their profiles stay inactive, so every "find the Principal / the COO" lookup, notification and people list
--   leaves them out; only the identity checks below treat a live review login as the Principal or the COO.
-- * Nothing a review login does is saved: a trigger on every table refuses its writes (security-definer RPCs
--   included, because triggers fire for them too), and file uploads are refused in storage.
-- * Each login ends on its own date (sign-in is also refused by Supabase Auth from then); the Principal can
--   end it at once or open it again from More › Review logins. Every app open is logged.

create table if not exists private.reviewers (
  id uuid primary key references auth.users(id) on delete cascade,
  kind text not null check (kind in ('principal', 'coo')),
  until timestamptz not null,
  off_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists private.reviewer_log (
  id bigserial primary key,
  user_id uuid not null references private.reviewers(id) on delete cascade,
  at timestamptz not null default now(),
  device text
);
create index if not exists reviewer_log_user_at on private.reviewer_log (user_id, at desc);
revoke all on private.reviewers, private.reviewer_log from public, anon, authenticated;

-- any review login (live or ended): used to refuse writes
create or replace function private.is_reviewer() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.reviewers where id = auth.uid())
$$;
create or replace function private.is_reviewer_id(p uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.reviewers where id = p)
$$;
-- a review login that is still open (optionally of one kind)
create or replace function private.reviewer_live(p_kind text default null) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.reviewers r where r.id = auth.uid() and r.off_at is null and r.until > now()
                 and (p_kind is null or r.kind = p_kind))
$$;
grant execute on function private.is_reviewer(), private.is_reviewer_id(uuid), private.reviewer_live(text) to authenticated;

/* ---------- identity checks: a live review login reads as the Principal or the COO ---------- */
create or replace function private.is_active() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false) or private.reviewer_live()
$$;
create or replace function private.is_owner() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and designation = 'principal' and active)
         or private.reviewer_live('principal')
$$;
create or replace function private.is_coo() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and designation = 'coo' and active)
         or private.reviewer_live('coo')
$$;
create or replace function private.is_top() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and designation in ('principal', 'coo'))
         or private.reviewer_live()
$$;
create or replace function private.is_approver() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active
                 and (designation in ('principal','coo') or is_approver))
         or private.reviewer_live()
$$;
create or replace function private.fin_role() returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case p.designation::text when 'principal' then 'principal' when 'coo' then 'coo' end
       from public.profiles p where p.id = auth.uid() and p.active),
    case when private.reviewer_live('principal') then 'principal' when private.reviewer_live('coo') then 'coo' end)
$$;

-- performance screens look the viewer up with "and active"; let a live review login through
do $$
declare f record; d text; n text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname in ('person_performance', 'pod_performance') loop
    d := pg_get_functiondef(f.oid);
    n := replace(d, 'where id = auth.uid() and active)', 'where id = auth.uid() and (active or private.reviewer_live()))');
    if n = d and position('reviewer_live' in d) = 0 then raise exception 'review logins: % not patched', f.proname; end if;
    execute n;
  end loop;
end $$;

-- after-hours alerts: a review login opening Business or Books always tells the Principal
do $$
declare d text; n text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'private' and p.proname = 'pin_opened';
  n := replace(d, 'if private.is_owner() or not private.after_hours()', 'if (private.is_owner() and not private.is_reviewer()) or not private.after_hours()');
  if n = d and position('is_reviewer' in d) = 0 then raise exception 'review logins: pin_opened not patched'; end if;
  execute n;
end $$;

/* ---------- nothing a review login does is saved ---------- */
create or replace function private.reviewer_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_reviewer() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- the reviewer's own session bookkeeping: quietly not saved, so screens still open
  if tg_table_name in ('day_log', 'presence_seen', 'notice_reads', 'push_subs', 'activity_log') then return null; end if;
  if tg_table_name = 'notifications' then
    -- the only notice a review login may cause: an alert to the Principal (after-hours Business/Books, PIN lock)
    if tg_op = 'INSERT' and exists (select 1 from public.profiles p where p.id = new.user_id and p.designation = 'principal' and p.active) then
      return new;
    end if;
    return null;
  end if;
  -- PIN set-up and unlocks (their own PIN only)
  if tg_table_schema = 'private' and tg_table_name in ('user_pins', 'pin_sessions', 'pin_alerts') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Read-only review login: nothing is saved.' using errcode = '42501';
end $$;

do $$
declare t record;
begin
  for t in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind in ('r', 'p') and (n.nspname = 'public' or (n.nspname = 'private' and c.relname not in ('reviewers', 'reviewer_log'))) loop
    execute format('drop trigger if exists zz_reviewer_guard on %I.%I', t.nspname, t.relname);
    execute format('create trigger zz_reviewer_guard before insert or update or delete on %I.%I for each row execute function private.reviewer_guard()', t.nspname, t.relname);
  end loop;
end $$;

-- files: no uploads, changes or deletes from a review login
drop policy if exists reviewer_no_insert on storage.objects;
drop policy if exists reviewer_no_update on storage.objects;
drop policy if exists reviewer_no_delete on storage.objects;
create policy reviewer_no_insert on storage.objects as restrictive for insert to authenticated with check (not private.is_reviewer());
create policy reviewer_no_update on storage.objects as restrictive for update to authenticated using (not private.is_reviewer()) with check (not private.is_reviewer());
create policy reviewer_no_delete on storage.objects as restrictive for delete to authenticated using (not private.is_reviewer());

-- the team never sees review logins in people lists, pickers or counts
drop policy if exists reviewer_hidden on public.profiles;
create policy reviewer_hidden on public.profiles as restrictive for select to authenticated
  using (id = (select auth.uid()) or not private.is_reviewer_id(id));

-- nobody can turn a review login into a real account from People
do $$
declare d text; n text;
begin
  for d in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname = 'admin_set_active' loop
    n := replace(d, 'if tgt.id is null then raise exception ''That person was not found''; end if;',
      'if tgt.id is null then raise exception ''That person was not found''; end if;
  if private.is_reviewer_id(p_user) then raise exception ''Review logins are managed in More › Review logins.''; end if;');
    if n = d and position('is_reviewer_id' in d) = 0 then raise exception 'review logins: admin_set_active not patched'; end if;
    execute n;
  end loop;
end $$;

/* ---------- the app ---------- */
-- the review login itself: which view, and until when (null for everyone else)
create or replace function public.my_review() returns jsonb language sql stable security definer set search_path = '' as $$
  select case when r.id is null then null else jsonb_build_object('kind', r.kind, 'until', r.until, 'live', r.off_at is null and r.until > now()) end
  from (select 1) x left join private.reviewers r on r.id = auth.uid()
$$;
-- each app open by a review login (at most one entry per 10 minutes per device)
create or replace function public.review_seen(p_device text) returns void language plpgsql security definer set search_path = '' as $$
declare dev text := case when p_device = 'mobile' then 'mobile' else 'computer' end;
begin
  if not private.reviewer_live() then return; end if;
  if exists (select 1 from private.reviewer_log where user_id = auth.uid() and device = dev and at > now() - interval '10 minutes') then return; end if;
  insert into private.reviewer_log (user_id, device) values (auth.uid(), dev);
end $$;

-- the real Principal only (a review login never manages review logins)
create or replace function private.review_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_owner() and not private.is_reviewer()
$$;
create or replace function public.review_list() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.review_admin() then raise exception 'Only the Principal manages review logins.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'kind', r.kind, 'email', u.email, 'until', r.until, 'off_at', r.off_at,
      'live', r.off_at is null and r.until > now(),
      'opens', (select count(*) from private.reviewer_log l where l.user_id = r.id),
      'log', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'device', l.device) order by l.at desc)
                         from (select * from private.reviewer_log l2 where l2.user_id = r.id order by l2.at desc limit 20) l), '[]'::jsonb),
      'signins', coalesce((select jsonb_agg(a.created_at order by a.created_at desc) from (
                   select e.created_at from auth.audit_log_entries e
                    where e.payload->>'actor_id' = r.id::text and e.payload->>'action' = 'login'
                    order by e.created_at desc limit 20) a), '[]'::jsonb))
      order by r.kind desc)
    from private.reviewers r join auth.users u on u.id = r.id), '[]'::jsonb);
end $$;
create or replace function public.review_open(p_kind text, p_days int) returns jsonb language plpgsql security definer set search_path = '' as $$
declare rid uuid; u timestamptz := now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)));
begin
  if not private.review_admin() then raise exception 'Only the Principal manages review logins.'; end if;
  update private.reviewers set until = u, off_at = null where kind = p_kind returning id into rid;
  if rid is null then raise exception 'That review login was not found.'; end if;
  update auth.users set banned_until = u where id = rid;
  insert into public.activity_log (actor, table_name, row_id, action, subject_user, is_private, after)
  values (auth.uid(), 'account', rid::text, 'review_open', rid, true, jsonb_build_object('view', p_kind, 'until', u));
  return jsonb_build_object('until', u);
end $$;
create or replace function public.review_off(p_kind text) returns void language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if not private.review_admin() then raise exception 'Only the Principal manages review logins.'; end if;
  update private.reviewers set off_at = now() where kind = p_kind returning id into rid;
  if rid is null then raise exception 'That review login was not found.'; end if;
  update auth.users set banned_until = now() + interval '100 years' where id = rid;
  delete from auth.sessions where user_id = rid;          -- signs it out everywhere
  delete from private.pin_sessions where user_id = rid;
  insert into public.activity_log (actor, table_name, row_id, action, subject_user, is_private, after)
  values (auth.uid(), 'account', rid::text, 'review_off', rid, true, jsonb_build_object('view', p_kind));
end $$;
revoke all on function public.review_list(), public.review_open(text, int), public.review_off(text) from public, anon;
grant execute on function public.my_review(), public.review_seen(text), public.review_list(), public.review_open(text, int), public.review_off(text) to authenticated;

/* ---------- the two logins (rerun-safe: an existing login keeps its account and gets a new password) ---------- */
drop table if exists pg_temp.review_new;
create temporary table review_new (view text, email text, password text);
do $$
declare r record; uid uuid; pw text; u timestamptz := now() + interval '7 days';
begin
  for r in select * from (values ('principal', 'review.principal@slate-atelier.com', 'Reviewer · Principal view', 'Principal', true, false),
                                 ('coo', 'review.coo@slate-atelier.com', 'Reviewer · COO view', 'COO', true, true))
           v(kind, email, label, role_label, is_private, is_manager) loop
    pw := translate(encode(extensions.gen_random_bytes(15), 'base64'), '+/=', 'xyz');
    select id into uid from auth.users where lower(email) = r.email;
    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, recovery_token, email_change_token_new, email_change, banned_until)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', r.email,
              extensions.crypt(pw, extensions.gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', r.label), now(), now(),
              '', '', '', '', u);
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', r.email, 'email_verified', true),
              'email', now(), now(), now());
    else
      update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), banned_until = u, updated_at = now() where id = uid;
      delete from auth.sessions where user_id = uid;
    end if;
    insert into public.profiles (id, email, full_name) values (uid, r.email, r.label) on conflict (id) do nothing;
    -- role_label sets the designation (principal / coo); the profile stays inactive on purpose
    update public.profiles set full_name = r.label, label = r.label, role_label = r.role_label, team = 'Review',
           is_private = r.is_private, is_manager = r.is_manager, is_approver = false, pod_id = null, active = false
     where id = uid;
    insert into private.reviewers (id, kind, until) values (uid, r.kind, u)
    on conflict (id) do update set kind = excluded.kind, until = excluded.until, off_at = null;
    insert into review_new values (r.label, r.email, pw);
  end loop;
end $$;

-- copy these two passwords now: they are shown only here
select view, email, password, to_char(now() + interval '7 days', 'DD Mon YYYY') as ends from review_new order by view desc;
