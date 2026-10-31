-- Project printing in one account (31 Oct 2026). Data only; nothing about the structure changes.
--  * All project-related printing is done by Ishwardi Enterprise. Books' "Printing & Plotting Exp." becomes
--    "Project printing (Ishwardi Enterprise)" (a project cost).
--  * Printing that was booked to the office account "Printing & Stationery" but tagged to a project (Tk 30,684 across
--    Ray White, Elysium, Navana 039, Navana 009 and Nueva, Feb–May 2026) moves to that project printing account.
--    Same amounts, dates and projects; only the account changes. Each voucher notes the change in its history.
--    Office printing and stationery (tagged to Head Office) stays where it is.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

select set_config('slate.books_sync', '1', true);

update public.books_docs set data = data || '{"name":"Project printing (Ishwardi Enterprise)","notes":"Plots, blueprints and drawing sets for projects, all printed by Ishwardi Enterprise. Tag every line to its project."}'::jsonb
where path = 'ledgers/l111';

do $$
declare v record; nl jsonb; x jsonb; proj jsonb; office jsonb; pa numeric; oa numeric; moved boolean;
begin
  for v in select path, data from public.books_docs
           where coll = 'vouchers' and coalesce(data->>'status', '') <> 'split'
             and exists (select 1 from jsonb_array_elements(data->'lines') l, jsonb_array_elements(coalesce(l->'cc', '[]')) c
                         where l->>'l' = 'l019' and c->>'p' <> 'p00') loop
    nl := '[]'::jsonb; moved := false;
    for x in select value from jsonb_array_elements(v.data->'lines') loop
      if x->>'l' = 'l019' and exists (select 1 from jsonb_array_elements(coalesce(x->'cc', '[]')) c where c->>'p' <> 'p00') then
        select coalesce(jsonb_agg(c), '[]'::jsonb), coalesce(sum((c->>'a')::numeric), 0) into proj, pa
          from jsonb_array_elements(x->'cc') c where c->>'p' <> 'p00';
        select coalesce(jsonb_agg(c), '[]'::jsonb), coalesce(sum((c->>'a')::numeric), 0) into office, oa
          from jsonb_array_elements(x->'cc') c where c->>'p' = 'p00';
        if coalesce((x->>'cr')::numeric, 0) <> 0 or abs(pa + oa - coalesce((x->>'dr')::numeric, 0)) > 0.01 then
          raise exception 'Voucher % has a printing line that does not split cleanly. Nothing was changed.', v.path;
        end if;
        nl := nl || jsonb_build_array(x || jsonb_build_object('l', 'l111', 'dr', pa, 'cc', proj));
        if oa > 0 then nl := nl || jsonb_build_array(x || jsonb_build_object('dr', oa, 'cc', office)); end if;
        moved := true;
      else
        nl := nl || jsonb_build_array(x);
      end if;
    end loop;
    if moved then
      update public.books_docs set data = jsonb_set(data, '{lines}', nl)
        || jsonb_build_object('trail', coalesce(data->'trail', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'act', 'edited', 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', 'system',
             'note', 'Project printing moved from Printing & Stationery to Project printing (Ishwardi Enterprise)')))
      where path = v.path;
    end if;
  end loop;
end $$;

select set_config('slate.books_sync', '', true);

commit;
