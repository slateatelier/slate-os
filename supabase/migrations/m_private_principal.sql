-- SLATE OS · Principal's and COO's tasks hidden from everyone else.
-- Both are private people: their tasks live under lead/<id>/tasks. The Principal and the COO see and manage
-- each other's private tasks; nobody else sees them (not pod leads, not project members, not the dashboard).

create or replace function private.is_coo()
returns boolean language sql stable security definer set search_path to ''
as $$ select exists (select 1 from public.profiles where id = auth.uid() and designation = 'coo' and active) $$;

create or replace function private.can_see_task_doc(p_private boolean, p_assignee uuid, pid text)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select case
    when p_private then private.is_owner() or private.is_coo() or p_assignee = auth.uid()
    else private.is_approver()
      or p_assignee = auth.uid()
      or private.has_pod_view_doc(pid, p_assignee)
      or private.member_ok(pid, auth.uid())
      or (private.my_designation() = 'design_associate_lead'
          and exists (select 1 from public.profiles a where a.id = p_assignee and a.designation = 'design_associate'))
      or (private.is_chalk_lead() and private.is_chalk_project(pid))
  end
$function$;

-- the COO creates and edits private tasks the way the Principal does
do $mig$
declare d text := pg_get_functiondef('private.docs_guard'::regproc);
  o text := '        if is_own and new.assignee::text = rw.parent then return new; end if;
        if new.assignee = uid and private.is_series_next(rw.coll, rw.parent, new.project_id, new.assignee, nd) then return new; end if;
        raise exception ''Only the Principal creates private tasks'';
      end if;
      if is_own then return new; end if;';
  n text := '        if (is_own or private.is_coo()) and new.assignee::text = rw.parent then return new; end if;
        if new.assignee = uid and private.is_series_next(rw.coll, rw.parent, new.project_id, new.assignee, nd) then return new; end if;
        raise exception ''Only the Principal or COO creates private tasks'';
      end if;
      if is_own or private.is_coo() then return new; end if;';
begin
  if position(o in d) = 0 then raise exception 'pattern not found'; end if;
  execute replace(d, o, n);
end $mig$;

-- the Principal becomes private; existing tasks move to the private store
update public.profiles set is_private = true where designation = 'principal';
update public.docs set path = 'lead/' || assignee::text || '/tasks/' || doc_id
 where coll = 'tasks' and assignee in (select id from public.profiles where designation = 'principal');
