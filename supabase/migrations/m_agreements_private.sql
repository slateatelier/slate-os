-- Agreement details (status, date, reference, document link) leave the shared project record.
-- They live in agreements/<projectId>, readable and writable only by the Principal and the COO.
-- A trigger moves them out of every project write, so no client or pod leader can put them back.

-- 1. new collection
do $do$
declare def text;
begin
  def := pg_get_functiondef('private.docs_derive'::regproc);
  if position('''agreements''' in def) = 0 then
    def := replace(def, $a$'types','podnames','podreq','podjoin','rolereq','farlog','data')$a$, $b$'types','podnames','podreq','podjoin','rolereq','farlog','data','agreements')$b$);
    def := replace(def, $a$new.project_id := case when new.coll = 'projects' then new.doc_id$a$, $b$new.project_id := case when new.coll in ('projects','agreements') then new.doc_id$b$);
    if position('''agreements''' in def) = 0 then raise exception 'docs_derive anchor not found'; end if;
    execute def;
  end if;

  -- 2. write rule: only the Principal or COO (or the split trigger below)
  def := pg_get_functiondef('private.docs_guard'::regproc);
  if position('Agreement details are for the Principal' in def) = 0 then
    def := replace(def, $a$  elsif rw.coll = 'farlog' then$a$, $b$  elsif rw.coll = 'agreements' then
    if is_appr or current_setting('slate.agreement_split', true) = '1' then return new; end if;
    raise exception 'Agreement details are for the Principal and the COO only';
  elsif rw.coll = 'farlog' then$b$);
    if position('Agreement details are for the Principal' in def) = 0 then raise exception 'docs_guard anchor not found'; end if;
    execute def;
  end if;

  -- 3. the log entry of an agreement change is not tied to the project, so pod leaders never see it
  def := pg_get_functiondef('private.docs_log'::regproc);
  if position('agreements' in def) = 0 then
    def := replace(def, $a$values (auth.uid(), rw.coll, rw.path, lower(tg_op), rw.project_id,$a$, $b$values (auth.uid(), rw.coll, rw.path, lower(tg_op), case when rw.coll = 'agreements' then null else rw.project_id end,$b$);
    if position('agreements' in def) = 0 then raise exception 'docs_log anchor not found'; end if;
    execute def;
  end if;
end $do$;

-- 4. read and update rules on the document store
alter policy docs_select on public.docs using (
CASE coll
    WHEN 'tasks'::text THEN (private.can_see_task_doc(false, assignee, project_id) OR (created_by = ( SELECT auth.uid() AS uid)) OR ((( SELECT private.my_designation() AS my_designation) = 'design_associate_lead'::designation) AND private.is_drafting_member(private.as_uuid(((data -> 'assignReq'::text) ->> 'to'::text)))))
    WHEN 'lead'::text THEN private.can_see_task_doc(true, assignee, project_id)
    WHEN 'projects'::text THEN (private.can_see_project_doc(doc_id) OR (created_by = ( SELECT auth.uid() AS uid)))
    WHEN 'pmeetings'::text THEN private.can_see_project_doc(project_id)
    WHEN 'farlog'::text THEN ((parent = (( SELECT auth.uid() AS uid))::text) OR ( SELECT private.is_approver() AS is_approver))
    WHEN 'data'::text THEN (parent = (( SELECT auth.uid() AS uid))::text)
    WHEN 'rolereq'::text THEN ( SELECT private.is_approver() AS is_approver)
    WHEN 'podreq'::text THEN ((parent = (( SELECT auth.uid() AS uid))::text) OR ( SELECT private.is_approver() AS is_approver))
    WHEN 'agreements'::text THEN ( SELECT private.is_approver() AS is_approver)
    ELSE true
END);
alter policy docs_update on public.docs using (
CASE coll
    WHEN 'tasks'::text THEN (private.can_see_task_doc(false, assignee, project_id) OR (created_by = ( SELECT auth.uid() AS uid)) OR ((( SELECT private.my_designation() AS my_designation) = 'design_associate_lead'::designation) AND private.is_drafting_member(private.as_uuid(((data -> 'assignReq'::text) ->> 'to'::text)))))
    WHEN 'lead'::text THEN private.can_see_task_doc(true, assignee, project_id)
    WHEN 'projects'::text THEN (private.can_see_project_doc(doc_id) OR (created_by = ( SELECT auth.uid() AS uid)))
    WHEN 'pmeetings'::text THEN private.can_see_project_doc(project_id)
    WHEN 'agreements'::text THEN ( SELECT private.is_approver() AS is_approver)
    ELSE true
END);

-- 5. every project write: move agreement fields into agreements/<id>
create or replace function private.docs_split_agreement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ks text[] := array['agStatus','agDate','agRef','docUrl']; part jsonb; id text;
begin
  if new.path !~ '^projects/[^/]+$' or not (new.data ?| ks) then return new; end if;
  id := split_part(new.path, '/', 2);
  select coalesce(jsonb_object_agg(k, new.data->k), '{}'::jsonb) into part from unnest(ks) k where new.data ? k;
  new.data := new.data - ks;
  perform set_config('slate.agreement_split', '1', true);
  insert into public.docs (path, coll, doc_id, data) values ('agreements/' || id, '', '', part)
  on conflict (path) do update set data = public.docs.data || excluded.data;
  perform set_config('slate.agreement_split', '', true);
  return new;
end $$;
create or replace trigger a1_docs_split_agreement before insert or update on public.docs
  for each row execute function private.docs_split_agreement();

-- 6. existing projects: move what is there now
update public.docs set data = data where coll = 'projects' and data ?| array['agStatus','agDate','agRef','docUrl'];

-- 7. earlier audit copies of projects: keep the history, drop the agreement fields
update public.activity_log
   set before = case when before is not null then before - array['agStatus','agDate','agRef','docUrl'] end,
       after  = case when after  is not null then after  - array['agStatus','agDate','agRef','docUrl'] end
 where table_name = 'projects'
   and (coalesce(before, '{}'::jsonb) ?| array['agStatus','agDate','agRef','docUrl']
        or coalesce(after, '{}'::jsonb) ?| array['agStatus','agDate','agRef','docUrl']);
