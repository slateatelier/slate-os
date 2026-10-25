-- SLATE OS · write rules (25 Oct 2026)
-- Adds to the existing guard:
--   * project members: a project's pod leader may only ask (status "pending", in their own name) or remove;
--     the COO / Principal approve. Approved members can be given the project's tasks directly.
--   * a task made from a Principal/COO message: the person who got the message may assign it to themselves,
--     or a team leader to their own team, with the date left as a proposal.
--   * weekly meeting: the week's organiser can hand the week to someone else (if unavailable) and can update
--     attendance at any time; only the rota organiser (or whoever it was handed to) writes that week's minutes.
create or replace function private.docs_guard()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  uid uuid := auth.uid();
  is_appr boolean; is_own boolean; is_lead boolean; is_asg boolean;
  rw public.docs := coalesce(new, old);
  od jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else old.data end;
  nd jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else new.data end;
  ch text[]; k text; ph text; pr public.profiles; my_pod_id text; is_dlead boolean; req_ok boolean; chalk boolean;
  cur_org text; mk text; mo jsonb; mn jsonb;
begin
  if uid is null then return coalesce(new, old); end if;
  if not private.is_active() then raise exception 'Your account is read-only'; end if;
  is_appr := private.is_approver(); is_own := private.is_owner();
  my_pod_id := (select pod_id from public.profiles where id = uid);
  is_dlead := private.my_designation() = 'design_associate_lead';
  req_ok := jsonb_typeof(nd->'assignReq') = 'object' and private.is_drafting_member(private.as_uuid(nd->'assignReq'->>'to'));
  ch := private.changed_keys(od, nd);

  -- Chalk Create: run by its lead and the Principal. The COO can view and edit, but never assigns Chalk work.
  if rw.coll in ('projects','tasks','pmeetings') and tg_op <> 'DELETE' then
    chalk := case when rw.coll = 'projects' then lower(trim(coalesce(nd->>'pod', ''))) = 'chalk create' or lower(trim(coalesce(od->>'pod', ''))) = 'chalk create'
                  else private.is_chalk_project(new.project_id) or (tg_op = 'UPDATE' and private.is_chalk_project(old.project_id)) end;
    if rw.coll = 'tasks' and new.assignee is not null and (tg_op = 'INSERT' or new.assignee is distinct from old.assignee) then
      if private.is_chalk_person(new.assignee) and not is_own and not (chalk and private.is_chalk_lead()) then
        raise exception 'Only the Principal and the Chalk Create lead assign work to Chalk Create';
      end if;
      if chalk and not is_own and not (private.is_chalk_person(new.assignee)
            or exists (select 1 from public.profiles x where x.id = new.assignee and x.is_chalk_lead)) then
        raise exception 'Chalk Create work goes to Chalk Create people';
      end if;
      if chalk and is_appr and not is_own and not private.is_chalk_lead() then
        raise exception 'Only the Principal and the Chalk Create lead assign Chalk work';
      end if;
    end if;
    if chalk then
      if rw.coll = 'projects' and tg_op = 'UPDATE' and not is_own
         and (lower(trim(coalesce(nd->>'pod', ''))) = 'chalk create') <> (lower(trim(coalesce(od->>'pod', ''))) = 'chalk create') then
        raise exception 'Only the Principal moves a project in or out of Chalk Create';
      end if;
      if rw.coll = 'tasks' and not private.history_appends(od->'history', nd->'history') then
        raise exception 'Task history is append-only';
      end if;
      if rw.coll = 'tasks' and tg_op = 'UPDATE' and not is_own then
        if coalesce(od->>'target', '') <> '' and (nd->'target', nd->'originalTarget', nd->'revisions') is distinct from (od->'target', od->'originalTarget', od->'revisions') then
          raise exception 'Only the Principal changes a Chalk date; send a date request instead';
        end if;
        if jsonb_typeof(od->'request') = 'object' and (nd->'request') is distinct from (od->'request')
           and not (coalesce(jsonb_typeof(nd->'request'), 'null') <> 'object' and od->'request'->>'by' = uid::text and (nd->'target') is not distinct from (od->'target'))
           and not (jsonb_typeof(nd->'request') = 'object' and od->'request'->>'by' = uid::text and nd->'request'->>'by' = uid::text) then
          raise exception 'Only the Principal approves or declines Chalk date requests';
        end if;
        if coalesce(od->>'target', '') = '' and coalesce(nd->>'target', '') <> '' and jsonb_typeof(od->'request') = 'object' then
          raise exception 'Only the Principal approves Chalk date requests';
        end if;
      end if;
      if is_own or is_appr or private.is_chalk_lead() then return new; end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    if is_own then return old; end if;
    if rw.coll in ('podnames','podreq') and (rw.parent = uid::text or is_appr) then return old; end if;
    if rw.coll = 'rolereq' and rw.parent = uid::text then return old; end if;
    if rw.coll in ('podjoin','types','tasklib','pmeetings','meetcfg') and is_appr then return old; end if;
    if rw.coll = 'tasklib' and old.created_by = uid and od->>'status' = 'pending' then return old; end if;
    if rw.coll = 'projects' and old.created_by = uid and od->>'status' in ('pending','declined') then return old; end if;
    if rw.coll = 'data' and rw.parent = uid::text then return old; end if;
    raise exception 'Only the Principal permanently deletes this — archive it instead';
  end if;

  if rw.coll in ('podnames','podreq') then
    if rw.parent = uid::text and (is_appr or private.is_pod_leader()) then return new; end if;
    raise exception 'Only pod leaders raise this request, in their own name';
  elsif rw.coll = 'podjoin' then
    if rw.parent = uid::text and is_appr then return new; end if;
    raise exception 'Only the COO decides pod moves';
  elsif rw.coll = 'rolereq' then
    if rw.parent = uid::text and is_appr then return new; end if;
    raise exception 'Only the COO proposes role changes';
  elsif rw.coll = 'agreements' then
    if is_appr or current_setting('slate.agreement_split', true) = '1' then return new; end if;
    raise exception 'Agreement details are for the Principal and the COO only';
  elsif rw.coll = 'farlog' then
    if rw.parent = uid::text and tg_op = 'INSERT' then return new; end if;
    raise exception 'FAR runs are logged once, by the person who ran them';
  elsif rw.coll = 'data' then
    if rw.parent = uid::text then return new; end if;
    raise exception 'Not your notifications';
  elsif rw.coll = 'members' then
    raise exception 'Profiles are edited through the people settings';
  end if;

  if rw.coll in ('config','meetcfg','types') then
    if is_appr then return new; end if;
    raise exception 'Only the Principal or COO edits studio settings';
  end if;
  if rw.coll = 'tasklib' then
    if is_appr then return new; end if;
    if private.is_pod_leader() and nd->>'status' = 'pending'
       and (tg_op = 'INSERT' or (old.created_by = uid and od->>'status' = 'pending')) then return new; end if;
    raise exception 'Pod leaders request standard-task changes; the COO approves them';
  end if;

  if rw.coll = 'meetings' then
    if is_appr then return new; end if;
    -- a save to an existing week arrives as insert-then-update; the update pass checks it against the saved copy
    if tg_op = 'INSERT' and exists (select 1 from public.docs x where x.path = new.path) then return new; end if;
    cur_org := coalesce(nullif(od->>'organiser', ''), private.rota_organiser(rw.doc_id));
    -- the week's organiser updates who attended, at any stage
    if cur_org = uid::text and ch <@ array['attendees','attendanceAt','attendanceBy','updatedAt','updatedBy','date'] then
      return new;
    end if;
    -- the week's organiser hands the week to someone else when unavailable
    if cur_org = uid::text and coalesce(nd->>'organiser', '') not in ('', uid::text)
       and ch <@ array['organiser','handover','date','updatedAt','updatedBy']
       and coalesce(od->>'status', 'draft') not in ('submitted','published') then
      return new;
    end if;
    if coalesce(od->>'status', 'draft') in ('submitted','published') then
      raise exception 'These minutes are with the COO; they can be changed only if returned';
    end if;
    if coalesce(nd->>'organiser', '') <> uid::text or coalesce(cur_org, '') <> uid::text then
      raise exception 'Only this week''s organiser writes the minutes';
    end if;
    if coalesce(nd->>'status', 'draft') not in ('draft','submitted')
       and not (nd->>'status' = 'returned' and od->>'status' = 'returned') then
      raise exception 'Only the COO approves, publishes or returns minutes';
    end if;
    if coalesce(nd->>'publishedAt', '') is distinct from coalesce(od->>'publishedAt', '')
       or coalesce(nd->>'approvedBy', '') is distinct from coalesce(od->>'approvedBy', '') then
      raise exception 'Only the COO approves or publishes minutes';
    end if;
    return new;
  end if;

  if rw.coll = 'pmeetings' then
    if is_appr then return new; end if;
    if not private.can_see_project_doc(new.project_id) then
      raise exception 'Not one of your projects';
    end if;
    if tg_op = 'UPDATE' and od->>'status' = 'final' and not private.leads_doc(old.project_id) then
      raise exception 'Final minutes can be changed only by the pod leader or the COO';
    end if;
    if coalesce(nd->>'sentAt', '') is distinct from coalesce(od->>'sentAt', '') and not private.leads_doc(new.project_id) then
      raise exception 'Only the pod leader or the COO marks minutes as sent';
    end if;
    if (nd->'extra'->>'status') is distinct from (od->'extra'->>'status') and nd->'extra'->>'status' in ('approved','declined') then
      raise exception 'Only the COO decides extra-meeting requests';
    end if;
    return new;
  end if;

  if rw.coll = 'projects' then
    if is_appr then return new; end if;
    if tg_op = 'INSERT' then
      if private.is_pod_leader() and nd->>'status' = 'pending' and nd->>'pod' = my_pod_id then return new; end if;
      raise exception 'Pod leaders request new projects for their own pod; the COO approves them';
    end if;
    if old.created_by = uid and od->>'status' = 'pending' and nd->>'status' = 'pending' then return new; end if;
    is_lead := private.leads_doc(rw.doc_id);
    foreach k in array ch loop
      if k = 'cl' then
        if not (is_lead or private.has_pod_view_doc(rw.doc_id)) then raise exception 'Not your project''s checklist'; end if;
      elsif k = 'members' then
        if not is_lead then raise exception 'Only the project''s pod leader asks to add people; the COO approves them'; end if;
        for mk in select x from jsonb_object_keys(case when jsonb_typeof(nd->'members') = 'object' then nd->'members' else '{}'::jsonb end) x
                  union select x from jsonb_object_keys(case when jsonb_typeof(od->'members') = 'object' then od->'members' else '{}'::jsonb end) x loop
          mo := case when jsonb_typeof(od->'members'->mk) = 'object' then od->'members'->mk end;
          mn := case when jsonb_typeof(nd->'members'->mk) = 'object' then nd->'members'->mk end;
          if mo is not distinct from mn or mn is null then continue; end if;   -- unchanged, or removed
          if mn->>'status' <> 'pending' or mn->>'by' is distinct from uid::text then
            raise exception 'Adding someone to a project needs the COO''s approval; send it as a request';
          end if;
        end loop;
      elsif k = 'phases' then
        if not is_lead then raise exception 'Only the project''s pod leader proposes phase dates'; end if;
        for ph in select x from jsonb_object_keys(coalesce(nd->'phases','{}')) x
                  union select x from jsonb_object_keys(coalesce(od->'phases','{}')) x loop
          if exists (select 1 from unnest(private.changed_keys(od->'phases'->ph, nd->'phases'->ph)) c
                     where c not in ('req','history')) then
            raise exception 'Phase dates are approved by the COO; send a request instead';
          end if;
        end loop;
      elsif k = 'std' and not is_lead and private.has_pod_view_doc(rw.doc_id)
            and private.changed_keys(od->'std', nd->'std') <@ array['fbGot'] then
        null;
      elsif k = 'std' then
        if not is_lead then raise exception 'Only the project''s pod leader sets up phases'; end if;
        if jsonb_typeof(od->'std') = 'object' and (nd->'std'->'pace') is distinct from (od->'std'->'pace') then
          raise exception 'Only the Principal or COO changes a project''s pace';
        end if;
      elsif k = 'type' then
        if not (is_lead and coalesce(od->>'type', '') = '') then raise exception 'Only the Principal or COO changes a project''s type'; end if;
      else
        raise exception 'Only the Principal or COO edits project details (%)', k;
      end if;
    end loop;
    if 'cl' = any(ch) and not is_lead then
      if exists (
        select 1 from jsonb_each(coalesce(nd->'cl','{}')) pk(phk, items), jsonb_each(items) it(itid, v)
        where (od->'cl'->phk->itid) is distinct from v
          and coalesce(od->'cl'->phk->itid->>'who', v->>'who', '') <> uid::text) then
        raise exception 'You can tick only checklist items assigned to you';
      end if;
    end if;
    return new;
  end if;

  if rw.coll in ('tasks','lead') then
    if not private.history_appends(od->'history', nd->'history') then
      raise exception 'Task history is append-only';
    end if;
    if new.assignee is not null then select * into pr from public.profiles where id = new.assignee; end if;
    if rw.coll = 'tasks' and coalesce(pr.is_private, false) then
      raise exception 'Tasks for this person are private; only the Principal assigns them';
    end if;
    if rw.coll = 'lead' then
      if tg_op = 'INSERT' then
        if is_own and new.assignee::text = rw.parent then return new; end if;
        if new.assignee = uid and private.is_series_next(rw.coll, rw.parent, new.project_id, new.assignee, nd) then return new; end if;
        raise exception 'Only the Principal creates private tasks';
      end if;
      if is_own then return new; end if;
      if old.assignee = uid then
        if 'archived' = any(ch) and not (old.created_by = uid and coalesce(od->>'repeat', '') <> '' and (nd->>'archived')::boolean) then
          raise exception 'Only the Principal archives this task';
        end if;
        if exists (select 1 from unnest(ch) c where c not in ('doneAt','doneBy','stage','request','history','nextId','revCount','archived')) then
          raise exception 'You can mark this done or ask for a new date; the Principal changes the rest';
        end if;
        return new;
      end if;
      raise exception 'Private task';
    end if;

    is_lead := private.leads_doc(coalesce(new.project_id, old.project_id));
    if new.assignee is not null and pr.designation = 'principal' and not is_appr then
      raise exception 'Only the Principal or COO assigns work to the Principal';
    end if;

    if tg_op = 'INSERT' then
      if is_appr then return new; end if;
      if private.is_series_next(rw.coll, rw.parent, new.project_id, new.assignee, nd) then return new; end if;
      if private.is_revision_child(new.project_id, new.assignee, nd) then return new; end if;
      -- a task made from a Principal/COO message: to yourself, or a team leader to their own team
      if coalesce(nd->>'fromMsg', '') ~ '^\d+$' and new.assignee is not null
         and coalesce(nd->>'target', '') = '' and coalesce(nd->>'doneAt', '') = ''
         and exists (select 1 from public.notifications m where m.id = (nd->>'fromMsg')::bigint and m.user_id = uid and m.kind = 'message')
         and (new.project_id is null or private.can_see_project_doc(new.project_id))
         and (new.assignee = uid
              or (private.is_pod_leader() and pr.pod_id = my_pod_id and pr.designation not in ('principal','coo'))
              or (is_dlead and private.is_drafting_member(new.assignee))) then
        return new;
      end if;
      if is_dlead then
        if new.assignee is null and req_ok and coalesce(nd->>'target', '') = '' and coalesce(nd->>'doneAt', '') = ''
           and exists (select 1 from public.docs p where p.path = 'projects/' || new.project_id and coalesce(p.data->>'status', 'active') = 'active') then
          return new;
        end if;
        raise exception 'Drafting work goes to the COO for approval: choose a drafting-pool member and leave the date as a proposal';
      end if;
      if not is_lead then raise exception 'Only the Principal, COO or the project''s pod leader creates tasks'; end if;
      if coalesce(nd->>'target', '') <> '' then raise exception 'Pod leaders propose target dates; the COO approves them'; end if;
      if coalesce(nd->>'doneAt', '') <> '' then raise exception 'New tasks start open'; end if;
      if new.assignee is not null and (pr.pod_id is distinct from my_pod_id or pr.designation in ('principal','coo'))
         and not private.member_ok(new.project_id, new.assignee) then
        raise exception 'Assign your own pod or the project''s approved members; anyone else goes through a COO-approved request';
      end if;
      return new;
    end if;

    if is_appr then return new; end if;
    is_asg := old.assignee = uid;
    foreach k in array ch loop
      if k = 'history' then continue;
      elsif k in ('target','originalTarget','revisions') then
        raise exception 'Target dates change only when the COO approves a request';
      elsif k = 'assignReq' and is_dlead and (jsonb_typeof(nd->'assignReq') <> 'object' or req_ok)
            and (private.is_drafting_member(old.assignee) or old.created_by = uid) then
        null;
      elsif k in ('assignee','assignReq') then
        if not is_lead then raise exception 'Only the pod leader or COO reassigns tasks'; end if;
        if k = 'assignee' and new.assignee is not null
           and (pr.pod_id is distinct from my_pod_id or pr.designation in ('principal','coo'))
           and not private.member_ok(new.project_id, new.assignee) then
          raise exception 'Reassign within your pod or the project''s approved members; other assignments need COO approval';
        end if;
      elsif k = 'request' and is_dlead and (private.is_drafting_member(old.assignee) or old.created_by = uid) then
        null;
      elsif k in ('doneAt','doneBy','stage','request','nextId','revCount') then
        if not (is_lead or coalesce(is_asg, false)) then raise exception 'Only the assignee, their pod leader or the COO updates this task'; end if;
      elsif k = 'archived' and coalesce(is_asg, false) and old.created_by = uid
            and coalesce(od->>'repeat', '') <> '' and (nd->>'archived')::boolean then
        null;
      else
        if not is_lead then raise exception 'Only the pod leader or COO edits this task (%)', k; end if;
      end if;
    end loop;
    return new;
  end if;

  raise exception 'Not allowed';
end $function$;
