-- Completion verification (27 Oct 2026)
-- Work marked done by anyone other than the Principal or the COO goes to them to verify.
-- The task carries `verify: {at, by, ts, note}` while it waits; the Principal or COO either
-- verifies it (doneAt = the submitted date, so scoring is by when the work was finished)
-- or returns it with a note (`lastReturn`). Each task category can be switched off by the
-- Principal in Settings (config/settings → verify). Chalk Create work is verified by the
-- Principal; the COO's own tasks are verified by the Principal.

-- Which category a task falls in. The first that fits wins (same order as the app).
create or replace function private.verify_cat(p_project text, nd jsonb)
returns text language sql stable security definer set search_path to '' as $$
  select case
    when private.is_chalk_project(p_project) then 'chalk'
    when coalesce(nd->>'repeat', '') <> '' then 'repeat'
    when p_project is null or not exists (
      select 1 from public.docs p where p.path = 'projects/' || p_project
        and coalesce(p.data->>'pod', '') not in ('', 'Studio')) then 'studio'
    when jsonb_typeof(nd->'gate') = 'object' then 'gate'
    when nd->>'kind' = 'Deliverable' then 'deliverable'
    else 'task' end
$$;

-- Whether verification is on for a category. Missing settings mean on.
create or replace function private.verify_on(p_cat text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((
    select case when s.data->'verify'->>'on' = 'false' then false
                else coalesce(s.data->'verify'->>p_cat, 'true') <> 'false' end
    from public.docs s where s.path = 'config/settings'), true)
$$;

revoke all on function private.verify_cat(text, jsonb) from public, anon;
revoke all on function private.verify_on(text) from public, anon;

do $mig$
declare f text; b text;
begin
  ---------------------------------------------------------------- docs_guard
  f := pg_get_functiondef('private.docs_guard()'::regprocedure);
  if position('vf_can' in f) = 0 then
    b := f; f := replace(f, 'cur_org text; mk text; mo jsonb; mn jsonb;', 'cur_org text; mk text; mo jsonb; mn jsonb; vf_can boolean;');
    if f = b then raise exception 'docs_guard: declare anchor missing'; end if;

    b := f; f := replace(f, E'  ch := private.changed_keys(od, nd);\n', E'  ch := private.changed_keys(od, nd);\n' || $blk$
  -- completion verification: only the Principal or the COO completes work (the COO not her own, nor Chalk work)
  if rw.coll in ('tasks','lead') and tg_op <> 'DELETE' and not is_own then
    vf_can := is_appr and not private.is_chalk_project(new.project_id) and new.assignee is distinct from uid
              and (tg_op = 'INSERT' or old.assignee is distinct from uid);
    if not vf_can then
      if (nd->'verifiedBy', nd->'verifiedAt', nd->'lastReturn') is distinct from (od->'verifiedBy', od->'verifiedAt', od->'lastReturn') then
        raise exception 'Only the Principal or the COO verifies or returns completed work';
      end if;
      if coalesce(nd->>'doneAt', '') <> '' and coalesce(od->>'doneAt', '') = ''
         and not (coalesce((nd->>'legacy')::boolean, false) and nd->>'doneAt' < private.go_live())
         and private.verify_on(private.verify_cat(new.project_id, nd)) then
        raise exception 'Completed work goes to the Principal or the COO to verify. Send it for verification';
      end if;
      if coalesce(od->>'verifiedBy', '') <> '' and (nd->>'doneAt') is distinct from (od->>'doneAt') then
        raise exception 'Verified work is reopened or corrected only by the Principal or the COO';
      end if;
      if (nd->'verify') is distinct from (od->'verify') then
        if jsonb_typeof(nd->'verify') = 'object' and (nd->'verify'->>'by') is distinct from uid::text then
          raise exception 'Send work for verification in your own name';
        end if;
        if jsonb_typeof(od->'verify') = 'object' and (od->'verify'->>'by') is distinct from uid::text then
          raise exception 'Only the Principal or the COO verifies or returns this work';
        end if;
      end if;
    end if;
  end if;
  -- the verification switches in Settings are the Principal's
  if rw.coll = 'config' and tg_op <> 'DELETE' and not is_own and (nd->'verify') is distinct from (od->'verify') then
    raise exception 'Only the Principal changes completion verification';
  end if;
$blk$);
    if f = b then raise exception 'docs_guard: changed_keys anchor missing'; end if;

    b := f; f := replace(f, $a$c not in ('doneAt','doneBy','stage','request','history','nextId','revCount','archived')$a$,
                            $a$c not in ('doneAt','doneBy','stage','request','history','nextId','revCount','archived','verify')$a$);
    if f = b then raise exception 'docs_guard: lead keys anchor missing'; end if;

    b := f; f := replace(f, $a$elsif k in ('doneAt','doneBy','stage','request','nextId','revCount') then$a$,
                            $a$elsif k in ('doneAt','doneBy','stage','request','nextId','revCount','verify') then$a$);
    if f = b then raise exception 'docs_guard: task keys anchor missing'; end if;
    execute f;
  end if;

  ---------------------------------------------------------------- docs_notify
  f := pg_get_functiondef('private.docs_notify()'::regprocedure);
  if position('verify_request' in f) = 0 then
    b := f; f := replace(f, E'    -- assignment decided: tell whoever asked\n', $blk$    -- completed work sent for verification
    if jsonb_typeof(nd->'verify') = 'object' and (od->'verify'->>'ts') is distinct from (nd->'verify'->>'ts') then
      perform private.notify_route(new.project_id, 'verify_request', 'Completed work to verify · ' || actor,
        concat_ws(E'\n', ttl, proj,
          'Done ' || coalesce(private.fmt_d(nd->'verify'->>'at'), '') || coalesce(' · due ' || private.fmt_d(nd->>'target'), '')
          || coalesce(' · ' || nullif(trim(coalesce(nd->'verify'->>'note', '')), ''), '')), priv);
    end if;
    -- verification decided: tell whoever sent it (a withdrawal by the sender says nothing)
    if jsonb_typeof(od->'verify') = 'object' and coalesce(jsonb_typeof(nd->'verify'), 'null') <> 'object' then
      asked := private.as_uuid(od->'verify'->>'by');
      if coalesce(nd->>'doneAt', '') <> '' then
        body := concat_ws(E'\n', ttl, proj, 'Completed ' || coalesce(private.fmt_d(nd->>'doneAt'), ''));
        perform private.notify(coalesce(new.assignee, asked), 'task_verified', 'Verified by ' || actor, body);
        if asked is distinct from new.assignee then perform private.notify(asked, 'task_verified', 'Verified by ' || actor, body); end if;
      elsif jsonb_typeof(nd->'lastReturn') = 'object' and (nd->'lastReturn') is distinct from (od->'lastReturn') then
        note := nullif(trim(coalesce(nd->'lastReturn'->>'note', '')), '');
        body := concat_ws(E'\n', ttl, proj, coalesce('“' || note || '”', 'Reopened; send it again when it’s ready'));
        perform private.notify(asked, 'task_returned', 'Returned by ' || actor, body);
        if new.assignee is distinct from asked then perform private.notify(new.assignee, 'task_returned', 'Returned by ' || actor, body); end if;
      end if;
    end if;
    -- assignment decided: tell whoever asked
$blk$);
    if f = b then raise exception 'docs_notify: anchor missing'; end if;
    execute f;
  end if;
end $mig$;
