-- Deactivate / reactivate a person (someone who leaves SLATE).
-- Called only by the admin-users edge function, which also blocks or restores their sign-in.
-- Their records (tasks, history, minutes, log) stay; an inactive account is read-only and
-- drops out of the people pickers.
create or replace function public.admin_set_active(p_user uuid, p_by uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare tgt public.profiles;
begin
  select * into tgt from public.profiles where id = p_user;
  if tgt.id is null then raise exception 'That person was not found'; end if;
  update public.profiles set active = p_active where id = p_user;
  insert into public.activity_log (actor, table_name, row_id, action, subject_user, is_private, after)
  values (p_by, 'account', p_user::text, case when p_active then 'account_reactivate' else 'account_deactivate' end, p_user, false,
          jsonb_build_object('email', tgt.email, 'name', coalesce(private.person_name(p_user), tgt.email)));
  -- their phones stop getting notifications
  if not p_active then delete from public.push_subs where user_id = p_user; end if;
end $$;

revoke all on function public.admin_set_active(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_active(uuid, uuid, boolean) to service_role;

-- Leaving SLATE handover (Oct 2026): last working day on the profile, and the function records it.
-- The edge function refuses to close an account that still has open tasks.
alter table public.profiles add column if not exists left_on date;
create or replace function public.admin_set_active(p_user uuid, p_by uuid, p_active boolean, p_last_day date)
returns void language plpgsql security definer set search_path to '' as $$
declare tgt public.profiles;
begin
  select * into tgt from public.profiles where id = p_user;
  if tgt.id is null then raise exception 'That person was not found'; end if;
  update public.profiles set active = p_active,
         left_on = case when p_active then null else coalesce(p_last_day, current_date) end
   where id = p_user;
  insert into public.activity_log (actor, table_name, row_id, action, subject_user, is_private, after)
  values (p_by, 'account', p_user::text, case when p_active then 'account_reactivate' else 'account_deactivate' end, p_user, false,
          jsonb_build_object('email', tgt.email, 'name', coalesce(private.person_name(p_user), tgt.email),
                             'last_day', case when p_active then null else coalesce(p_last_day, current_date) end));
  if not p_active then delete from public.push_subs where user_id = p_user; end if;
end $$;
revoke all on function public.admin_set_active(uuid, uuid, boolean, date) from public, anon, authenticated;
grant execute on function public.admin_set_active(uuid, uuid, boolean, date) to service_role;
-- guard_profiles also now treats left_on like active: only the Principal or COO change it.
