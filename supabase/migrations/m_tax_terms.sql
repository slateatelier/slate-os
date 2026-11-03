-- m_tax_terms.sql (3 Nov 2026)
-- VAT and AIT terms travel with the agreement: Business › Fees (or the proposal) holds the project's tax terms,
-- and they are copied to the Books project as `taxTerms` (both, aitin, allin, vatonly, net, split), with `splitBoth`,
-- `splitAit`, `vatPct` and `aitPct`. Books invoices take them from the project.
-- Older agreements are all VAT and AIT excluded, so a fee record without terms is copied as `both`.
-- Safe to run more than once. Run in the Supabase SQL editor as one script.

begin;

create or replace function private.books_sync_project(p_id text, d jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare o jsonb; p text; tba boolean; free boolean; fee numeric; stg jsonb;
begin
  if d is not null then select x.data into o from public.docs x where x.path = 'projects/' || (d->>'osId'); end if;
  tba := coalesce(d->>'feeBasis', '') = 'tba';
  -- pro bono is kept with the agreement details (agreements/<id>); older projects may carry it on the project itself
  free := coalesce(o->>'proBono', '') = 'yes'
       or exists (select 1 from public.docs a where a.path = 'agreements/' || coalesce(d->>'osId', '') and a.data->>'proBono' = 'yes');
  if d is null or (coalesce((d->>'fee')::numeric, 0) <= 0 and not tba and not free) then
    -- no fee, or removed: a Books copy stays, marked as no longer linked
    perform set_config('slate.books_sync', '1', true);
    update public.books_docs set data = data || '{"osRemoved":true}' where coll = 'projects' and data->>'finId' = p_id;
    perform set_config('slate.books_sync', '', true);
    return;
  end if;
  fee := case when tba or free then 0 else coalesce((d->>'fee')::numeric, 0) end;
  -- payment stages: amount = the fee to the end of this stage less the fee to the end of the one before, so they add up exactly
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m->>'id', 'label', coalesce(m->>'label', ''), 'pct', coalesce((m->>'pct')::numeric, 0),
           'amount', round(fee * cum / 100) - round(fee * (cum - coalesce((m->>'pct')::numeric, 0)) / 100)) order by ord), '[]'::jsonb)
    into stg
    from (select m, ord, sum(coalesce((m->>'pct')::numeric, 0)) over (order by ord) cum
            from jsonb_array_elements(coalesce(d->'milestones', '[]'::jsonb)) with ordinality t(m, ord)
           where coalesce(m->>'id', '') <> '') s;
  p := private.books_find('projects', 'finId', p_id, 'code', d->>'code');
  perform private.books_put_os(p, jsonb_build_object(
    'src', 'os', 'osId', coalesce(d->>'osId', ''), 'finId', p_id, 'code', coalesce(d->>'code', ''), 'name', coalesce(d->>'name', ''),
    'client', coalesce(d->>'client', ''), 'contract', fee,
    'feeTba', tba, 'estFee', case when tba then coalesce((d->>'estFee')::numeric, 0) else 0 end, 'free', free,
    'status', private.books_os_status(coalesce(o, '{}'::jsonb)), 'overhead', false,
    'jvPartner', '', 'jvShare', 0, 'notes', '', 'earned', 0, 'osRemoved', false,
    'stages', stg, 'feeTerms', coalesce(d->>'feeNote', ''),
    -- VAT and AIT terms agreed for the project; older agreements are all VAT and AIT excluded
    'taxTerms', case when coalesce(d->>'taxTerms', '') in ('both', 'aitin', 'allin', 'vatonly', 'net', 'split') then d->>'taxTerms' else 'both' end,
    'splitBoth', case when d->>'taxTerms' = 'split' then coalesce((d->>'splitBoth')::numeric, 0) else 0 end,
    'splitAit', case when d->>'taxTerms' = 'split' then coalesce((d->>'splitAit')::numeric, 0) else 0 end,
    'vatPct', coalesce(nullif(d->>'vatPct', '')::numeric, 15), 'aitPct', coalesce(nullif(d->>'aitPct', '')::numeric, 7.5)),
    array['client', 'overhead', 'jvPartner', 'jvShare', 'notes', 'earned']);
end $function$;

-- give the existing Books projects their terms now
select private.books_sync_project(doc_id, data) from public.fin_docs where coll = 'projects';

commit;

-- check: every synced Books project has terms
select data->>'taxTerms' terms, count(*) from public.books_docs where coll = 'projects' and coalesce(data->>'finId', '') <> '' group by 1;
