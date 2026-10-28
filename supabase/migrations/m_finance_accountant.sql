-- SLATE OS · Finance · Accountant, input only (28 Oct 2026)
-- A third Finance level beside the Principal and the COO. The Accountant can:
--   * add expenses and petty cash bills, which always start "pending" (awaiting the Principal)
--   * see, correct and remove ONLY their own entries, and only while still pending
--   * see the names of cash points and finance projects to pick from (never balances, fees or invoices)
-- Everything else in Finance stays Principal and COO only: is_finance() is unchanged.

alter table private.fin_access drop constraint if exists fin_access_role_check;
alter table private.fin_access add constraint fin_access_role_check check (role in ('coo', 'accountant'));

create or replace function private.is_fin_accountant()
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(private.fin_role() = 'accountant', false)
$$;

-- Row access for the Accountant: own expenses only, and only while pending
drop policy if exists fin_acc_select on public.fin_docs;
drop policy if exists fin_acc_insert on public.fin_docs;
drop policy if exists fin_acc_update on public.fin_docs;
drop policy if exists fin_acc_delete on public.fin_docs;
create policy fin_acc_select on public.fin_docs for select to authenticated
  using ((select private.is_fin_accountant()) and coll = 'expenses' and created_by = (select auth.uid()));
create policy fin_acc_insert on public.fin_docs for insert to authenticated
  with check ((select private.is_fin_accountant()) and coll = 'expenses' and coalesce(data->>'status', 'pending') = 'pending');
create policy fin_acc_update on public.fin_docs for update to authenticated
  using ((select private.is_fin_accountant()) and coll = 'expenses' and created_by = (select auth.uid()) and coalesce(data->>'status', 'pending') = 'pending')
  with check ((select private.is_fin_accountant()) and coll = 'expenses' and created_by = (select auth.uid()) and coalesce(data->>'status', 'pending') = 'pending');
create policy fin_acc_delete on public.fin_docs for delete to authenticated
  using ((select private.is_fin_accountant()) and coll = 'expenses' and created_by = (select auth.uid()) and coalesce(data->>'status', 'pending') = 'pending');

-- The guard: let the Accountant through, but only for expenses
do $mig$
declare d text; old_txt text := $o$  if uid is not null and coalesce(role, '') not in ('principal', 'coo') then
    raise exception 'Finance is limited to the Principal and the COO';
  end if;$o$;
begin
  d := pg_get_functiondef('private.fin_guard'::regproc);
  if position(old_txt in d) = 0 then raise exception 'fin_guard has changed; update this migration'; end if;
  d := replace(d, old_txt, $n$  if uid is not null and coalesce(role, '') not in ('principal', 'coo', 'accountant') then
    raise exception 'Finance is limited to the Principal and the COO';
  end if;
  if role = 'accountant' and (case when tg_op = 'DELETE' then old.coll else split_part(new.path, '/', 1) end) is distinct from 'expenses' then
    raise exception 'The Accountant can only enter expenses and petty cash bills';
  end if;$n$);
  execute d;
end $mig$;

-- Names to pick from: cash points and finance projects. No balances, fees or anything else.
create or replace function public.fin_pick_lists()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not (private.is_finance() or private.is_fin_accountant()) then return null; end if;
  return jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', doc_id, 'name', data->>'name', 'kind', data->>'kind') order by data->>'name')
                          from public.fin_docs where coll = 'accounts' and coalesce((data->>'active')::boolean, true)), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', doc_id, 'code', data->>'code', 'name', data->>'name') order by data->>'code')
                          from public.fin_docs where coll = 'projects' and coalesce(data->>'status', 'active') <> 'closed'), '[]'::jsonb));
end $$;
revoke all on function public.fin_pick_lists() from public, anon;
grant execute on function public.fin_pick_lists() to authenticated;
