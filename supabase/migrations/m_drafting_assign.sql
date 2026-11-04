-- POD leaders give work to the Drafting Pool directly (Principal, 4 Nov 2026)
-- Before: a POD leader giving a task to a Drafting Pool member sent an assignment request that waited for the COO,
-- and none were ever approved: the Design Associates had no tasks at all.
-- Now:
-- 1. The project's POD leader creates a task for, or reassigns a task to, any Drafting Pool member (no request).
--    Dates follow the usual rule (the POD leader proposes, the COO approves, except in the setup window).
-- 2. The POD leader checks that work when the drafter sends it (as for the POD's own members' everyday tasks).
-- 3. The Design Associate Lead and the COO are told in SLATE OS (the app's notifications); they don't approve.
-- The guard is patched in place from its live definition. One transaction: if a patch doesn't match, nothing changes.

begin;

create or replace function private.da_patch(src text, a text, b text) returns text
language plpgsql as $$
begin
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then
    raise exception 'Drafting patch: expected exactly one match for: %', left(a, 120);
  end if;
  return replace(src, a, b);
end $$;

do $mig$
declare src text := pg_get_functiondef('private.docs_guard'::regproc);
begin
  if position('da_drafting_assign' in src) > 0 then return; end if;   -- already patched

  -- 1a. a new task for a drafter, from the project's POD leader
  src := private.da_patch(src,
$a$      if new.assignee is not null and (pr.pod_id is distinct from my_pod_id or pr.designation in ('principal','coo'))
         and not private.member_ok(new.project_id, new.assignee) then
        raise exception 'Assign your own pod or the project''s approved members; anyone else goes through a COO-approved request';$a$,
$b$      if new.assignee is not null and (pr.pod_id is distinct from my_pod_id or pr.designation in ('principal','coo'))
         and not private.member_ok(new.project_id, new.assignee)
         and not private.is_drafting_member(new.assignee) /* da_drafting_assign */ then
        raise exception 'Assign your own pod or the project''s approved members; anyone else goes through a COO-approved request';$b$);

  -- 1b. an existing task handed to a drafter by the project's POD leader
  src := private.da_patch(src,
$a$           and not private.member_ok(new.project_id, new.assignee) then
          raise exception 'Reassign within your pod or the project''s approved members; other assignments need COO approval';$a$,
$b$           and not private.member_ok(new.project_id, new.assignee)
           and not private.is_drafting_member(new.assignee) then
          raise exception 'Reassign within your pod or the project''s approved members; other assignments need COO approval';$b$);

  -- 2. the POD leader checks the drafter's everyday task on the POD's project
  src := private.da_patch(src,
$a$               and exists (select 1 from public.profiles a where a.id = new.assignee and a.pod_id is not distinct from my_pod_id));$a$,
$b$               and exists (select 1 from public.profiles a where a.id = new.assignee
                           and (a.pod_id is not distinct from my_pod_id or private.is_drafting_member(a.id))));$b$);

  execute src;
end $mig$;

drop function private.da_patch(text, text, text);

-- switch it on in the app (Settings flag the app reads)
update public.docs set data = jsonb_set(coalesce(data, '{}'::jsonb), '{draftDirect}', 'true'::jsonb) where path = 'config/settings';

commit;
