-- Business and Books PIN (31 Oct 2026).
-- The Principal, the COO and the accountant (the Accounts login, and anyone given Accountant, COO or Viewer in
-- Books) need a 6-digit PIN, as well as their sign-in, to open Business and Books on a device.
--  * The database checks it: without an unlocked PIN on this sign-in, Business records (fees, HR and salaries,
--    proposals and their history) and Books records simply do not come back, however they are asked for.
--  * Unlocked for 10 minutes after the last use; then locked again. "Lock" locks at once.
--    The Principal may keep it unlocked on their own phone ("Keep unlocked on this phone"): until they sign out,
--    tap Lock, or 90 days pass.
--  * Setting or changing a PIN needs the account password. Five wrong PINs lock Business and Books for that
--    person for 15 minutes and tell the Principal.
--  * Opening Business and Books outside office hours (Sunday to Thursday, 09:00 to 19:30, Dhaka) tells the
--    Principal at once (not for the Principal's own use).
-- Studio, and office staff's petty cash, are not affected.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

create table if not exists private.user_pins (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  pin_hash     text not null,
  set_at       timestamptz not null default now(),
  fails        int not null default 0,
  pw_fails     int not null default 0,
  locked_until timestamptz
);
create table if not exists private.pin_sessions (
  session_id text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  until      timestamptz not null,
  trusted    boolean not null default false
);
alter table private.pin_sessions add column if not exists trusted boolean not null default false;
create table if not exists private.pin_alerts (user_id uuid primary key, at timestamptz not null);
revoke all on private.user_pins, private.pin_sessions, private.pin_alerts from public, anon, authenticated;

-- who needs a PIN
create or replace function private.pin_required() returns boolean
language sql stable security definer set search_path to '' as $$
  select auth.uid() is not null and (
    private.is_owner() or private.is_coo() or private.fin_role() is not null
    or coalesce(private.books_role() in ('COO', 'Accountant', 'Viewer'), false))
$$;

create or replace function private.pin_session() returns text
language sql stable set search_path to '' as $$ select coalesce(auth.jwt()->>'session_id', '') $$;

-- may this request see Business and Books?
create or replace function private.pin_ok() returns boolean
language sql stable security definer set search_path to '' as $$
  select auth.uid() is null or not private.pin_required()
      or exists (select 1 from private.pin_sessions s where s.session_id = private.pin_session() and s.user_id = auth.uid() and s.until > now())
$$;

-- office hours (Dhaka), from SLATE OS settings if set there: {"officeHours":{"days":[0,1,2,3,4],"start":"09:00","end":"19:30"}} (0 = Sunday)
create or replace function private.after_hours() returns boolean
language sql stable security definer set search_path to '' as $$
  with h as (select coalesce((select s.data->'officeHours' from public.docs s where s.path = 'config/settings'),
                             '{"days":[0,1,2,3,4],"start":"09:00","end":"19:30"}'::jsonb) v),
       t as (select (now() at time zone 'Asia/Dhaka') d)
  select not ((h.v->'days') @> to_jsonb(extract(dow from t.d)::int)
              and to_char(t.d, 'HH24:MI') >= (h.v->>'start') and to_char(t.d, 'HH24:MI') < (h.v->>'end'))
  from h, t
$$;

create or replace function private.pin_tell_principal(p_title text, p_body text, p_kind text) returns void
language plpgsql security definer set search_path to '' as $$
begin
  insert into public.notifications (user_id, kind, title, body)
  select p.id, p_kind, p_title, p_body from public.profiles p where p.active and p.designation = 'principal';
end $$;

create or replace function private.pin_opened() returns void
language plpgsql security definer set search_path to '' as $$
declare nm text;
begin
  if private.is_owner() or not private.after_hours() then return; end if;
  if exists (select 1 from private.pin_alerts a where a.user_id = auth.uid() and a.at > now() - interval '60 minutes') then return; end if;
  insert into private.pin_alerts (user_id, at) values (auth.uid(), now()) on conflict (user_id) do update set at = excluded.at;
  select coalesce(nullif(p.label, ''), p.full_name) into nm from public.profiles p where p.id = auth.uid();
  perform private.pin_tell_principal('After hours: Business and Books opened',
    coalesce(nm, 'Someone') || ' opened Business and Books at ' || to_char(now() at time zone 'Asia/Dhaka', 'HH24:MI, Dy DD Mon')
    || ', outside office hours.', 'afterhours');
end $$;

-- ---------- what the app calls ----------
create or replace function public.pin_status() returns jsonb
language plpgsql security definer set search_path to '' as $$
declare p private.user_pins; s private.pin_sessions;
begin
  if auth.uid() is null then return jsonb_build_object('required', false); end if;
  if not private.pin_required() then return jsonb_build_object('required', false); end if;
  select * into p from private.user_pins where user_id = auth.uid();
  select * into s from private.pin_sessions where session_id = private.pin_session() and user_id = auth.uid() and until > now();
  return jsonb_build_object('required', true, 'hasPin', p.user_id is not null, 'unlocked', s.session_id is not null,
    'until', s.until, 'trusted', coalesce(s.trusted, false), 'canTrust', private.is_owner(), 'lockedUntil', case when p.locked_until > now() then p.locked_until end);
end $$;

drop function if exists public.pin_unlock(text);
create or replace function public.pin_unlock(p_pin text, p_trust boolean default false) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare p private.user_pins; tr boolean := coalesce(p_trust, false) and private.is_owner();
        u timestamptz := now() + case when coalesce(p_trust, false) and private.is_owner() then interval '90 days' else interval '10 minutes' end; nm text;
begin
  if auth.uid() is null or private.pin_session() = '' then return jsonb_build_object('ok', false, 'why', 'signin'); end if;
  select * into p from private.user_pins where user_id = auth.uid() for update;
  if p.user_id is null then return jsonb_build_object('ok', false, 'why', 'nopin'); end if;
  if p.locked_until > now() then return jsonb_build_object('ok', false, 'why', 'locked', 'lockedUntil', p.locked_until); end if;
  if coalesce(p_pin, '') !~ '^\d{6}$' or extensions.crypt(p_pin, p.pin_hash) <> p.pin_hash then
    update private.user_pins set fails = case when fails + 1 >= 5 then 0 else fails + 1 end,
      locked_until = case when fails + 1 >= 5 then now() + interval '15 minutes' else locked_until end
    where user_id = auth.uid() returning * into p;
    if p.locked_until > now() then
      select coalesce(nullif(x.label, ''), x.full_name) into nm from public.profiles x where x.id = auth.uid();
      perform private.pin_tell_principal('Business and Books locked',
        coalesce(nm, 'Someone') || ' entered a wrong PIN 5 times at ' || to_char(now() at time zone 'Asia/Dhaka', 'HH24:MI, Dy DD Mon')
        || '. Business and Books are locked for them for 15 minutes.', 'security');
      return jsonb_build_object('ok', false, 'why', 'locked', 'lockedUntil', p.locked_until);
    end if;
    return jsonb_build_object('ok', false, 'why', 'wrong', 'left', 5 - p.fails);
  end if;
  update private.user_pins set fails = 0, locked_until = null where user_id = auth.uid();
  delete from private.pin_sessions where until < now() - interval '1 day';
  insert into private.pin_sessions (session_id, user_id, until, trusted) values (private.pin_session(), auth.uid(), u, tr)
  on conflict (session_id) do update set user_id = excluded.user_id, until = excluded.until, trusted = excluded.trusted;
  perform private.pin_opened();
  return jsonb_build_object('ok', true, 'until', u, 'trusted', tr);
end $$;

-- set or change the PIN: needs the account password
drop function if exists public.pin_set(text, text);
create or replace function public.pin_set(p_password text, p_pin text, p_trust boolean default false) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare h text; p private.user_pins; tr boolean := coalesce(p_trust, false) and private.is_owner();
        u timestamptz := now() + case when coalesce(p_trust, false) and private.is_owner() then interval '90 days' else interval '10 minutes' end;
begin
  if auth.uid() is null or private.pin_session() = '' then return jsonb_build_object('ok', false, 'why', 'signin'); end if;
  if not private.pin_required() then return jsonb_build_object('ok', false, 'why', 'notneeded'); end if;
  if coalesce(p_pin, '') !~ '^\d{6}$' then return jsonb_build_object('ok', false, 'why', 'format'); end if;
  if p_pin in ('000000','111111','222222','333333','444444','555555','666666','777777','888888','999999','123456','654321','012345','123123') then
    return jsonb_build_object('ok', false, 'why', 'easy');
  end if;
  select * into p from private.user_pins where user_id = auth.uid() for update;
  if p.locked_until > now() then return jsonb_build_object('ok', false, 'why', 'locked', 'lockedUntil', p.locked_until); end if;
  select u2.encrypted_password into h from auth.users u2 where u2.id = auth.uid();
  if h is null or coalesce(p_password, '') = '' or extensions.crypt(p_password, h) <> h then
    if p.user_id is not null then
      update private.user_pins set pw_fails = case when pw_fails + 1 >= 5 then 0 else pw_fails + 1 end,
        locked_until = case when pw_fails + 1 >= 5 then now() + interval '15 minutes' else locked_until end
      where user_id = auth.uid();
    end if;
    return jsonb_build_object('ok', false, 'why', 'password');
  end if;
  insert into private.user_pins (user_id, pin_hash) values (auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, set_at = now(), fails = 0, pw_fails = 0, locked_until = null;
  insert into private.pin_sessions (session_id, user_id, until, trusted) values (private.pin_session(), auth.uid(), u, tr)
  on conflict (session_id) do update set user_id = excluded.user_id, until = excluded.until, trusted = excluded.trusted;
  perform private.pin_opened();
  return jsonb_build_object('ok', true, 'until', u, 'trusted', tr);
end $$;

-- still working: keep it open another 10 minutes
create or replace function public.pin_touch() returns timestamptz
language sql security definer set search_path to '' as $$
  update private.pin_sessions set until = now() + case when trusted then interval '90 days' else interval '10 minutes' end
  where session_id = private.pin_session() and user_id = auth.uid() and until > now()
  returning until
$$;

create or replace function public.pin_lock() returns void
language sql security definer set search_path to '' as $$
  delete from private.pin_sessions where session_id = private.pin_session() and user_id = auth.uid()
$$;

revoke all on function private.pin_required(), private.pin_ok(), private.after_hours(), private.pin_tell_principal(text, text, text),
  private.pin_opened() from public, anon;
revoke all on function public.pin_status(), public.pin_unlock(text, boolean), public.pin_set(text, text, boolean), public.pin_touch(), public.pin_lock() from public, anon;
grant execute on function private.pin_ok(), private.pin_required(), private.pin_session() to authenticated;
grant execute on function public.pin_status(), public.pin_unlock(text, boolean), public.pin_set(text, text, boolean), public.pin_touch(), public.pin_lock() to authenticated;

-- ---------- the walls: Business and Books records need an unlocked PIN ----------
-- (restrictive policies are added to the existing ones: both must allow)
drop policy if exists pin_gate on public.fin_docs;
create policy pin_gate on public.fin_docs as restrictive for all to authenticated using ((select private.pin_ok())) with check ((select private.pin_ok()));
drop policy if exists pin_gate on public.fin_audit;
create policy pin_gate on public.fin_audit as restrictive for all to authenticated using ((select private.pin_ok())) with check ((select private.pin_ok()));
drop policy if exists pin_gate on public.fin_links;
create policy pin_gate on public.fin_links as restrictive for all to authenticated using ((select private.pin_ok())) with check ((select private.pin_ok()));
drop policy if exists pin_gate on public.books_docs;
create policy pin_gate on public.books_docs as restrictive for all to authenticated using ((select private.pin_ok())) with check ((select private.pin_ok()));
drop policy if exists pin_gate on public.books_audit;
create policy pin_gate on public.books_audit as restrictive for all to authenticated using ((select private.pin_ok())) with check ((select private.pin_ok()));
drop policy if exists pin_gate on public.docs;
create policy pin_gate on public.docs as restrictive for all to authenticated
  using (left(path, 10) <> 'proposals/' or (select private.pin_ok())) with check (left(path, 10) <> 'proposals/' or (select private.pin_ok()));
drop policy if exists pin_gate on public.activity_log;
create policy pin_gate on public.activity_log as restrictive for select to authenticated using (table_name <> 'proposals' or (select private.pin_ok()));
drop policy if exists pin_gate_books on storage.objects;
create policy pin_gate_books on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'books' or (select private.pin_ok())) with check (bucket_id <> 'books' or (select private.pin_ok()));

-- the finance functions the screens call (fees ledger, pick lists, project dues) check the PIN too
create or replace function private.is_finance() returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(private.fin_role() in ('principal', 'coo'), false) and private.pin_ok()
$$;
create or replace function private.is_fin_accountant() returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(private.fin_role() = 'accountant', false) and private.pin_ok()
$$;

-- the backup download leaves out Business (finance and proposals) until the PIN is entered
do $mig$
declare src text := pg_get_functiondef('public.backup_export(text)'::regprocedure); a text; b text;
begin
  if src like '%pin_ok%' then return; end if;   -- already done
  a := 'from public.docs d where d.coll <> ''data'' and (own or d.coll <> ''lead''))';
  b := 'from public.docs d where d.coll <> ''data'' and (own or d.coll <> ''lead'') and (left(d.path, 10) <> ''proposals/'' or private.pin_ok()))';
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'PIN patch: backup docs line not found once'; end if;
  src := replace(src, a, b);
  a := 'if private.is_top() then';
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'PIN patch: backup finance line not found once'; end if;
  src := replace(src, a, 'if private.is_top() and private.pin_ok() then');
  execute src;
end $mig$;

commit;
