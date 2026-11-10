-- Shared architects (10 Nov 2026): the COO and the mentor are told whenever a POD leader gives a shared
-- architect work (new task or reassigned), so the COO knows and can step in; nothing waits for her.
create or replace function private.docs_notify_shared() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  aname text := coalesce(private.person_name(auth.uid()), 'SLATE OS');
  who text; ttl text; body text; r record;
begin
  begin
    if new.coll <> 'tasks' or new.assignee is null or new.is_private then return null; end if;
    if tg_op = 'UPDATE' and new.assignee is not distinct from old.assignee then return null; end if;
    if not private.is_shared_member(new.assignee) then return null; end if;
    who := coalesce(private.person_name(new.assignee), 'A shared architect');
    ttl := coalesce(nullif(new.data->>'title', ''), 'A task');
    body := concat_ws(E'\n', who || ' · “' || ttl || '”', private.project_line(new.project_id),
      coalesce('Due ' || private.fmt_d(new.data->>'target'),
        case when jsonb_typeof(new.data->'request') = 'object' then 'Proposed ' || private.fmt_d(new.data->'request'->>'date') else 'No date yet' end));
    for r in select p.id from public.profiles p
              where p.active and (p.designation = 'coo'
                     or p.id = (select m.mentor_id from public.profiles m where m.id = new.assignee))
                and p.id is distinct from actor and p.id <> new.assignee loop
      perform private.notify(r.id, 'shared_assigned', 'Shared architect: work from ' || aname, body);
    end loop;
  exception when others then
    raise warning 'shared notification skipped: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists e3_docs_notify_shared on public.docs;
create trigger e3_docs_notify_shared after insert or update on public.docs
  for each row execute function private.docs_notify_shared();
