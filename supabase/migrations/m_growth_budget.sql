-- SLATE growth budget (31 Oct 2026). Data only; nothing about the structure changes.
--  * A new Books account "SLATE growth – Principal (travel, client acquisition)" for the Principal's travel, client meals
--    and other client-acquisition spending. It is its own line in the monthly plan ("SLATE growth (Principal)"), so the
--    fixed monthly amount can be planned and compared with what was spent.
--  * Paid monthly with the salary: a monthly entry in Books (More › Monthly entries) pays the Principal Tk 50,000 on the 30th
--    against this account, so it shows up each month under "Monthly entries due" next to the salaries.
--  * If Accounts ever pays the Principal's expense claims in Books, this account is chosen for them.
--  * The plan for FY 2026-27 gets Tk 50,000 a month on this line (the Principal can change it in the plan).
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

select set_config('slate.books_sync', '1', true);

insert into public.books_docs (path, coll, doc_id, data) values ('ledgers/l134', 'ledgers', 'l134',
  '{"name":"SLATE growth – Principal (travel, client acquisition)","group":"adm","cat":"grow","active":true,"opening":0,"notes":"Fixed monthly budget for SLATE''s growth: the Principal''s travel, client meals and other client-acquisition costs. Tag to the project or lead when there is one."}'::jsonb)
on conflict (path) do nothing;

insert into public.books_docs (path, coll, doc_id, data) values ('recurring/growPrincipal', 'recurring', 'growPrincipal',
  '{"name":"SLATE growth – Principal","amount":50000,"day":30,"mode":"spend","acc":"","cat":"l134","vendor":"","proj":"","party":"Syed Mohammed Imran","narr":"SLATE growth budget – Principal (travel, client acquisition)","active":true}'::jsonb)
on conflict (path) do nothing;

update public.books_docs set data = jsonb_set(data, '{m,grow}', '50000'::jsonb)
where path = 'plan/26-27' and coalesce(data->'m'->>'grow', '') = '';

select set_config('slate.books_sync', '', true);

commit;
