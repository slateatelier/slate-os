-- SLATE OS · SLATE standard process, Version 1 (30 Oct 2026): consultants sign off the frozen set within the design freeze.
-- New checklist item 3-n4 "From the consultants: structural and MEP sign-off of the frozen set". On a project whose design freeze
-- is already signed it is marked not applicable; on open ones it goes to the project's POD leader. Applied by Claude on 30 Oct 2026;
-- safe to run again.
do $mig$
declare p record; cl jsonb; ph jsonb; n int := 0; done boolean;
begin
  for p in select path, doc_id, data from public.docs where coll = 'projects' and data ? 'std' and data->'std'->'phases' ? '3' loop
    cl := coalesce(p.data->'cl', '{}'::jsonb); ph := coalesce(cl->'3', '{}'::jsonb);
    if ph ? '3-n4' then continue; end if;
    done := exists (select 1 from public.docs t where t.coll in ('tasks','lead') and t.project_id = p.doc_id
                    and t.data->'gate'->>'k' = '3' and t.data->'gate'->>'step' = 'final' and coalesce(t.data->>'doneAt','') <> '');
    ph := ph || jsonb_build_object('3-n4', case when done or coalesce(p.data->>'closed','false') = 'true' then '{"na":true,"v1c":true}'::jsonb
                                               else jsonb_build_object('who', p.data->'std'->>'lead') end);
    update public.docs set data = jsonb_set(data, '{cl}', jsonb_set(cl, '{3}', ph)), updated_at = now() where path = p.path;
    n := n + 1;
  end loop;
  raise notice '3-n4 added: %', n;
end $mig$;
