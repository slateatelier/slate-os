-- SLATE OS · Working drawing list (Principal, 7 Nov 2026)
-- WD phases (6 WD-1 Substructure, 7 WD-2 Superstructure, 8 WD-3 Finishing) keep a drawing list per project: one row per
-- drawing, given to anyone (Drafting Pool, POD member or POD leader), with a finish-by date and a status:
--   todo → doing → drafted (sent for checking) → checked → issued (NFC, then GFC; revision number).
-- Checking: a drawing by a Drafting Pool member is checked first by the Design Associate Lead (drafting quality), then by
-- the project's POD leader (design intent). A drawing by anyone else is checked by the POD leader only.
-- The POD leader confirms the list at the start of the phase (standard list, edited for the project).
-- Every 3 working days while the list has drawings not yet issued GFC, the POD leader and the Design Associate Lead are
-- asked to review progress; not reviewed 1 working day later, the COO is told.
-- Safe to run more than once.

create table if not exists public.dwg_items (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  phase text not null check (phase in ('6','7','8')),
  ord int not null default 0,
  no text not null default '',
  title text not null check (length(btrim(title)) between 2 and 160),
  who uuid references public.profiles(id),
  due date,
  st text not null default 'todo' check (st in ('todo','doing','drafted','checked','issued')),
  chk1_by uuid, chk1_at timestamptz,
  chk2_by uuid, chk2_at timestamptz,
  ret_note text, ret_by uuid, ret_at timestamptz,
  rev int not null default 0,
  issue text not null default '' check (issue in ('','nfc','gfc')),
  issued_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists dwg_items_proj on public.dwg_items (project_id, phase, ord);

create table if not exists public.dwg_lists (
  project_id text not null,
  phase text not null check (phase in ('6','7','8')),
  confirmed_by uuid, confirmed_at timestamptz,
  review_at timestamptz, review_by uuid, review_note text,
  primary key (project_id, phase)
);

create table if not exists public.dwg_reviews (
  id bigint generated always as identity primary key,
  project_id text not null,
  phase text not null,
  by uuid not null default auth.uid(),
  at timestamptz not null default now(),
  note text not null default '',
  stats jsonb not null default '{}'::jsonb
);
create index if not exists dwg_reviews_proj on public.dwg_reviews (project_id, phase, at desc);

alter table public.dwg_items enable row level security;
alter table public.dwg_lists enable row level security;
alter table public.dwg_reviews enable row level security;

-- who leads this project: the Principal, the COO, or a POD leader of one of its PODs
create or replace function private.dwg_lead(pid text)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_top() or private.is_owner() or private.leads_doc(pid)
$$;
revoke all on function private.dwg_lead(text) from public, anon;
grant execute on function private.dwg_lead(text) to authenticated;

drop policy if exists dwg_items_select on public.dwg_items;
create policy dwg_items_select on public.dwg_items for select to authenticated
  using (private.is_top() or private.can_see_project_doc(project_id));
drop policy if exists dwg_items_insert on public.dwg_items;
create policy dwg_items_insert on public.dwg_items for insert to authenticated
  with check (private.is_active() and private.dwg_lead(project_id));
drop policy if exists dwg_items_update on public.dwg_items;
create policy dwg_items_update on public.dwg_items for update to authenticated
  using (private.is_active() and (private.is_top() or private.can_see_project_doc(project_id)))
  with check (private.is_active());
drop policy if exists dwg_items_delete on public.dwg_items;
create policy dwg_items_delete on public.dwg_items for delete to authenticated
  using (private.is_active() and private.dwg_lead(project_id) and st in ('todo','doing'));

drop policy if exists dwg_lists_select on public.dwg_lists;
create policy dwg_lists_select on public.dwg_lists for select to authenticated
  using (private.is_top() or private.can_see_project_doc(project_id));
drop policy if exists dwg_lists_write on public.dwg_lists;
create policy dwg_lists_write on public.dwg_lists for all to authenticated
  using (private.is_active() and (private.dwg_lead(project_id) or private.my_designation() = 'design_associate_lead'))
  with check (private.is_active() and (private.dwg_lead(project_id) or private.my_designation() = 'design_associate_lead'));

drop policy if exists dwg_reviews_select on public.dwg_reviews;
create policy dwg_reviews_select on public.dwg_reviews for select to authenticated
  using (private.is_top() or private.can_see_project_doc(project_id));
drop policy if exists dwg_reviews_insert on public.dwg_reviews;
create policy dwg_reviews_insert on public.dwg_reviews for insert to authenticated
  with check (private.is_active() and by = auth.uid()
              and (private.dwg_lead(project_id) or private.my_designation() = 'design_associate_lead'));

grant select, insert, update, delete on public.dwg_items, public.dwg_lists to authenticated;
grant select, insert on public.dwg_reviews to authenticated;

-- what each person may change on a drawing
create or replace function private.dwg_guard()
returns trigger language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); lead boolean; dl boolean; drafter boolean;
begin
  new.updated_at := now(); new.updated_by := me;
  if me is null then return new; end if;
  if tg_op = 'INSERT' then return new; end if;   -- insert is the lead's (policy)
  lead := private.dwg_lead(old.project_id);
  if new.project_id is distinct from old.project_id or new.phase is distinct from old.phase or new.created_by is distinct from old.created_by then
    raise exception 'A drawing stays on its project and phase';
  end if;
  if lead then return new; end if;
  dl := private.my_designation() = 'design_associate_lead';
  drafter := old.who is not null and private.is_drafting_member(old.who);
  if (new.title, new.no, new.ord, new.rev, new.issue, new.issued_at, new.chk2_by, new.chk2_at)
     is distinct from (old.title, old.no, old.ord, old.rev, old.issue, old.issued_at, old.chk2_by, old.chk2_at) then
    raise exception 'Only the POD leader changes the list, the final check and the issue';
  end if;
  if new.st in ('checked','issued') and new.st is distinct from old.st then
    raise exception 'The POD leader gives the final check';
  end if;
  if dl then
    -- the Design Associate Lead: gives drafting work out within the Drafting Pool, checks drafting first, returns it
    if new.who is distinct from old.who
       and not ((old.who is null or private.is_drafting_member(old.who)) and (new.who is null or private.is_drafting_member(new.who))) then
      raise exception 'The Design Associate Lead gives drawings to the Drafting Pool; the POD leader gives them to anyone else';
    end if;
    if (new.chk1_by, new.chk1_at) is distinct from (old.chk1_by, old.chk1_at)
       and new.chk1_by is not null and (new.chk1_by <> me or not drafter or old.st <> 'drafted') then
      raise exception 'The drafting check is given on a Drafting Pool drawing sent for checking, in your own name';
    end if;
    return new;
  end if;
  if (new.ret_note, new.ret_by, new.ret_at) is distinct from (old.ret_note, old.ret_by, old.ret_at) then
    raise exception 'Only a checker returns a drawing';
  end if;
  if (new.chk1_by, new.chk1_at) is distinct from (old.chk1_by, old.chk1_at) then
    raise exception 'Only the Design Associate Lead gives the drafting check';
  end if;
  -- anyone who can see the project takes an unassigned drawing for themselves
  if old.who is null and new.who = me then
    if new.st not in ('todo','doing') then raise exception 'Start the drawing first'; end if;
    return new;
  end if;
  if old.who is distinct from me then raise exception 'This drawing is someone else''s'; end if;
  if new.who is distinct from old.who then raise exception 'Only the POD leader or the Design Associate Lead hands a drawing on'; end if;
  if new.st is distinct from old.st and not ((old.st, new.st) in (('todo','doing'),('doing','drafted'),('drafted','doing'),('doing','todo'))) then
    raise exception 'Start it, then send it for checking';
  end if;
  return new;
end $$;
revoke all on function private.dwg_guard() from public, anon, authenticated;
drop trigger if exists a_dwg_guard on public.dwg_items;
create trigger a_dwg_guard before insert or update on public.dwg_items
  for each row execute function private.dwg_guard();

-- the reviewer guard (read-only review logins) covers the new tables too
do $g$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'reviewer_guard') then
    execute 'drop trigger if exists zz_reviewer_guard on public.dwg_items';
    execute 'create trigger zz_reviewer_guard before insert or update or delete on public.dwg_items for each row execute function private.reviewer_guard()';
    execute 'drop trigger if exists zz_reviewer_guard on public.dwg_lists';
    execute 'create trigger zz_reviewer_guard before insert or update or delete on public.dwg_lists for each row execute function private.reviewer_guard()';
    execute 'drop trigger if exists zz_reviewer_guard on public.dwg_reviews';
    execute 'create trigger zz_reviewer_guard before insert or update or delete on public.dwg_reviews for each row execute function private.reviewer_guard()';
  end if;
end $g$;

-- who leads a project, for notifications
create or replace function private.dwg_leaders(pid text)
returns setof uuid language sql stable security definer set search_path to '' as $$
  select p.id from public.profiles p
   where p.active and p.designation = 'pod_leader' and p.pod_id = any(private.project_pods_of(pid))
$$;
revoke all on function private.dwg_leaders(text) from public, anon, authenticated;

create or replace function private.dwg_label(pid text, ph text)
returns text language sql stable security definer set search_path to '' as $$
  select coalesce(nullif(d.data->>'name', ''), 'Project') || ' · ' || case ph when '6' then 'WD-1' when '7' then 'WD-2' else 'WD-3' end
    from public.docs d where d.path = 'projects/' || pid
$$;
revoke all on function private.dwg_label(text, text) from public, anon, authenticated;

-- tell the next person: the drawing's new owner, the checker when it is sent, the owner when it is returned
create or replace function private.dwg_notify()
returns trigger language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); lbl text; ref text; nm text; u uuid;
begin
  if private.is_reviewer_id(coalesce(me, '00000000-0000-0000-0000-000000000000'::uuid)) then return new; end if;
  lbl := coalesce(private.dwg_label(new.project_id, new.phase), 'Drawing');
  ref := 'dwg:' || new.project_id || ':' || new.phase || ':' || new.id;
  nm := coalesce((select nullif(full_name, '') from public.profiles where id = me), 'Someone');
  if new.who is not null and new.who is distinct from coalesce(me, '00000000-0000-0000-0000-000000000000'::uuid)
     and (tg_op = 'INSERT' or new.who is distinct from old.who) then
    insert into public.notifications (user_id, kind, title, body, task_ref)
    values (new.who, 'dwg', left('Drawing for you: ' || new.title, 90),
            left(lbl || coalesce(' · finish by ' || to_char(new.due, 'DD Mon'), '') || ' · from ' || nm, 300), ref);
  end if;
  if tg_op = 'UPDATE' and new.st = 'drafted' and (old.st <> 'drafted' or new.chk1_at is distinct from old.chk1_at) then
    if new.who is not null and private.is_drafting_member(new.who) and new.chk1_at is null then
      for u in select id from public.profiles where active and designation = 'design_associate_lead' and id is distinct from new.who loop
        insert into public.notifications (user_id, kind, title, body, task_ref)
        values (u, 'dwg', left('Drawing to check: ' || new.title, 90), left(lbl || ' · drafting check, then the POD leader', 300), ref || '@chk1');
      end loop;
    else
      for u in select private.dwg_leaders(new.project_id) loop
        continue when u = new.who;
        insert into public.notifications (user_id, kind, title, body, task_ref)
        values (u, 'dwg', left('Drawing to check: ' || new.title, 90),
                left(lbl || case when new.chk1_at is not null then ' · drafting check passed' else '' end || ' · your check before issue', 300), ref || '@chk2');
      end loop;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.ret_at is distinct from old.ret_at and new.ret_at is not null and new.who is not null and new.who <> coalesce(me, new.who) then
    insert into public.notifications (user_id, kind, title, body, task_ref)
    values (new.who, 'dwg', left('Drawing returned: ' || new.title, 90), left(lbl || ' · ' || coalesce(new.ret_note, ''), 300), ref || '@ret');
  end if;
  return new;
end $$;
revoke all on function private.dwg_notify() from public, anon, authenticated;
drop trigger if exists b_dwg_notify on public.dwg_items;
create trigger b_dwg_notify after insert or update on public.dwg_items
  for each row execute function private.dwg_notify();

-- every 3 working days: the POD leader and the Design Associate Lead review progress; 1 working day later, the COO is told
create or replace function private.dwg_reviews_due()
returns void language plpgsql security definer set search_path to '' as $$
declare r record; base date; n int; u uuid; lbl text; st text;
begin
  for r in select l.* from public.dwg_lists l
            where l.confirmed_at is not null
              and exists (select 1 from public.dwg_items i where i.project_id = l.project_id and i.phase = l.phase and i.issue <> 'gfc')
              and exists (select 1 from public.docs p where p.path = 'projects/' || l.project_id and coalesce(p.data->>'status', 'active') = 'active') loop
    base := (coalesce(r.review_at, r.confirmed_at) at time zone 'Asia/Dhaka')::date;
    n := private.work_days_since(base);
    continue when n < 3;
    lbl := coalesce(private.dwg_label(r.project_id, r.phase), 'Drawing list');
    select count(*) filter (where i.st in ('drafted','checked','issued')) || ' of ' || count(*) || ' drawn · ' ||
           count(*) filter (where i.st in ('checked','issued')) || ' checked · ' || count(*) filter (where i.issue = 'gfc') || ' GFC' ||
           case when count(*) filter (where i.due < (now() at time zone 'Asia/Dhaka')::date and i.st in ('todo','doing')) > 0
                then ' · ' || count(*) filter (where i.due < (now() at time zone 'Asia/Dhaka')::date and i.st in ('todo','doing')) || ' past their date' else '' end
      into st from public.dwg_items i where i.project_id = r.project_id and i.phase = r.phase;
    for u in select private.dwg_leaders(r.project_id) union select id from public.profiles where active and designation = 'design_associate_lead' loop
      if not exists (select 1 from public.notifications x where x.user_id = u and x.task_ref = 'dwgrev:' || r.project_id || ':' || r.phase || '@' || base) then
        insert into public.notifications (user_id, kind, title, body, task_ref)
        values (u, 'dwg_review', left('Progress check: ' || lbl, 90), left(st || '. Open the drawing list and mark it reviewed.', 300),
                'dwgrev:' || r.project_id || ':' || r.phase || '@' || base);
      end if;
    end loop;
    if n >= 4 then
      for u in select id from public.profiles where active and designation = 'coo' loop
        if not exists (select 1 from public.notifications x where x.user_id = u and x.task_ref = 'dwgesc:' || r.project_id || ':' || r.phase || '@' || base) then
          insert into public.notifications (user_id, kind, title, body, task_ref)
          values (u, 'dwg_review', left('Progress check not done: ' || lbl, 90), left(n || ' working days since the last review. ' || st || '.', 300),
                  'dwgesc:' || r.project_id || ':' || r.phase || '@' || base);
        end if;
      end loop;
    end if;
  end loop;
end $$;
revoke all on function private.dwg_reviews_due() from public, anon, authenticated;

-- a review stamps the list
create or replace function private.dwg_review_stamp()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.dwg_lists (project_id, phase, review_at, review_by, review_note)
  values (new.project_id, new.phase, new.at, new.by, new.note)
  on conflict (project_id, phase) do update set review_at = excluded.review_at, review_by = excluded.review_by, review_note = excluded.review_note;
  return new;
end $$;
revoke all on function private.dwg_review_stamp() from public, anon, authenticated;
drop trigger if exists dwg_review_stamp on public.dwg_reviews;
create trigger dwg_review_stamp after insert on public.dwg_reviews
  for each row execute function private.dwg_review_stamp();

-- live updates in the app
do $p$ begin
  begin execute 'alter publication supabase_realtime add table public.dwg_items'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.dwg_lists'; exception when others then null; end;
end $p$;

select cron.unschedule(jobid) from cron.job where jobname = 'slate-dwg-reviews';
select cron.schedule('slate-dwg-reviews', '25 4 * * 0-4', 'select private.dwg_reviews_due()');
