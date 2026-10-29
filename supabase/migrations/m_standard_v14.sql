-- SLATE OS · SLATE standard process v1.4 (29 Oct 2026): column layout early in design development; consultants start authority drawings at the design freeze
-- New checklist items: phase 2 layouts shared early (2-n7) and column sizes confirmed (2-n8); phase 3 column layout and sizes frozen
-- (3-n3); 3R column sizes confirmed (3r-n6); phase 4 design freeze set shared on the freeze day (4-n11). On a phase whose gate is
-- already closed they are marked not applicable; on open phases they stay open as work to do. Land share projects do STR/MEP work
-- at 3R, so 2-n7 and 2-n8 are not applicable for them. Structural and MEP start, received and follow-up dates need nothing here.
-- Run in Supabase › SQL Editor after m_standard_v13.sql. Safe to run more than once.
do $mig$
declare
  nw jsonb := '{"2":["2-n7","2-n8"],"3":["3-n3"],"3r":["3r-n6"],"4":["4-n11"]}';
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
        if not (ph ? id) then ph := ph || jsonb_build_object(id, '{"na":true,"v14":true}'::jsonb); n := n + 1; end if;
      end loop;
      cl := jsonb_set(cl, array[k], ph);
    end loop;
    if p.data->'std'->>'type' = 'share' and p.data->'std'->'phases' ? '2' then
      for id in select unnest(array['2-n7','2-n8']) loop
        if not (coalesce(cl->'2', '{}'::jsonb) ? id) then
          cl := jsonb_set(cl, '{2}', coalesce(cl->'2', '{}'::jsonb) || jsonb_build_object(id, '{"na":true,"v14":true}'::jsonb)); n := n + 1;
        end if;
      end loop;
    end if;
    if cl is distinct from coalesce(p.data->'cl', '{}'::jsonb) then
      update public.docs set data = jsonb_set(data, '{cl}', cl) where path = p.path;
    end if;
  end loop;
  raise notice 'v1.4 items marked not applicable: %', n;
end $mig$;
