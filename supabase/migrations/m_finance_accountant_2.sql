-- SLATE OS · Finance · Accountant, step 1 + 2 (28 Oct 2026)
-- Step 1: "money received" entries (coll 'intakes'): the Accountant logs what came in; the Principal or COO
--         matches it to an invoice, which records the money receipt.
-- Step 2: the Accountant can see cash point balances and movements (through fin_ledger, never fees, invoice
--         amounts or individual salaries), request transfers between cash points (approved by the Principal or
--         COO), and record cash counts with a note count.
-- Run in Supabase › SQL Editor. Safe to run more than once.

-- Row access for the Accountant: own entries in these four record types only
drop policy if exists fin_acc_select on public.fin_docs;
drop policy if exists fin_acc_insert on public.fin_docs;
drop policy if exists fin_acc_update on public.fin_docs;
drop policy if exists fin_acc_delete on public.fin_docs;
create policy fin_acc_select on public.fin_docs for select to authenticated
  using ((select private.is_fin_accountant()) and coll in ('expenses', 'intakes', 'moves', 'recons') and created_by = (select auth.uid()));
create policy fin_acc_insert on public.fin_docs for insert to authenticated
  with check ((select private.is_fin_accountant()) and coll in ('expenses', 'intakes', 'moves', 'recons')
              and (coll = 'recons' or coalesce(data->>'status', 'pending') = 'pending'));
create policy fin_acc_update on public.fin_docs for update to authenticated
  using ((select private.is_fin_accountant()) and coll in ('expenses', 'intakes', 'moves', 'recons') and created_by = (select auth.uid())
         and (coll = 'recons' or coalesce(data->>'status', 'pending') = 'pending'))
  with check ((select private.is_fin_accountant()) and coll in ('expenses', 'intakes', 'moves', 'recons') and created_by = (select auth.uid())
         and (coll = 'recons' or coalesce(data->>'status', 'pending') = 'pending'));
create policy fin_acc_delete on public.fin_docs for delete to authenticated
  using ((select private.is_fin_accountant()) and coll in ('expenses', 'intakes', 'moves', 'recons') and created_by = (select auth.uid())
         and (coll = 'recons' or coalesce(data->>'status', 'pending') = 'pending'));

-- The guard: widen the Accountant's record types, and accept 'intakes' as a record type
do $mig$
declare d text;
  a_old text := $o$  if role = 'accountant' and (case when tg_op = 'DELETE' then old.coll else split_part(new.path, '/', 1) end) is distinct from 'expenses' then
    raise exception 'The Accountant can only enter expenses and petty cash bills';
  end if;$o$;
  a_new text := $n$  if role = 'accountant' then
    if (case when tg_op = 'DELETE' then old.coll else split_part(new.path, '/', 1) end) not in ('expenses', 'intakes', 'moves', 'recons') then
      raise exception 'The Accountant can enter expenses, money received, transfers and cash counts only';
    end if;
    if tg_op <> 'DELETE' and split_part(new.path, '/', 1) = 'moves' and (coalesce(new.data->>'type', '') <> 'transfer' or coalesce(new.data->>'status', '') <> 'pending') then
      raise exception 'A transfer you enter waits for the Principal or the COO to approve it';
    end if;
    if tg_op <> 'DELETE' and split_part(new.path, '/', 1) = 'intakes' and coalesce(new.data->>'status', 'pending') <> 'pending' then
      raise exception 'Only the Principal or the COO can match money received to an invoice';
    end if;
  end if;$n$;
  c_old text := $o$'staff', 'advances', 'payruns', 'budgets') then$o$;
  c_new text := $n$'staff', 'advances', 'payruns', 'budgets', 'intakes') then$n$;
begin
  d := pg_get_functiondef('private.fin_guard'::regproc);
  if position(a_old in d) > 0 then d := replace(d, a_old, a_new);
  elsif position('not in (''expenses'', ''intakes'', ''moves'', ''recons'')' in d) = 0 then raise exception 'fin_guard: accountant block not found'; end if;
  if position(c_old in d) > 0 then d := replace(d, c_old, c_new);
  elsif position('''budgets'', ''intakes'') then' in d) = 0 then raise exception 'fin_guard: record type list not found'; end if;
  -- money received: basic checks for everyone
  if position('if new.coll = ''intakes'' then' in d) = 0 then
    d := replace(d, $o$  if new.coll = 'config' then
    if (coalesce(od->'lockedFYs'$o$, $n$  if new.coll = 'intakes' then
    if coalesce(nd->>'status', 'pending') not in ('pending', 'matched', 'dismissed') then raise exception 'Unknown status'; end if;
    if coalesce(nd->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Date is missing'; end if;
    if coalesce((nd->>'amount')::numeric, 0) <= 0 then raise exception 'Enter the amount received'; end if;
    if coalesce(nd->>'accountId', '') <> '' and not private.fin_acct_ok(nd->>'accountId') then raise exception 'Pick the cash point it went into'; end if;
    if tg_op = 'UPDATE' and coalesce(od->>'status', 'pending') <> 'pending' and role = 'accountant' then raise exception 'This has already been matched'; end if;
    return new;
  end if;
  if new.coll = 'config' then
    if (coalesce(od->'lockedFYs'$n$);
  end if;
  execute d;
end $mig$;

-- Pick lists: add each project's client name
create or replace function public.fin_pick_lists()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not (private.is_finance() or private.is_fin_accountant()) then return null; end if;
  return jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', doc_id, 'name', data->>'name', 'kind', data->>'kind') order by data->>'name')
                          from public.fin_docs where coll = 'accounts' and coalesce((data->>'active')::boolean, true)), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', doc_id, 'code', data->>'code', 'name', data->>'name', 'client', data->>'client') order by data->>'code')
                          from public.fin_docs where coll = 'projects' and coalesce(data->>'status', 'active') <> 'closed'), '[]'::jsonb));
end $$;

-- Cash point movements for the Accountant (and anyone with Finance access).
-- Only what moved, when and a plain label: no fees, invoice amounts, profit or individual salaries.
create or replace function public.fin_ledger()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare out jsonb;
begin
  if not (private.is_finance() or private.is_fin_accountant()) then return null; end if;
  with acc as (
    select doc_id id, data from public.fin_docs where coll = 'accounts'
  ), prj as (
    select doc_id id, data from public.fin_docs where coll = 'projects'
  ), inv as (
    select doc_id id, data from public.fin_docs where coll = 'invoices'
  ), e as (
    -- client payments, split across cash points when the receipt has parts
    select coalesce(pt->>'accountId', r.data->>'accountId') aid, r.data->>'date' d, coalesce((pt->>'amount')::numeric, (r.data->>'received')::numeric, 0) amt,
           'Received · ' || coalesce(p.data->>'client', p.data->>'name', 'client') what,
           concat_ws(' · ', r.data->>'mrNo', p.data->>'code', nullif(r.data->>'ref', '')) sub, 'receipt' k, r.created_at at_
    from public.fin_docs r
    left join inv i on i.id = r.data->>'invoiceId' left join prj p on p.id = coalesce(i.data->>'projectId', r.data->>'projectId')
    left join lateral jsonb_array_elements(case when jsonb_typeof(r.data->'parts') = 'array' and jsonb_array_length(r.data->'parts') > 0 then r.data->'parts' else '[null]'::jsonb end) pt on true
    where r.coll = 'receipts'
    union all
    select m.data->>'to', m.data->>'date', (m.data->>'amount')::numeric,
           case m.data->>'type' when 'transfer' then 'Transfer from ' || coalesce((select a.data->>'name' from acc a where a.id = m.data->>'from'), 'another account')
                when 'capital' then 'Capital put in' when 'income' then 'Other income' else 'In' end,
           concat_ws(' · ', nullif(m.data->>'ref', ''), nullif(m.data->>'note', '')), 'move', m.created_at
    from public.fin_docs m where m.coll = 'moves' and coalesce(m.data->>'to', '') <> '' and coalesce(m.data->>'status', 'approved') not in ('pending', 'rejected')
    union all
    select m.data->>'from', m.data->>'date', -(m.data->>'amount')::numeric,
           case m.data->>'type' when 'transfer' then 'Transfer to ' || coalesce((select a.data->>'name' from acc a where a.id = m.data->>'to'), 'another account')
                when 'drawing' then 'Owner''s drawing' else 'Out' end,
           concat_ws(' · ', nullif(m.data->>'ref', ''), nullif(m.data->>'note', '')), 'move', m.created_at
    from public.fin_docs m where m.coll = 'moves' and coalesce(m.data->>'from', '') <> '' and coalesce(m.data->>'status', 'approved') not in ('pending', 'rejected')
    union all
    select x.data->>'accountId', x.data->>'paidOn', -(x.data->>'amount')::numeric, x.data->>'desc',
           concat_ws(' · ', x.data->>'category', nullif(x.data->>'payee', ''), nullif(x.data->>'ref', ''), case when coalesce(x.data->>'status', 'pending') = 'pending' then 'awaiting approval' end), 'expense', x.created_at
    from public.fin_docs x where x.coll = 'expenses' and coalesce(x.data->>'accountId', '') <> '' and coalesce(x.data->>'paidOn', '') <> '' and coalesce(x.data->>'status', '') <> 'rejected'
    union all
    select x.data->>'accountId', x.data->>'paidOn', -(x.data->>'amount')::numeric, 'Staff advance', nullif(x.data->>'ref', ''), 'advance', x.created_at
    from public.fin_docs x where x.coll = 'advances' and coalesce(x.data->>'accountId', '') <> '' and coalesce(x.data->>'paidOn', '') <> ''
    union all
    -- salary sheets: only the cash and bank totals, never individual lines
    select t.aid, r.data->>'payDate', -t.amt, 'Salary sheet ' || coalesce(r.data->>'month', '') || ' · ' || t.how, nullif(r.data->>'payRef', ''), 'payrun', r.updated_at
    from public.fin_docs r,
    lateral (select sum(case l->>'method' when 'bank' then coalesce((l->>'net')::numeric, 0) when 'split' then least(coalesce((l->>'net')::numeric, 0), coalesce((l->>'bankAmt')::numeric, 0)) else 0 end) b,
                    sum(case coalesce(l->>'method', 'cash') when 'cash' then coalesce((l->>'net')::numeric, 0) when 'split' then coalesce((l->>'net')::numeric, 0) - least(coalesce((l->>'net')::numeric, 0), coalesce((l->>'bankAmt')::numeric, 0)) else 0 end) c
             from jsonb_array_elements(coalesce(r.data->'lines', '[]'::jsonb)) l) s,
    lateral (values (r.data->>'cashAccountId', s.c, 'cash'), (r.data->>'bankAccountId', s.b, 'bank')) t(aid, amt, how)
    where r.coll = 'payruns' and r.data->>'status' = 'paid' and coalesce(t.amt, 0) > 0
    union all
    select x.data->>'accountId', x.data->>'date', -(coalesce((x.data->>'gross')::numeric, 0) - coalesce((x.data->>'ait')::numeric, 0) - coalesce((x.data->>'vds')::numeric, 0)),
           'Paid ' || coalesce(w.data->>'vendor', 'vendor'), w.data->>'no', 'wopay', x.created_at
    from public.fin_docs x left join public.fin_docs w on w.path = 'workorders/' || (x.data->>'woId') where x.coll = 'wopays'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'name', a.data->>'name', 'kind', a.data->>'kind', 'active', coalesce((a.data->>'active')::boolean, true),
           'opening', coalesce((a.data->>'opening')::numeric, 0), 'openingDate', a.data->>'openingDate', 'float', a.data->'float',
           'entries', coalesce((select jsonb_agg(jsonb_build_object('date', e.d, 'amt', e.amt, 'what', e.what, 'sub', e.sub, 'kind', e.k) order by e.d, e.at_)
                                from e where e.aid = a.id and e.d is not null), '[]'::jsonb),
           'counts', coalesce((select jsonb_agg(jsonb_build_object('month', r.data->>'month', 'date', r.data->>'date', 'book', r.data->'book', 'actual', r.data->'actual',
                                                                    'diff', r.data->'diff', 'notes', r.data->'notes', 'note', r.data->>'note') order by r.data->>'month')
                               from public.fin_docs r where r.coll = 'recons' and r.data->>'accountId' = a.id), '[]'::jsonb)
         ) order by a.data->>'kind', a.data->>'name'), '[]'::jsonb) into out
  from acc a;
  return out;
end $$;
revoke all on function public.fin_ledger() from public, anon;
grant execute on function public.fin_ledger() to authenticated;
