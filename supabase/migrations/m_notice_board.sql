-- SLATE OS · Notice board (26 Oct 2026), applied as notice_board
-- Company-wide announcements, kept apart from personal notifications and messages.
-- * The Principal and the COO post, edit, pin and archive notices; only the Principal deletes. Everyone with an account reads them.
-- * Each person taps "Got it" once; the poster sees who has and hasn't seen a notice.
-- * A notice can be marked important: then everyone also gets one phone notification. Otherwise it only sits on the board.
-- * A notice can have a "show until" date; after it, it drops off Home and moves to the board's past notices.

create table if not exists public.notices (
  id bigint generated always as identity primary key,
  title text not null check (char_length(trim(title)) between 3 and 120),
  body text not null default '' check (char_length(body) <= 4000),
  category text not null default 'general' check (category in ('general','policy','hr','holiday','event','office')),
  pinned boolean not null default false,
  important boolean not null default false,
  until date,
  archived boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index if not exists notices_created_by_idx on public.notices (created_by);
create index if not exists notices_updated_by_idx on public.notices (updated_by);

create table if not exists public.notice_reads (
  notice_id bigint not null references public.notices(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (notice_id, user_id)
);
create index if not exists notice_reads_user_idx on public.notice_reads (user_id);

alter table public.notices enable row level security;
alter table public.notice_reads enable row level security;

create policy notices_select on public.notices for select to authenticated using (true);
create policy notices_insert on public.notices for insert to authenticated
  with check ((select private.is_approver()) and created_by = (select auth.uid()));
create policy notices_update on public.notices for update to authenticated
  using ((select private.is_approver())) with check ((select private.is_approver()));
-- permanent delete: the Principal only (the COO archives)
create policy notices_delete on public.notices for delete to authenticated using ((select private.is_owner()));

create policy notice_reads_select on public.notice_reads for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_approver()));
create policy notice_reads_insert on public.notice_reads for insert to authenticated
  with check (user_id = (select auth.uid()));

-- stamp edits; the author never changes
create or replace function private.notices_stamp()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.created_at := old.created_at; end if;
  new.title := trim(new.title); new.body := trim(new.body);
  return new;
end $$;
create trigger a_notices_stamp before insert or update on public.notices
  for each row execute function private.notices_stamp();

-- important notice: one phone notification to everyone (once, when posted or first marked important)
create or replace function private.notices_push()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.important and not new.archived and (tg_op = 'INSERT' or not old.important) then
    begin
      insert into public.notifications (user_id, kind, title, body, task_ref)
      select p.id, 'notice', left('Notice: ' || new.title, 90), left(new.body, 320), 'notice:' || new.id
      from public.profiles p
      where p.active and p.id is distinct from new.created_by
        and not exists (select 1 from public.notifications n where n.user_id = p.id and n.task_ref = 'notice:' || new.id);
    exception when others then raise warning 'notice push skipped: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
create trigger b_notices_push after insert or update on public.notices
  for each row execute function private.notices_push();

alter publication supabase_realtime add table public.notices, public.notice_reads;
