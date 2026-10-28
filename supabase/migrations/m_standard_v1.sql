-- SLATE OS · SLATE standard process v1 (approved 27 Oct 2026)
-- Tasks keep a copy of their phase name and gate title. This renames them to the v1 names:
-- phase names on every task; gate titles only on gates still open (closed gates keep the title they were done under).
-- Checklist ticks need no change: kept items keep their ids. Run in Supabase › SQL Editor. Safe to run more than once.
with ph(old_l, new_l) as (values
  ('0 Pre-design', '0 Brief & feasibility'),
  ('1 Commissioning and schematic', '1 Concept design'),
  ('3 Design finalization', '3 Design freeze'),
  ('3 Design finalization (resume)', '3 Design freeze (resume)'),
  ('9 Post-construction', '9 As-built drawings'))
update public.docs t set data = jsonb_set(t.data, '{phase}', to_jsonb(ph.new_l))
from ph where t.coll in ('tasks', 'lead') and t.data->>'phase' = ph.old_l;

with g(k, step, old_t, new_t) as (values
  ('0', 'final', 'FAR analysis report issued', 'Brief and FAR report accepted'),
  ('1', 'sub', 'Schematic design submitted', 'Concept design submitted'),
  ('1', 'final', 'Schematic design accepted', 'Option selected in writing'),
  ('2', 'sub', 'Floor plan layouts submitted', 'Design development submitted'),
  ('2', 'final', 'Floor plan layouts signed', 'Design development approved'),
  ('3', 'sub', 'Final architectural set submitted', 'Design freeze sheet submitted'),
  ('3r', 'sub', 'Final architectural set submitted (resume)', 'Design freeze sheet submitted (resume)'),
  ('5', 'final', 'Final marketing package issued', 'Marketing package approved for print and launch'))
update public.docs t set data = jsonb_set(t.data, '{title}', to_jsonb(g.new_t))
from g where t.coll in ('tasks', 'lead') and t.data->'gate'->>'k' = g.k and t.data->'gate'->>'step' = g.step
  and t.data->>'title' = g.old_t and coalesce(t.data->>'doneAt', '') = '';

-- New v1 checklist items on a phase whose gate is already closed are marked not applicable (the phase finished before
-- they existed). On open phases they stay open as work to do.
do $mig$
declare
  nw jsonb := '{"0":["0-n1","0-n2","0-n3","0-n4","0-n5"],"1":["1-n1","1-n2","1-n3"],"2":["2-n1","2-n2","2-n3"],"3":["3-n1"],"3r":["3r-n1","3r-n2","3r-n3"],
               "4":["4-n1","4-n2","4-n3","4-n4","4-n5"],"5":["5-n1","5-n2"],"6":["6-n1","6-n2"],"7":["7-n1","7-n2","7-n3","7-n4","7-n5","7-n6"],"8":["8-n1","8-n2","8-n3","8-n4"]}';
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
        if not (ph ? id) then ph := ph || jsonb_build_object(id, '{"na":true,"v1":true}'::jsonb); n := n + 1; end if;
      end loop;
      cl := jsonb_set(cl, array[k], ph);
    end loop;
    if cl is distinct from coalesce(p.data->'cl', '{}'::jsonb) then
      update public.docs set data = jsonb_set(data, '{cl}', cl) where path = p.path;
    end if;
  end loop;
  raise notice 'v1 items marked not applicable on closed phases: %', n;
end $mig$;

-- Land share: STR/MEP coordination is not done at launch (phase 2); it is done at 3R when the project goes live again.
update public.docs p set data = jsonb_set(data, '{cl}', coalesce(data->'cl','{}'::jsonb) ||
    jsonb_build_object('2', coalesce(data->'cl'->'2','{}'::jsonb) || '{"2-n1":{"na":true,"v1":true}}'::jsonb))
 where coll = 'projects' and data->'std'->>'type' = 'share' and data->'std'->'phases' ? '2'
   and not (coalesce(data->'cl'->'2','{}'::jsonb) ? '2-n1');

-- Land share: the client appoints the structural and MEP consultants at 3R, not in phase 1 (an item already ticked is kept).
update public.docs p set data = jsonb_set(data, '{cl}', coalesce(data->'cl','{}'::jsonb) ||
    jsonb_build_object('1', coalesce(data->'cl'->'1','{}'::jsonb) || '{"1-2":{"na":true,"v1":true}}'::jsonb))
 where coll = 'projects' and data->'std'->>'type' = 'share' and data->'std'->'phases' ? '1'
   and coalesce(data->'cl'->'1'->'1-2'->>'done','') = '';
