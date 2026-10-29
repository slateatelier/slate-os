-- SLATE OS · SLATE standard process v1.2 (final, adopted 29 Oct 2026 with the team's marked-up copy)
-- 1. Two WD-3 items move to WD-2 (phase 7): "Presentation plan, working plan, slab layout; false slab, lintel and sunshade
--    layout" (8-1) and "All elevations, sections and blow-ups as needed" (8-3). Any tick or owner already set on them is
--    carried across with them.
-- 2. New v1.2 items on a phase whose gate is already closed are marked not applicable (the phase finished before they
--    existed). On open phases they stay open as work to do.
-- Owner and checker changes need nothing here: they live in SLATE OS itself.
-- Run in Supabase › SQL Editor. Safe to run more than once.

-- 1. carry the moved items' ticks from phase 8 to phase 7
do $mig$
declare p record; cl jsonb; id text; n int := 0;
begin
  for p in select path, data from public.docs where coll = 'projects' and data ? 'std' and coalesce(data->'cl'->'8', '{}'::jsonb) ?| array['8-1','8-3'] loop
    cl := coalesce(p.data->'cl', '{}'::jsonb);
    foreach id in array array['8-1','8-3'] loop
      if (cl->'8') ? id then
        if not (coalesce(cl->'7', '{}'::jsonb) ? id) then
          cl := jsonb_set(cl, '{7}', coalesce(cl->'7', '{}'::jsonb) || jsonb_build_object(id, cl->'8'->id));
        end if;
        cl := jsonb_set(cl, '{8}', (cl->'8') - id);
        n := n + 1;
      end if;
    end loop;
    update public.docs set data = jsonb_set(data, '{cl}', cl) where path = p.path;
  end loop;
  raise notice 'v1.2 ticks moved from WD-3 to WD-2: %', n;
end $mig$;

-- 2. new items on closed phases are not applicable
do $mig$
declare
  nw jsonb := '{"4":["4-n6","4-n7"],"5":["5-n4"],"7":["7-n10","8-1","8-3"]}';
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
        if not (ph ? id) then ph := ph || jsonb_build_object(id, '{"na":true,"v12":true}'::jsonb); n := n + 1; end if;
      end loop;
      cl := jsonb_set(cl, array[k], ph);
    end loop;
    if cl is distinct from coalesce(p.data->'cl', '{}'::jsonb) then
      update public.docs set data = jsonb_set(data, '{cl}', cl) where path = p.path;
    end if;
  end loop;
  raise notice 'v1.2 items marked not applicable on closed phases: %', n;
end $mig$;
