-- SLATE OS · permanent task IDs.
-- Every task gets a number within its project, assigned here so two people saving at once never collide:
--   shown as <project code>-T07. Client revisions take their task's number plus R<revision>, e.g. -T07.R1.
--   Private tasks (lead/…) run their own series, shown as -P01, so the team's numbers show no gaps.
-- The number never changes on edits; it changes only if a task is moved to another project.
-- Runs before every other docs trigger, so existing permission checks see the number as unchanged.

create or replace function private.docs_task_seq()
returns trigger language plpgsql security definer set search_path to '' as $$
declare n int; pid text := coalesce(new.data->>'projectId', '');
begin
  if new.coll not in ('tasks', 'lead') then return new; end if;
  if coalesce(new.data->>'parentId', '') <> '' then              -- revisions use their task's number
    new.data := new.data - 'seq';
    return new;
  end if;
  if tg_op = 'UPDATE' and old.data ? 'seq' and pid = coalesce(old.data->>'projectId', '') then
    new.data := jsonb_set(new.data, '{seq}', old.data->'seq');   -- the number is permanent
    return new;
  end if;
  if tg_op = 'UPDATE' and not (old.data ? 'seq') and new.data ? 'seq' and auth.uid() is null then
    return new;                                                  -- one-time numbering of existing tasks
  end if;
  perform pg_advisory_xact_lock(hashtext('slate-task-seq:' || new.coll || ':' || pid));
  select coalesce(max((d.data->>'seq')::int), 0) + 1 into n
    from public.docs d where d.coll = new.coll and coalesce(d.data->>'projectId', '') = pid and d.path <> new.path and d.data ? 'seq';
  new.data := new.data || jsonb_build_object('seq', n);
  return new;
end $$;

drop trigger if exists a00_docs_task_seq on public.docs;
create trigger a00_docs_task_seq before insert or update on public.docs for each row execute function private.docs_task_seq();

-- number the tasks that already exist, oldest first within each project (recorded in the activity log)
with ranked as (
  select path, row_number() over (partition by coll, coalesce(data->>'projectId', '') order by created_at, path) as n
  from public.docs
  where coll in ('tasks', 'lead') and coalesce(data->>'parentId', '') = '' and not (data ? 'seq')
)
update public.docs d set data = d.data || jsonb_build_object('seq', r.n)
from ranked r where d.path = r.path;
