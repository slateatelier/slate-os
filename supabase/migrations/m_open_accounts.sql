-- Open accounts: a project can be completed in SLATE OS while its account is still open in Finance
-- (e.g. an as-built percentage billed after construction). Completion never depends on as-built work.
-- * private.fin_account(fin project id): fee, billed, collected, unpaid invoices and milestones not yet billed
-- * project_dues(os_id): now also returns fee, collected, unbilled and the unbilled milestones (close screen)
-- * open_accounts(): every closed (not on-hold) SLATE OS project whose linked Finance project is not closed
--   and still has money to bill or collect — for the "Account open" badge. Principal and COO only.
-- * private.open_accounts_reminder() + cron 'slate-open-accounts' (1st of each month, 10:30 Dhaka):
--   one notification to the Principal and the COO listing those projects.
-- An account is settled when everything is billed and collected, or when Finance marks its project Closed
-- (use that to write off what will never be billed, e.g. a project closed after a phase).

create or replace function private.fin_account(p_fin_id text)
returns jsonb language sql stable security definer set search_path to '' as $$
  with fp as (
    select data from public.fin_docs where coll = 'projects' and doc_id = p_fin_id
  ), inv as (
    select i.data, private.fin_inv_total(i.data) as tot,
           coalesce(nullif(i.data->>'net', '')::numeric, nullif(i.data->>'amount', '')::numeric, 0) as net,
           coalesce((select sum(coalesce(nullif(r.data->>'received', '')::numeric, 0)
                              + coalesce(nullif(r.data->>'ait', '')::numeric, 0)
                              + coalesce(nullif(r.data->>'vds', '')::numeric, 0))
                     from public.fin_docs r where r.coll = 'receipts' and r.data->>'invoiceId' = i.doc_id), 0) as paid
    from public.fin_docs i
    where i.coll = 'invoices' and i.data->>'projectId' = p_fin_id
      and coalesce(nullif(i.data->>'status', ''), 'draft') not in ('void', 'draft')
  ), fee as (
    select coalesce(nullif((select data->>'fee' from fp), '')::numeric, 0) as v
  ), ms as (
    select m->>'id' as id, m->>'label' as label, coalesce(nullif(m->>'pct', '')::numeric, 0) as pct
    from fp, jsonb_array_elements(coalesce(fp.data->'milestones', '[]'::jsonb)) m
  ), ms_open as (
    select ms.* from ms
    where not exists (select 1 from inv where inv.data->>'milestoneId' = ms.id)
  )
  select jsonb_build_object(
    'status', coalesce((select data->>'status' from fp), 'active'),
    'fee', (select v from fee),
    'billed', (select coalesce(sum(net), 0) from inv),
    'collected', (select coalesce(round(sum(least(paid, tot) * net / nullif(tot, 0)), 2), 0) from inv),
    'open', (select count(*) from inv where paid < tot - 1),
    'due', (select coalesce(sum(tot - paid), 0) from inv where paid < tot - 1),
    'overdue', (select count(*) from inv where paid < tot - 1 and coalesce(data->>'due', '') <> ''
                and data->>'due' < to_char(now() at time zone 'Asia/Dhaka', 'YYYY-MM-DD')),
    'unbilled', greatest(0, (select v from fee) - (select coalesce(sum(net), 0) from inv)),
    'unbilledMs', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'pct', pct,
                    'amount', round((select v from fee) * pct / 100, 2)) order by label) from ms_open where pct > 0), '[]'::jsonb)
  )
$$;
revoke all on function private.fin_account(text) from public, anon, authenticated;

create or replace function public.project_dues(p_os_id text)
returns jsonb language sql stable security definer set search_path to '' as $$
  with fp as (
    select doc_id from public.fin_docs where coll = 'projects' and data->>'osId' = p_os_id limit 1
  )
  select case when not private.is_finance() then null
    when not exists (select 1 from fp) then jsonb_build_object('linked', false, 'open', 0, 'due', 0, 'overdue', 0, 'unbilled', 0, 'unbilledMs', '[]'::jsonb)
    else jsonb_build_object('linked', true) || private.fin_account((select doc_id from fp)) end
$$;
revoke all on function public.project_dues(text) from public, anon;
grant execute on function public.project_dues(text) to authenticated;

-- closed (not on hold) SLATE OS projects with money still to bill or collect
create or replace function private.open_accounts_list()
returns table (os_id text, name text, code text, outcome text, acct jsonb)
language sql stable security definer set search_path to '' as $$
  select d.doc_id, d.data->>'name', d.data->>'code', coalesce(d.data->>'outcome', 'completed'), private.fin_account(f.doc_id)
  from public.docs d
  join public.fin_docs f on f.coll = 'projects' and f.data->>'osId' = d.doc_id
  where d.coll = 'projects' and coalesce((d.data->>'closed')::boolean, false)
    and coalesce(d.data->>'outcome', '') <> 'onhold'
    and coalesce(f.data->>'status', 'active') <> 'closed'
    and (select (a->>'due')::numeric > 1 or (a->>'unbilled')::numeric > 1 from (select private.fin_account(f.doc_id) a) x)
$$;
revoke all on function private.open_accounts_list() from public, anon, authenticated;

create or replace function public.open_accounts()
returns jsonb language sql stable security definer set search_path to '' as $$
  select case when not private.is_finance() then null else
    coalesce((select jsonb_object_agg(os_id, acct || jsonb_build_object('outcome', outcome)) from private.open_accounts_list()), '{}'::jsonb) end
$$;
revoke all on function public.open_accounts() from public, anon;
grant execute on function public.open_accounts() to authenticated;

create or replace function private.open_accounts_reminder()
returns void language plpgsql security definer set search_path to '' as $$
declare u uuid; n int; body text;
begin
  select count(*), string_agg(coalesce(nullif(code, ''), name) || ': '
           || concat_ws(' + ',
                case when (acct->>'unbilled')::numeric > 1 then 'Tk ' || to_char((acct->>'unbilled')::numeric, 'FM99,99,99,99,990') || ' to bill' end,
                case when (acct->>'due')::numeric > 1 then 'Tk ' || to_char((acct->>'due')::numeric, 'FM99,99,99,99,990') || ' unpaid' end),
         '; ' order by name)
    into n, body from private.open_accounts_list();
  if coalesce(n, 0) = 0 then return; end if;
  for u in select id from public.profiles where active and designation in ('principal', 'coo') loop
    insert into public.notifications (user_id, kind, title, body)
    values (u, 'accounts', n || ' completed project' || case when n = 1 then '' else 's' end || ' with open accounts',
            body || '. Bill or chase these in Finance, or mark the Finance project Closed to write off what won''t be billed.');
  end loop;
end $$;
revoke all on function private.open_accounts_reminder() from public, anon, authenticated;

select cron.unschedule('slate-open-accounts') where exists (select 1 from cron.job where jobname = 'slate-open-accounts');
select cron.schedule('slate-open-accounts', '30 4 1 * *', 'select private.open_accounts_reminder()');

-- follow-up (m_open_accounts_ms_order): unbilledMs is listed in fee-schedule order (jsonb_array_elements ... with ordinality, order by k)
