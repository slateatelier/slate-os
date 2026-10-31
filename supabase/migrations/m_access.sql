-- One place for access (31 Oct 2026): each person's HR card in Business › HR & salaries.
-- From there the Principal (and the COO, within limits) sets a person's SLATE OS role, POD, Books role and,
-- for the Principal only, the manager / approver / private-tasks / Chalk-lead rights. Studio and Books show them.
--  * Business access follows the SLATE OS role: the Principal and the COO only (the old, hidden Finance role
--    list is no longer used for it).
--  * The COO cannot change their own access or the Principal's, cannot make anyone Principal or COO, and cannot
--    change the manager / approver / private / Chalk-lead rights.
--  * A project's code, name and client are kept in Studio; Business › Fees copies them whenever they change.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

-- Business access from the SLATE OS role (one source)
create or replace function private.fin_role() returns text
language sql stable security definer set search_path to '' as $$
  select case p.designation::text when 'principal' then 'principal' when 'coo' then 'coo' end
  from public.profiles p where p.id = auth.uid() and p.active
$$;

-- the HR card may change profiles on the caller's behalf, after its own checks
do $mig$
declare src text := pg_get_functiondef('private.guard_profiles'::regproc); a text;
begin
  if src like '%slate.hr_access%' then return; end if;
  a := 'begin
  if auth.uid() is null then';
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'access patch: profiles guard start not found once'; end if;
  src := replace(src, a, 'begin
  if current_setting(''slate.hr_access'', true) = ''1'' then return new; end if;
  if auth.uid() is null then');
  execute src;
end $mig$;

-- ... and the Books roles list
do $mig$
declare src text := pg_get_functiondef('private.books_guard'::regproc); a text;
begin
  if src like '%slate.books_sync%' then return; end if;
  a := 'if coalesce(new.path, old.path) = ''settings/main'' and r is distinct from ''Principal'' then';
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'access patch: books guard settings line not found once'; end if;
  src := replace(src, a, 'if coalesce(new.path, old.path) = ''settings/main'' and r is distinct from ''Principal'' and coalesce(current_setting(''slate.books_sync'', true), '''') <> ''1'' then');
  execute src;
end $mig$;

create or replace function public.hr_set_access(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  me_owner boolean := private.is_owner(); me_coo boolean := private.is_coo() and not private.is_owner();
  t public.profiles; nd text; br text; bteam jsonb; flags boolean := p ? 'manager' or p ? 'approver' or p ? 'private' or p ? 'chalkLead';
begin
  if not (me_owner or me_coo) then raise exception 'Only the Principal or the COO sets access'; end if;
  if not private.pin_ok() then raise exception 'Enter your PIN first'; end if;
  select * into t from public.profiles where id = p_user;
  if t.id is null then raise exception 'This person has no SLATE OS account'; end if;
  if me_coo then
    if p_user = auth.uid() then raise exception 'Only the Principal changes the COO''s access'; end if;
    if t.designation in ('principal', 'coo') then raise exception 'Only the Principal changes this person''s access'; end if;
    if flags then raise exception 'Only the Principal sets manager, approver, private-task and Chalk-lead rights'; end if;
  end if;
  if p ? 'role' then
    nd := private.designation_from_role(coalesce(p->>'role', ''))::text;
    if me_coo and nd in ('principal', 'coo') then raise exception 'Only the Principal makes someone Principal or COO'; end if;
    if t.designation = 'principal' and nd <> 'principal' then raise exception 'The Principal stays Principal'; end if;
    if t.designation <> 'principal' and nd = 'principal' then raise exception 'There is one Principal'; end if;
  end if;

  perform set_config('slate.hr_access', '1', true);
  update public.profiles set
    role_label  = case when p ? 'role' then nullif(p->>'role', '') else role_label end,
    designation = case when p ? 'role' then private.designation_from_role(coalesce(p->>'role', '')) else designation end,
    team        = case when p ? 'team' then nullif(p->>'team', '') else team end,
    team_at     = case when p ? 'team' and nullif(p->>'team', '') is distinct from team then now() else team_at end,
    is_manager  = case when p ? 'manager' then (p->>'manager')::boolean else is_manager end,
    is_approver = case when p ? 'approver' then (p->>'approver')::boolean else is_approver end,
    is_private  = case when p ? 'private' then (p->>'private')::boolean else is_private end,
    is_chalk_lead = case when p ? 'chalkLead' then (p->>'chalkLead')::boolean else is_chalk_lead end
  where id = p_user;
  perform set_config('slate.hr_access', '', true);

  if p ? 'books' then
    br := nullif(p->>'books', '');
    if br is not null and br not in ('Accountant', 'Office staff', 'Viewer') then raise exception 'Unknown Books role'; end if;
    select coalesce(s.data->'team', '{}'::jsonb) into bteam from public.books_docs s where s.path = 'settings/main';
    bteam := coalesce(bteam, '{}'::jsonb);
    if br is null then
      bteam := case when coalesce(bteam->(p_user::text), '{}'::jsonb) - 'role' = '{}'::jsonb then bteam - p_user::text
                   else jsonb_set(bteam, array[p_user::text], (bteam->(p_user::text)) - 'role') end;
    else
      bteam := jsonb_set(bteam, array[p_user::text], coalesce(bteam->(p_user::text), '{}'::jsonb) || jsonb_build_object('role', br));
    end if;
    perform set_config('slate.books_sync', '1', true);
    update public.books_docs set data = jsonb_set(data, '{team}', bteam) where path = 'settings/main';
    perform set_config('slate.books_sync', '', true);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.hr_set_access(uuid, jsonb) from public, anon;
grant execute on function public.hr_set_access(uuid, jsonb) to authenticated;

-- Business's own guard lets that copy through (it is made by the database, not by the person editing Studio)
do $mig$
declare src text := pg_get_functiondef('private.fin_guard'::regproc); a text;
begin
  if src like '%slate.os_sync%' then return; end if;
  a := 'begin
  if uid is not null and coalesce(role, '''') not in';
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'access patch: finance guard start not found once'; end if;
  src := replace(src, a, 'begin
  if current_setting(''slate.os_sync'', true) = ''1'' then return coalesce(new, old); end if;
  if uid is not null and coalesce(role, '''') not in');
  execute src;
end $mig$;

-- a project's code, name and client come from Studio; Business › Fees keeps its copy in step
create or replace function private.books_from_project() returns trigger
language plpgsql security definer set search_path to '' as $$
declare f record;
begin
  if (old.data->'code', old.data->'name', old.data->'client') is distinct from (new.data->'code', new.data->'name', new.data->'client') then
    perform set_config('slate.os_sync', '1', true);
    update public.fin_docs set data = data || jsonb_strip_nulls(jsonb_build_object('code', new.data->'code', 'name', new.data->'name', 'client', new.data->'client'))
    where coll = 'projects' and data->>'osId' = new.doc_id
      and (data->'code', data->'name', data->'client') is distinct from (new.data->'code', new.data->'name', new.data->'client');
    perform set_config('slate.os_sync', '', true);
  end if;
  if (old.data->'closed') is distinct from (new.data->'closed') then
    for f in select doc_id, data from public.fin_docs where coll = 'projects' and data->>'osId' = new.doc_id loop
      perform private.books_sync_project(f.doc_id, f.data);
    end loop;
  end if;
  return null;
end $$;

commit;
