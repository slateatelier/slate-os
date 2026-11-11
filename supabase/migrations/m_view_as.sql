-- View as (11 Nov 2026): the Principal and the COO see Studio as a team member sees it, read-only.
-- The app does the viewing; the database only keeps a quiet log of who viewed whom and when,
-- readable by the Principal and the COO.
create table if not exists private.view_as_log (
  id bigserial primary key,
  by_id uuid not null references public.profiles(id),
  who_id uuid not null references public.profiles(id),
  at timestamptz not null default now(),
  device text
);
alter table private.view_as_log enable row level security;
revoke all on private.view_as_log from public, anon, authenticated;

create or replace function public.view_as_start(p_who uuid, p_device text default null)
returns boolean language plpgsql security definer set search_path to '' as $$
begin
  if not private.is_top() then raise exception 'Only the Principal or the COO can view as someone.'; end if;
  if not exists (select 1 from public.profiles where id = p_who and active and designation not in ('principal','coo')) then
    raise exception 'That person can''t be viewed.'; end if;
  if private.reviewer_live() then return true; end if;   -- review logins write nothing
  insert into private.view_as_log (by_id, who_id, device) values (auth.uid(), p_who, left(p_device, 20));
  return true;
end $$;

create or replace function public.view_as_list(p_limit int default 30)
returns table (by_id uuid, who_id uuid, at timestamptz, device text)
language sql stable security definer set search_path to '' as $$
  select l.by_id, l.who_id, l.at, l.device from private.view_as_log l
  where private.is_top() order by l.at desc limit greatest(1, least(coalesce(p_limit, 30), 200));
$$;

revoke all on function public.view_as_start(uuid, text) from public, anon;
revoke all on function public.view_as_list(int) from public, anon;
grant execute on function public.view_as_start(uuid, text) to authenticated;
grant execute on function public.view_as_list(int) to authenticated;
