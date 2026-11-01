-- One client name for Edison (1 Nov 2026). Data only; nothing about the structure changes.
--  * The Principal's decision: all Edison projects are under one client, "EDISON REAL ESTATE".
--  * Renames the client on the 10 projects now split between "EDISON" (Celenta, Juno, Nueva, Tamora) and
--    "EDISON REAL ESTATE LTD. (EREL)" (Verona site office, Orleans, Celia, Camillo, Luxe Vista, Elena).
--    Project codes, names, fees and everything else stay as they are. The old Finance copy follows automatically.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

update public.docs set data = data || '{"client":"EDISON REAL ESTATE"}'::jsonb
where coll = 'projects' and data->>'client' in ('EDISON', 'EDISON REAL ESTATE LTD. (EREL)');

commit;
