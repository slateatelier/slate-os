-- Work given to the Drafting Pool: the COO and the Design Associate Lead are told (Principal, 4 Nov 2026)
-- POD leaders give tasks to Drafting Pool members directly (m_drafting_assign.sql); nobody approves them.
-- When a task is given to a Design Associate (new task or reassigned), a notification (phone push) goes to:
--   the COO, and the Design Associate Lead, unless they are the one who gave it or the one who got it.
-- Safe to run more than once.

create or replace function private.docs_notify_drafting()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  actor uuid := auth.uid();
  aname text := coalesce(private.person_name(auth.uid()), 'SLATE OS');
  who text; ttl text; body text; r record;
begin
  begin
    if new.coll <> 'tasks' or new.assignee is null then return null; end if;
    if tg_op = 'UPDATE' and new.assignee is not distinct from old.assignee then return null; end if;
    if not exists (select 1 from public.profiles p where p.id = new.assignee and p.active
                     and p.designation = 'design_associate') then return null; end if;
    who := coalesce(private.person_name(new.assignee), 'A Design Associate');
    ttl := coalesce(nullif(new.data->>'title', ''), 'A task');
    body := concat_ws(E'\n', who || ' · “' || ttl || '”', private.project_line(new.project_id),
      coalesce('Due ' || private.fmt_d(new.data->>'target'),
        case when jsonb_typeof(new.data->'request') = 'object' then 'Proposed ' || private.fmt_d(new.data->'request'->>'date') || ' · waiting for approval' else 'No date yet' end));
    for r in select p.id from public.profiles p
              where p.active and p.designation in ('coo', 'design_associate_lead')
                and p.id is distinct from actor and p.id <> new.assignee loop
      perform private.notify(r.id, 'pool_assigned', 'Drafting Pool: work from ' || aname, body);
    end loop;
  exception when others then
    raise warning 'drafting notification skipped: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.docs_notify_drafting() from public, anon, authenticated;

drop trigger if exists e2_docs_notify_drafting on public.docs;
create trigger e2_docs_notify_drafting after insert or update on public.docs
  for each row execute function private.docs_notify_drafting();
