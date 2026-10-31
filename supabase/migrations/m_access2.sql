-- Access changes need the Principal's approval (31 Oct 2026). Runs after m_access.sql.
--  * When the COO changes someone's access on their HR card (SLATE OS role, POD, Books role, or switching their
--    sign-in off or on), nothing changes yet: it becomes a request the Principal approves or declines.
--  * The Principal's own changes apply at once.
--  * Every change, approved or direct, is kept in a log (public.access_requests) with who asked, who approved, and
--    what each value was before and after. Only the Principal and the COO can read it.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

create table if not exists public.access_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  patch jsonb not null,
  before jsonb not null default '{}',
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'applied', 'declined', 'replaced', 'withdrawn')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  note text
);
create index if not exists access_requests_status on public.access_requests (status, requested_at desc);
alter table public.access_requests enable row level security;
revoke all on public.access_requests from anon;
revoke insert, update, delete, truncate on public.access_requests from authenticated;
grant select on public.access_requests to authenticated;
drop policy if exists access_requests_read on public.access_requests;
create policy access_requests_read on public.access_requests for select to authenticated
  using ((private.is_owner() or private.is_coo()) and private.pin_ok());

-- what someone's access is now, in the same words the HR card uses
create or replace function private.access_now(p_user uuid) returns jsonb
language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('role', coalesce(p.role_label, ''), 'team', coalesce(p.team, ''), 'manager', p.is_manager, 'approver', p.is_approver,
    'private', p.is_private, 'chalkLead', p.is_chalk_lead, 'login', p.active,
    'books', coalesce((select s.data->'team'->(p_user::text)->>'role' from public.books_docs s where s.path = 'settings/main'), ''))
  from public.profiles p where p.id = p_user
$$;

-- the checks: who may ask for what (shared by asking and approving)
create or replace function private.access_check(p_user uuid, p jsonb, p_owner boolean) returns void
language plpgsql stable security definer set search_path to '' as $$
declare t public.profiles; nd text; flags boolean := p ? 'manager' or p ? 'approver' or p ? 'private' or p ? 'chalkLead';
begin
  select * into t from public.profiles where id = p_user;
  if t.id is null then raise exception 'This person has no SLATE OS account'; end if;
  if t.designation = 'principal' then raise exception 'The Principal has every access.'; end if;
  if not p_owner then
    if p_user = auth.uid() then raise exception 'Only the Principal changes the COO''s access'; end if;
    if t.designation = 'coo' then raise exception 'Only the Principal changes this person''s access'; end if;
    if flags then raise exception 'Only the Principal sets manager, approver, private-task and Chalk-lead rights'; end if;
  end if;
  if p ? 'role' then
    nd := private.designation_from_role(coalesce(p->>'role', ''))::text;
    if not p_owner and nd in ('principal', 'coo') then raise exception 'Only the Principal makes someone Principal or COO'; end if;
    if nd = 'principal' then raise exception 'There is one Principal'; end if;
  end if;
  if p ? 'books' and nullif(p->>'books', '') is not null and p->>'books' not in ('Accountant', 'Office staff', 'Viewer') then raise exception 'Unknown Books role'; end if;
end $$;

-- make the change (the sign-in itself is switched by the app through the accounts service, after this returns)
create or replace function private.access_apply(p_user uuid, p jsonb) returns void
language plpgsql security definer set search_path to '' as $$
declare br text; bteam jsonb;
begin
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
end $$;

-- the HR card saves through this. The Principal's change applies at once; the COO's waits for the Principal.
-- p may also hold "login": false / true (switch the sign-in off or on), which the app carries out once applied.
create or replace function public.hr_set_access(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare me_owner boolean := private.is_owner(); me_coo boolean := private.is_coo() and not private.is_owner();
  rid bigint; bef jsonb; pr uuid; nm text;
begin
  if not (me_owner or me_coo) then raise exception 'Only the Principal or the COO sets access'; end if;
  if not private.pin_ok() then raise exception 'Enter your PIN first'; end if;
  if p is null or p = '{}'::jsonb then return jsonb_build_object('ok', true, 'nothing', true); end if;
  perform private.access_check(p_user, p, me_owner);
  bef := private.access_now(p_user);
  if me_owner then
    perform private.access_apply(p_user, p - 'login');
    insert into public.access_requests (user_id, patch, before, requested_by, status, decided_by, decided_at)
    values (p_user, p, bef, auth.uid(), 'applied', auth.uid(), now()) returning id into rid;
    return jsonb_build_object('ok', true, 'applied', true, 'id', rid);
  end if;
  -- a second change while one waits is added to it (the newer value wins), so nothing asked for earlier is lost
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) || p into p from (
    select e.key k, e.value v from public.access_requests r, jsonb_each(r.patch) e where r.user_id = p_user and r.status = 'pending') s;
  update public.access_requests set status = 'replaced', decided_at = now() where user_id = p_user and status = 'pending';
  insert into public.access_requests (user_id, patch, before, requested_by) values (p_user, p, bef, auth.uid()) returning id into rid;
  select coalesce(nullif(label, ''), full_name) into nm from public.profiles where id = p_user;
  for pr in select id from public.profiles where designation = 'principal' and active loop
    perform private.notify(pr, 'access_request', 'Access change to approve', coalesce(private.conv_name(auth.uid()), 'The COO') || ' asked to change ' || coalesce(nm, 'someone') || '''s access. Open Business › HR & salaries to approve or decline.');
  end loop;
  return jsonb_build_object('ok', true, 'pending', true, 'id', rid);
end $$;

-- the Principal approves or declines
create or replace function public.access_decide(p_id bigint, p_approve boolean, p_note text default '') returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r public.access_requests;
begin
  if not private.is_owner() then raise exception 'Only the Principal approves access changes.'; end if;
  if not private.pin_ok() then raise exception 'Enter your PIN first'; end if;
  select * into r from public.access_requests where id = p_id for update;
  if r.id is null or r.status <> 'pending' then raise exception 'This request has already been dealt with.'; end if;
  if p_approve then
    perform private.access_check(r.user_id, r.patch, false);
    perform private.access_apply(r.user_id, r.patch - 'login');
  end if;
  update public.access_requests set status = case when p_approve then 'applied' else 'declined' end, decided_by = auth.uid(), decided_at = now(),
    note = nullif(trim(coalesce(p_note, '')), '') where id = r.id;
  perform private.notify(r.requested_by, 'access_request', 'Access change ' || case when p_approve then 'approved' else 'declined' end,
    'Your change to ' || coalesce(private.conv_name(r.user_id), 'someone') || '''s access was ' || case when p_approve then 'approved and is now in effect.' else 'declined.' end
    || coalesce(' ' || nullif(trim(coalesce(p_note, '')), ''), ''));
  return jsonb_build_object('ok', true, 'login', r.patch->'login', 'user', r.user_id);
end $$;

-- the COO can take back her own request while it waits
create or replace function public.access_withdraw(p_id bigint) returns void
language plpgsql security definer set search_path to '' as $$
begin
  update public.access_requests set status = 'withdrawn', decided_at = now() where id = p_id and requested_by = auth.uid() and status = 'pending';
  if not found then raise exception 'Only your own request, while it waits, can be withdrawn.'; end if;
end $$;

revoke all on function public.hr_set_access(uuid, jsonb), public.access_decide(bigint, boolean, text), public.access_withdraw(bigint) from public, anon;
grant execute on function public.hr_set_access(uuid, jsonb), public.access_decide(bigint, boolean, text), public.access_withdraw(bigint) to authenticated;

commit;
