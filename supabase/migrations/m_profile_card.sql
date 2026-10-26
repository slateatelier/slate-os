-- My profile (Oct 2026): each person edits their full name, short name and work mobile; an optional emergency contact
-- is kept private (themselves, the Principal and the COO). The share-contact QR is built from these on the device.

-- work mobile, visible to the team (it goes on the contact card)
alter table public.profiles add column if not exists mobile text;
alter table public.profiles drop constraint if exists profiles_mobile_len;
alter table public.profiles add constraint profiles_mobile_len check (mobile is null or char_length(mobile) <= 20);
alter table public.profiles drop constraint if exists profiles_full_name_len;
alter table public.profiles add constraint profiles_full_name_len check (full_name is null or char_length(full_name) <= 60);

-- people may now set their own short name (label); teams, status and roles stay with the Principal / COO
create or replace function private.guard_profiles()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if auth.uid() is null then
    if new.role_label is distinct from old.role_label then new.designation := private.designation_from_role(new.role_label); end if;
    return new;
  end if;
  if (new.designation, new.role_label, new.is_manager, new.is_approver, new.is_private, new.is_chalk_lead)
     is distinct from (old.designation, old.role_label, old.is_manager, old.is_approver, old.is_private, old.is_chalk_lead)
     and not private.is_owner() then
    raise exception 'Only the Principal changes designations, approver/manager rights or privacy';
  end if;
  if old.designation = 'principal' and old.id <> auth.uid() and not private.is_owner() then
    raise exception 'Only the Principal edits the Principal profile';
  end if;
  if (new.team, new.pod_id, new.active, new.left_on) is distinct from (old.team, old.pod_id, old.active, old.left_on)
     and not private.is_approver() then
    raise exception 'Only the Principal or COO changes teams or account status';
  end if;
  if (new.label, new.full_name, new.mobile, new.email) is distinct from (old.label, old.full_name, old.mobile, old.email)
     and new.id <> auth.uid() and not private.is_approver() then
    raise exception 'Only you, the Principal or the COO change your name or contact details';
  end if;
  if new.email is distinct from old.email and not private.is_approver() then
    raise exception 'Your office email is your sign-in; ask the COO to change it';
  end if;
  if (new.icon, new.icon_at) is distinct from (old.icon, old.icon_at)
     and new.id <> auth.uid() and not private.is_approver() then
    raise exception 'Only you, the Principal or the COO change your icon';
  end if;
  if new.role_label is distinct from old.role_label then
    new.designation := private.designation_from_role(new.role_label);
  end if;
  return new;
end $function$;

-- emergency contact: private
create table if not exists public.profile_private (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  emergency_name text check (emergency_name is null or char_length(emergency_name) <= 60),
  emergency_phone text check (emergency_phone is null or char_length(emergency_phone) <= 20),
  updated_at timestamptz not null default now()
);
alter table public.profile_private enable row level security;
drop policy if exists profile_private_select on public.profile_private;
create policy profile_private_select on public.profile_private for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_owner()) or (select private.is_coo()));
drop policy if exists profile_private_insert on public.profile_private;
create policy profile_private_insert on public.profile_private for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists profile_private_update on public.profile_private;
create policy profile_private_update on public.profile_private for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists profile_private_delete on public.profile_private;
create policy profile_private_delete on public.profile_private for delete to authenticated
  using (user_id = (select auth.uid()));
