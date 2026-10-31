-- Business and Books PIN: 4 digits, with a tighter lockout (31 Oct 2026). Runs after m_pin.sql.
--  * The PIN is 4 digits (very easy ones such as 1234 or 1111 are refused).
--  * 5 wrong tries in a row: locked for 15 minutes (as before), and the Principal is told.
--  * 10 wrong tries in one day: locked until that person sets a new PIN with their password; the Principal is told.
-- Nobody had set a PIN yet, so nothing needs resetting.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

alter table private.user_pins add column if not exists day_fails int not null default 0;
alter table private.user_pins add column if not exists day_date date;
alter table private.user_pins add column if not exists blocked boolean not null default false;

create or replace function public.pin_unlock(p_pin text, p_trust boolean default false) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare p private.user_pins; tr boolean := coalesce(p_trust, false) and private.is_owner();
        u timestamptz := now() + case when coalesce(p_trust, false) and private.is_owner() then interval '90 days' else interval '10 minutes' end;
        nm text; td date := (now() at time zone 'Asia/Dhaka')::date; df int;
begin
  if auth.uid() is null or private.pin_session() = '' then return jsonb_build_object('ok', false, 'why', 'signin'); end if;
  select * into p from private.user_pins where user_id = auth.uid() for update;
  if p.user_id is null then return jsonb_build_object('ok', false, 'why', 'nopin'); end if;
  if p.blocked then return jsonb_build_object('ok', false, 'why', 'reset'); end if;
  if p.locked_until > now() then return jsonb_build_object('ok', false, 'why', 'locked', 'lockedUntil', p.locked_until); end if;
  if coalesce(p_pin, '') !~ '^\d{4}$' or extensions.crypt(p_pin, p.pin_hash) <> p.pin_hash then
    df := case when p.day_date = td then p.day_fails else 0 end + 1;
    select coalesce(nullif(x.label, ''), x.full_name) into nm from public.profiles x where x.id = auth.uid();
    if df >= 10 then
      update private.user_pins set blocked = true, fails = 0, day_fails = 0, day_date = td, locked_until = null where user_id = auth.uid();
      perform private.pin_tell_principal('Business and Books blocked',
        coalesce(nm, 'Someone') || ' entered a wrong PIN 10 times today (last at ' || to_char(now() at time zone 'Asia/Dhaka', 'HH24:MI, Dy DD Mon')
        || '). Business and Books stay closed for them until they set a new PIN with their password.', 'security');
      return jsonb_build_object('ok', false, 'why', 'reset');
    end if;
    update private.user_pins set day_fails = df, day_date = td,
      fails = case when fails + 1 >= 5 then 0 else fails + 1 end,
      locked_until = case when fails + 1 >= 5 then now() + interval '15 minutes' else locked_until end
    where user_id = auth.uid() returning * into p;
    if p.locked_until > now() then
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

create or replace function public.pin_set(p_password text, p_pin text, p_trust boolean default false) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare h text; p private.user_pins; tr boolean := coalesce(p_trust, false) and private.is_owner();
        u timestamptz := now() + case when coalesce(p_trust, false) and private.is_owner() then interval '90 days' else interval '10 minutes' end;
begin
  if auth.uid() is null or private.pin_session() = '' then return jsonb_build_object('ok', false, 'why', 'signin'); end if;
  if not private.pin_required() then return jsonb_build_object('ok', false, 'why', 'notneeded'); end if;
  if coalesce(p_pin, '') !~ '^\d{4}$' then return jsonb_build_object('ok', false, 'why', 'format'); end if;
  if p_pin ~ '^(\d)\1{3}$' or p_pin in ('1234','4321','0123','3210','2345','5432','3456','6543','4567','7654','5678','8765','6789','9876','1212','2121','1122','2580','0852','1004','2000','1010','6969') then
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
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, set_at = now(), fails = 0, pw_fails = 0, day_fails = 0,
    locked_until = null, blocked = false;
  insert into private.pin_sessions (session_id, user_id, until, trusted) values (private.pin_session(), auth.uid(), u, tr)
  on conflict (session_id) do update set user_id = excluded.user_id, until = excluded.until, trusted = excluded.trusted;
  perform private.pin_opened();
  return jsonb_build_object('ok', true, 'until', u, 'trusted', tr);
end $$;

create or replace function public.pin_status() returns jsonb
language plpgsql security definer set search_path to '' as $$
declare p private.user_pins; s private.pin_sessions;
begin
  if auth.uid() is null then return jsonb_build_object('required', false); end if;
  if not private.pin_required() then return jsonb_build_object('required', false); end if;
  select * into p from private.user_pins where user_id = auth.uid();
  select * into s from private.pin_sessions where session_id = private.pin_session() and user_id = auth.uid() and until > now();
  return jsonb_build_object('required', true, 'hasPin', p.user_id is not null, 'blocked', coalesce(p.blocked, false),
    'unlocked', s.session_id is not null, 'until', s.until, 'trusted', coalesce(s.trusted, false), 'canTrust', private.is_owner(),
    'lockedUntil', case when p.locked_until > now() then p.locked_until end);
end $$;

commit;
