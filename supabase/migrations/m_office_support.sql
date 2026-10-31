-- Office Support team (31 Oct 2026). Data only; nothing about the structure changes.
--  * Adds the team "Office Support" to SLATE OS (it is not a POD, so it is never scored or ranked).
--  * Puts the Accounts login in it (logged in the access history as the Principal's change).
--  * Puts Md. Rabbi Shikder and Ambia (staff not in SLATE OS) in it on their HR records.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

update public.docs set data = jsonb_set(data, '{teams}', coalesce(data->'teams', '[]'::jsonb) || '["Office Support"]'::jsonb)
where path = 'config/settings' and not coalesce(data->'teams', '[]'::jsonb) ? 'Office Support';

do $$
declare acc uuid := 'd3fcf552-9385-4551-9457-70ca3948fd36'; boss uuid; bef jsonb;
begin
  select id into boss from public.profiles where designation = 'principal' and active limit 1;
  if exists (select 1 from public.profiles where id = acc and coalesce(team, '') <> 'Office Support') then
    bef := private.access_now(acc);
    perform private.access_apply(acc, '{"team":"Office Support"}');
    insert into public.access_requests (user_id, patch, before, requested_by, status, decided_by, decided_at, note)
    values (acc, '{"team":"Office Support"}', bef, boss, 'applied', boss, now(), 'Office Support team set up');
  end if;
end $$;

update public.fin_docs set data = data || '{"team":"Office Support"}'::jsonb
where coll = 'staff' and doc_id in ('rabbiShikder2026', 'ambiaCleaner2026') and coalesce(data->>'team', '') <> 'Office Support';

commit;
