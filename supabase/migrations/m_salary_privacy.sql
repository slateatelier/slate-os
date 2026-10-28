-- SLATE OS · Salaries only the Principal sees (28 Oct 2026)
-- In Settings the Principal can mark a person's salary "Only me" (principalOnly on their Finance staff record).
-- Such a salary is then hidden from the COO everywhere, not just on screen: the staff record, their advances, any salary or
-- bonus sheet that includes them (pay them on a separate private sheet), and the Finance change log.
-- Nobody is marked yet, so nothing changes until the Principal turns it on for someone.
-- Also stops two Finance staff records being made for the same SLATE OS account.
-- Run in Supabase › SQL Editor. Safe to run more than once.

create or replace function private.fin_staff_private(sid text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (data->>'principalOnly')::boolean from public.fin_docs where path = 'staff/' || coalesce(sid, '')), false)
$$;

create or replace function private.fin_row_private(p_path text, d jsonb) returns boolean language sql stable security definer set search_path = '' as $$
  select case split_part(coalesce(p_path, ''), '/', 1)
    when 'staff' then coalesce((d->>'principalOnly')::boolean, false)
    when 'advances' then private.fin_staff_private(d->>'staffId')
    when 'payruns' then coalesce((d->>'priv')::boolean, false)
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d->'lines') = 'array' then d->'lines' else '[]'::jsonb end) l
                 where private.fin_staff_private(l->>'staffId'))
    else false end
$$;

-- another staff record already linked to this SLATE OS account
create or replace function private.fin_staff_dup(p_path text, uid text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(uid, '') <> '' and exists (select 1 from public.fin_docs where coll = 'staff' and path <> p_path and data->>'userId' = uid)
$$;

drop policy if exists fin_private_principal on public.fin_docs;
create policy fin_private_principal on public.fin_docs as restrictive for all to authenticated
  using (private.fin_role() is distinct from 'coo' or not private.fin_row_private(path, data))
  with check ((private.fin_role() is distinct from 'coo' or not private.fin_row_private(path, data))
              and not (split_part(path, '/', 1) = 'staff' and private.fin_staff_dup(path, data->>'userId')));

drop policy if exists fin_audit_private on public.fin_audit;
create policy fin_audit_private on public.fin_audit as restrictive for select to authenticated
  using (private.fin_role() is distinct from 'coo'
         or not (private.fin_row_private(path, coalesce(after, before)) or private.fin_row_private(path, before)));

-- which SLATE OS people have a private salary (names only, no amounts), so the COO sees "private" instead of "no salary set"
create or replace function public.fin_private_people() returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.fin_role() in ('principal', 'coo') then coalesce((select jsonb_agg(data->>'userId') from public.fin_docs
    where coll = 'staff' and coalesce((data->>'principalOnly')::boolean, false) and coalesce(data->>'userId', '') <> ''), '[]'::jsonb) else '[]'::jsonb end
$$;
grant execute on function public.fin_private_people() to authenticated;
