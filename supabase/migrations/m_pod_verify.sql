-- SLATE OS · POD leaders verify their POD members' project work (28 Oct 2026)
-- A POD member's deliverable, gate or project task on a POD project can be verified (or returned) by that project's POD leader,
-- as well as by the Principal or the COO. A POD leader's own work, studio work, Chalk Create work and private tasks are unchanged.
-- Run in Supabase › SQL Editor. Safe to run more than once.
do $mig$
declare d text;
  anchor text := $o$    vf_can := is_appr and not private.is_chalk_project(new.project_id) and new.assignee is distinct from uid
              and (tg_op = 'INSERT' or old.assignee is distinct from uid);$o$;
begin
  d := pg_get_functiondef('private.docs_guard'::regproc);
  if position('POD leader verifies' in d) = 0 then
    if position(anchor in d) = 0 then raise exception 'docs_guard has changed; update this migration'; end if;
    d := replace(d, anchor, anchor || $n$
    -- POD leader verifies a member's work on a project of their POD
    vf_can := vf_can or (tg_op = 'UPDATE' and rw.coll = 'tasks' and new.assignee is not null
              and new.assignee is distinct from uid and old.assignee is distinct from uid
              and private.leads_doc(new.project_id) and not private.is_chalk_project(new.project_id)
              and private.verify_cat(new.project_id, nd) in ('deliverable', 'gate', 'task')
              and not exists (select 1 from public.profiles a where a.id = new.assignee
                              and (coalesce(a.is_private, false) or a.designation in ('principal', 'coo')
                                   or (a.pod_id is not null and (a.designation = 'pod_leader' or a.is_manager)))));$n$);
    execute d;
  end if;
end $mig$;
