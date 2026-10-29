-- SLATE OS · SLATE standard process v1.3 (29 Oct 2026): the consultant clock (R8)
-- New checklist items where SLATE waits for the structural and MEP consultants: phase 2 (2-n6), 3R (3r-n5), phase 4 (4-n9 MEP
-- authority drawings, 4-n10 combined set checked), WD-1 (6-n7) and WD-2 (7-n11). On a phase whose gate is already closed they are
-- marked not applicable; on open phases they stay open as work to do. Land share projects do STR/MEP work at 3R, so 2-n6 is
-- not applicable for them.
-- Run in Supabase › SQL Editor after m_standard_v12.sql. Safe to run more than once.
do $mig$
declare
  nw jsonb := '{"2":["2-n6"],"3r":["3r-n5"],"4":["4-n9","4-n10"],"6":["6-n7"],"7":["7-n11"]}';
  p record; k text; id text; cl jsonb; ph jsonb; n int := 0;
begin
  for p in select path, doc_id, data from public.docs where coll = 'projects' and data ? 'std' loop
    cl := coalesce(p.data->'cl', '{}'::jsonb);
    for k in select jsonb_array_elements_text(p.data->'std'->'phases') loop
      if not (nw ? k) then continue; end if;
      if not exists (select 1 from public.docs t where t.coll in ('tasks','lead') and t.project_id = p.doc_id
                     and t.data->'gate'->>'k' = k and t.data->'gate'->>'step' = 'final' and coalesce(t.data->>'doneAt','') <> '') then continue; end if;
      ph := coalesce(cl->k, '{}'::jsonb);
      for id in select jsonb_array_elements_text(nw->k) loop
        if not (ph ? id) then ph := ph || jsonb_build_object(id, '{"na":true,"v13":true}'::jsonb); n := n + 1; end if;
      end loop;
      cl := jsonb_set(cl, array[k], ph);
    end loop;
    if p.data->'std'->>'type' = 'share' and p.data->'std'->'phases' ? '2' and not (coalesce(cl->'2', '{}'::jsonb) ? '2-n6') then
      cl := jsonb_set(cl, '{2}', coalesce(cl->'2', '{}'::jsonb) || '{"2-n6":{"na":true,"v13":true}}'::jsonb); n := n + 1;
    end if;
    if cl is distinct from coalesce(p.data->'cl', '{}'::jsonb) then
      update public.docs set data = jsonb_set(data, '{cl}', cl) where path = p.path;
    end if;
  end loop;
  raise notice 'v1.3 items marked not applicable: %', n;
end $mig$;
