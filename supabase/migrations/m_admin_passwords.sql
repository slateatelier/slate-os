-- Principal and COO can reset a password or create an account from SLATE OS.
-- The edge function "admin-users" holds the admin key; these functions record and enforce the rest.

create table if not exists private.temp_pw (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hash text,
  set_by uuid,
  set_at timestamptz not null default now(),
  cleared_at timestamptz
);
alter table private.temp_pw enable row level security;

-- Called only by the edge function (service role) after it sets a temporary password.
create or replace function public.admin_mark_temp_pw(p_user uuid, p_by uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare tgt public.profiles; who text;
begin
  select * into tgt from public.profiles where id = p_user;
  who := coalesce(private.person_name(p_by), 'The Principal');
  insert into private.temp_pw (user_id, hash, set_by, set_at, cleared_at)
  select id, encrypted_password, p_by, now(), null from auth.users where id = p_user
  on conflict (user_id) do update set hash = excluded.hash, set_by = excluded.set_by, set_at = now(), cleared_at = null;
  insert into public.activity_log (actor, table_name, row_id, action, subject_user, is_private, after)
  values (p_by, 'account', p_user::text, p_action, p_user, false,
          jsonb_build_object('email', tgt.email, 'name', coalesce(private.person_name(p_user), tgt.email)));
  if p_action = 'password_reset' then
    insert into public.notifications (user_id, kind, title, body, sender)
    values (p_user, 'account', left('Password reset by ' || who, 90),
            'Your password was reset by ' || who || '. If you did not ask for this, tell them straight away.', p_by);
  end if;
end $$;
revoke all on function public.admin_mark_temp_pw(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_mark_temp_pw(uuid, uuid, text) to service_role;

-- The app asks this after sign-in: true means "choose your own password before continuing".
-- It clears itself once the password has actually changed.
create or replace function public.temp_password_pending()
returns boolean language plpgsql security definer set search_path = '' as $$
declare t private.temp_pw; cur text;
begin
  select * into t from private.temp_pw where user_id = auth.uid() and cleared_at is null;
  if not found then return false; end if;
  select encrypted_password into cur from auth.users where id = auth.uid();
  if cur is distinct from t.hash then
    update private.temp_pw set cleared_at = now() where user_id = auth.uid();
    insert into public.activity_log (actor, table_name, row_id, action, subject_user, is_private, after)
    values (auth.uid(), 'account', auth.uid()::text, 'password_chosen', auth.uid(), false, '{}'::jsonb);
    return false;
  end if;
  return true;
end $$;
revoke all on function public.temp_password_pending() from public, anon;
grant execute on function public.temp_password_pending() to authenticated;
