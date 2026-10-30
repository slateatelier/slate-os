-- 30 Oct 2026 (applied): "Project set up in SLATE OS; timeline approved" (1-1) and "structural and MEP consultants appointed" (1-2)
-- move from phase 1 to phase 0, right after the work order. Ticks and owners move with them; the ids stay the same.
do $mig$
declare p record; cl jsonb; id text;
begin
  for p in select path, data from public.docs where coll = 'projects' and data ? 'std' and coalesce(data->'cl'->'1', '{}'::jsonb) ?| array['1-1','1-2'] loop
    cl := coalesce(p.data->'cl', '{}'::jsonb);
    foreach id in array array['1-1','1-2'] loop
      if (cl->'1') ? id then
        if not (coalesce(cl->'0', '{}'::jsonb) ? id) then
          cl := jsonb_set(cl, '{0}', coalesce(cl->'0', '{}'::jsonb) || jsonb_build_object(id, cl->'1'->id));
        end if;
        cl := jsonb_set(cl, '{1}', (cl->'1') - id);
      end if;
    end loop;
    update public.docs set data = jsonb_set(data, '{cl}', cl) where path = p.path;
  end loop;
end $mig$;
