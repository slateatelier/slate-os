-- SLATE OS · project lifecycle (26 Oct 2026), applied as project_lifecycle
-- * A project ends in one of four ways: on hold (reversible), completed, closed after a phase, or cancelled.
--   The app keeps `closed` as the single "out of the active lists" flag and records the outcome in
--   `outcome` + `closure` (reason, date, last phase, delivered / dropped scope, review date for on-hold).
--   Only the Principal and the COO write these (they already pass docs_guard as approvers).
-- * A project's pod leader may ask to close or pause it: `closeReq`, in their own name, or withdraw their own.
-- * project_dues(os_id): unpaid invoices on the linked finance project, for the Principal and the COO only,
--   so a closing project with money still owed is flagged before it leaves the list.

do $mig$
declare src text; anchor text := $a$      elsif k = 'type' then$a$;
begin
  select pg_get_functiondef('private.docs_guard'::regproc) into src;
  if position('closeReq' in src) = 0 then
    if position(anchor in src) = 0 then raise exception 'docs_guard anchor not found'; end if;
    src := replace(src, anchor, $b$      elsif k = 'closeReq' then
        if not is_lead then raise exception 'Only the project''s pod leader asks to close or pause it'; end if;
        if jsonb_typeof(nd->'closeReq') = 'object' and nd->'closeReq'->>'by' is distinct from uid::text then
          raise exception 'Ask to close a project in your own name';
        end if;
        if jsonb_typeof(od->'closeReq') = 'object' and od->'closeReq'->>'by' is distinct from uid::text then
          raise exception 'Only the person who asked can change or withdraw this request';
        end if;
$b$ || anchor);
    execute src;
  end if;
end $mig$;

create or replace function public.project_dues(p_os_id text)
returns jsonb language sql stable security definer set search_path to '' as $$
  with fp as (
    select doc_id from public.fin_docs where coll = 'projects' and data->>'osId' = p_os_id
  ), inv as (
    select i.doc_id, i.data, private.fin_inv_total(i.data) as tot,
           coalesce((select sum(coalesce(nullif(r.data->>'received', '')::numeric, 0)
                              + coalesce(nullif(r.data->>'ait', '')::numeric, 0)
                              + coalesce(nullif(r.data->>'vds', '')::numeric, 0))
                     from public.fin_docs r where r.coll = 'receipts' and r.data->>'invoiceId' = i.doc_id), 0) as paid
    from public.fin_docs i
    where i.coll = 'invoices' and i.data->>'projectId' in (select doc_id from fp)
      and coalesce(nullif(i.data->>'status', ''), 'draft') not in ('void', 'draft')
  )
  select case when not private.is_finance() then null else jsonb_build_object(
    'linked', exists (select 1 from fp),
    'open', (select count(*) from inv where paid < tot - 1),
    'due', (select coalesce(sum(tot - paid), 0) from inv where paid < tot - 1),
    'overdue', (select count(*) from inv where paid < tot - 1 and coalesce(data->>'due', '') <> ''
                and data->>'due' < to_char(now() at time zone 'Asia/Dhaka', 'YYYY-MM-DD'))
  ) end
$$;
revoke all on function public.project_dues(text) from public, anon;
grant execute on function public.project_dues(text) to authenticated;
