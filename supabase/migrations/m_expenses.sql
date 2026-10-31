-- Expense claims (31 Oct 2026). Runs after m_conveyance.sql. Conveyance becomes "Expense claims" with three kinds:
--  * Transport (as before): limit per trip by kind of transport; per person for rickshaw, bus and bike rides; a return trip doubles it.
--  * Meals (lunch on a site day and the like): limit per person per day. One person claims for everyone who ate together and
--    names them; nobody can claim a second meal of the same kind on the same day.
--  * Client costs (client lunch or dinner, other client costs): only the Principal and the COO claim these. The COO's are within
--    the limit the Principal sets; the Principal's have no limit.
--  * The Principal's own claims need no approval: they are approved as soon as they are made (the COO is told), and Accounts pays them.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

alter table public.conv_types add column if not exists kind text not null default 'transport';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conv_types_kind_check') then
    alter table public.conv_types add constraint conv_types_kind_check check (kind in ('transport', 'meal', 'client'));
  end if;
end $$;
insert into public.conv_types (id, label, per_person, sort, kind) values
  ('lunch', 'Lunch', true, 110, 'meal'),
  ('client_meal', 'Client lunch or dinner', false, 210, 'client'),
  ('client_other', 'Other client costs', false, 220, 'client')
on conflict (id) do nothing;

alter table public.conv_claims drop constraint if exists conv_claims_purpose_check;
alter table public.conv_claims add constraint conv_claims_purpose_check check (purpose in ('site', 'client', 'authority', 'consultant', 'market', 'errand', 'other'));

create or replace function public.conv_submit(p jsonb) returns text
language plpgsql security definer set search_path to '' as $$
declare
  me uuid := auth.uid(); owner boolean := private.is_owner(); coo boolean := private.is_coo() and not private.is_owner();
  c public.conv_claims; t public.conv_types; d date; ppl uuid[]; allowed numeric; amt numeric;
  prj text := nullif(trim(coalesce(p->>'project', '')), ''); dup record; td date := (now() at time zone 'Asia/Dhaka')::date;
  pur text := coalesce(p->>'purpose', ''); fr text := trim(coalesce(p->>'from', '')); tp text := trim(coalesce(p->>'to', ''));
  rt boolean := coalesce((p->>'round')::boolean, false); pb boolean := coalesce((p->>'paperBill')::boolean, false);
  nt text := trim(coalesce(p->>'note', '')); newid text; who uuid; st text; what text;
begin
  if me is null or not coalesce(private.is_active(), false) then raise exception 'Sign in again, then try.'; end if;
  if p ? 'id' and nullif(p->>'id', '') is not null then
    select * into c from public.conv_claims where id = p->>'id' for update;
    if c.id is null or c.user_id <> me then raise exception 'This claim isn''t yours.'; end if;
    if c.status not in ('submitted', 'returned') and not (owner and c.status = 'approved') then raise exception 'This claim has already been %; it can''t be changed.', c.status; end if;
  end if;
  select * into t from public.conv_types where id = p->>'mode';
  if t.id is null or not t.active then raise exception 'Choose what the claim is for.'; end if;
  if t.kind = 'client' and not (owner or coo) then raise exception 'Client costs are claimed by the Principal and the COO only.'; end if;
  if not owner and t.limit_amt <= 0 then raise exception 'There is no limit set for % yet.', t.label; end if;
  begin d := (p->>'date')::date; exception when others then raise exception 'Choose the date.'; end;
  if d is null then raise exception 'Choose the date.'; end if;
  if d > td then raise exception 'The date can''t be in the future.'; end if;
  if d < date_trunc('month', td - interval '1 month')::date then raise exception 'Claims are for this month and last month only.'; end if;
  if pur not in ('site', 'client', 'authority', 'consultant', 'market', 'errand', 'other') then raise exception 'Choose what it was for.'; end if;
  if prj is not null and not exists (select 1 from public.docs where coll = 'projects' and doc_id = prj) then raise exception 'Choose the project again.'; end if;
  if prj is null and pur = 'site' then raise exception 'Choose the project for a site visit.'; end if;
  if prj is null and nt = '' then raise exception 'Without a project, add a note saying what it was for%.', case when t.kind = 'client' then ' and which client' else '' end; end if;
  if t.kind = 'transport' and (fr = '' or tp = '') then raise exception 'Enter where you went from and to.'; end if;
  if t.kind <> 'transport' and tp = '' then raise exception 'Enter where (the restaurant or place).'; end if;
  if t.kind <> 'transport' then fr := ''; rt := false; end if;
  select coalesce(array_agg(distinct x), '{}') into ppl from (select (jsonb_array_elements_text(coalesce(p->'people', '[]'::jsonb)))::uuid x) s where x <> me;
  if exists (select 1 from unnest(ppl) x where not exists (select 1 from public.profiles pr where pr.id = x and pr.active)) then raise exception 'Choose the people who were with you again.'; end if;
  begin amt := round((p->>'amount')::numeric, 2); exception when others then raise exception 'Enter the amount.'; end;
  if amt is null or amt <= 0 then raise exception 'Enter the amount.'; end if;
  allowed := t.limit_amt * (case when t.per_person then 1 + cardinality(ppl) else 1 end) * (case when rt then 2 else 1 end);
  if not owner and amt > allowed then raise exception 'The most you can claim for this is Tk %.', to_char(allowed, 'FM999,999,990'); end if;
  if owner and allowed <= 0 then allowed := amt; end if;

  -- the same trip or meal, claimed twice (one claim at a time per day, so two people pressing Send together can't both get through)
  perform pg_advisory_xact_lock(hashtext('conv:' || d::text));
  for dup in select x.id, x.user_id from public.conv_claims x join public.conv_types y on y.id = x.mode
     where x.trip_date = d and x.status not in ('cancelled', 'rejected') and x.id is distinct from c.id
       and (array[x.user_id] || x.people) && (array[me] || ppl)
       and case t.kind
             when 'transport' then y.kind = 'transport' and (case when prj is not null then x.project_id = prj else x.project_id is null and lower(x.to_place) = lower(tp) end)
             when 'meal' then x.mode = t.id
             else false end loop
    raise exception '% already claimed this % (%). Only one person claims for something done together.',
      case when dup.user_id = me then 'You have' else private.conv_name(dup.user_id) || ' has' end, case when t.kind = 'meal' then lower(t.label) || ' that day' else 'trip' end, dup.id;
  end loop;

  st := case when owner then 'approved' else 'submitted' end;
  if c.id is null then
    insert into public.conv_claims (user_id, trip_date, project_id, purpose, from_place, to_place, mode, people, round_trip, paper_bill, amount, limit_at, note, status, decided_by, decided_at)
    values (me, d, prj, pur, left(fr, 120), left(tp, 120), t.id, ppl, rt, pb, amt, allowed, left(nt, 300), st, case when owner then me end, case when owner then now() end)
    returning id into newid;
  else
    update public.conv_claims set trip_date = d, project_id = prj, purpose = pur, from_place = left(fr, 120), to_place = left(tp, 120), mode = t.id,
      people = ppl, round_trip = rt, paper_bill = pb, amount = amt, limit_at = allowed, note = left(nt, 300), status = st,
      decided_by = case when owner then me end, decided_at = case when owner then now() end, decision_note = null, updated_at = now()
    where id = c.id;
    newid := c.id;
  end if;
  what := t.label || case when t.kind = 'transport' then ', ' || fr || ' to ' || tp else ' at ' || tp end || ' on ' || to_char(d, 'DD Mon');
  -- tell whoever approves it (the Principal's own claims: the COO is told, for the record)
  for who in select id from public.profiles where active and (case when coo then designation = 'principal' else designation = 'coo' end) loop
    perform private.notify(who, 'conveyance', case when owner then 'Expense recorded ' else 'Expense claim ' end || newid,
      private.conv_name(me) || case when owner then ' recorded Tk ' else ' claimed Tk ' end || to_char(amt, 'FM999,999,990') || ' for ' || what || '.');
  end loop;
  return newid;
end $$;

-- the Principal can also take back his own claim before it is paid
create or replace function public.conv_cancel(p_id text) returns void
language plpgsql security definer set search_path to '' as $$
begin
  update public.conv_claims set status = 'cancelled', updated_at = now()
  where id = p_id and user_id = auth.uid() and (status in ('submitted', 'returned') or (status = 'approved' and private.is_owner()));
  if not found then raise exception 'Only your own claim, before it is approved, can be cancelled.'; end if;
end $$;

create or replace function public.conv_set_types(p jsonb) returns void
language plpgsql security definer set search_path to '' as $$
declare x jsonb;
begin
  if not private.is_owner() then raise exception 'Only the Principal sets expense limits.'; end if;
  for x in select * from jsonb_array_elements(p) loop
    if coalesce(x->>'id', '') !~ '^[a-z0-9_-]{2,20}$' or trim(coalesce(x->>'label', '')) = '' then raise exception 'Each kind needs a name.'; end if;
    if coalesce(x->>'kind', 'transport') not in ('transport', 'meal', 'client') then raise exception 'Unknown kind of expense'; end if;
    insert into public.conv_types (id, label, limit_amt, per_person, active, sort, kind, updated_at, updated_by)
    values (x->>'id', left(trim(x->>'label'), 40), greatest(coalesce((x->>'limit')::numeric, 0), 0), coalesce((x->>'perPerson')::boolean, false),
            coalesce((x->>'active')::boolean, false), coalesce((x->>'sort')::int, 0), coalesce(x->>'kind', 'transport'), now(), auth.uid())
    on conflict (id) do update set label = excluded.label, limit_amt = excluded.limit_amt, per_person = excluded.per_person,
      active = excluded.active, sort = excluded.sort, kind = excluded.kind, updated_at = now(), updated_by = auth.uid();
  end loop;
end $$;

commit;
