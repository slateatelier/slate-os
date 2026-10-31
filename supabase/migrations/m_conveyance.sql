-- Conveyance claims (31 Oct 2026): team members claim transport for site visits, client meetings and errands.
--  * Each kind of transport has a limit per trip, set by the Principal (Studio › Settings › Conveyance limits).
--    Some kinds are paid per person (rickshaw, bus, bike ride): the limit is multiplied by the number of people
--    who travelled. Others are shared (CNG, car ride): one fare whoever went. A return trip doubles the limit.
--  * When two or more travel together, one person claims and names who was with them. Those people cannot claim
--    the same trip again (same day and same project, or the same destination when there is no project).
--  * The COO approves (the Principal approves the COO's own claims). Accounts pays approved claims once a month,
--    separately from salary, from Books; the payment is recorded in Books and each claim is marked paid.
--  * Claims can be made for this month and last month only, never for a future date.
--  * Every claim has an ID (CV-0001 …). When there is a paper bill (a shop bill, a printed ride receipt), the person
--    writes that ID on it and hands it to Accounts; the claim says whether there is one.
-- Writes go only through the functions below; nobody edits the tables directly.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

create table if not exists public.conv_types (
  id text primary key,
  label text not null,
  limit_amt numeric not null default 0 check (limit_amt >= 0),
  per_person boolean not null default false,
  active boolean not null default false,
  sort int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.conv_types (id, label, per_person, sort) values
  ('rickshaw', 'Rickshaw', true, 10), ('cng', 'CNG', false, 20), ('car', 'Uber or Pathao car', false, 30),
  ('bike', 'Bike ride (Pathao, Uber Moto)', true, 40), ('bus', 'Bus or metro', true, 50), ('other', 'Other', false, 90)
on conflict (id) do nothing;

create sequence if not exists public.conv_claim_no;
create table if not exists public.conv_claims (
  id text primary key default ('CV-' || lpad(nextval('public.conv_claim_no')::text, 4, '0')),
  user_id uuid not null references public.profiles(id),
  trip_date date not null,
  project_id text,
  purpose text not null check (purpose in ('site', 'client', 'authority', 'consultant', 'market', 'errand', 'other')),
  from_place text not null,
  to_place text not null,
  mode text not null references public.conv_types(id),
  people uuid[] not null default '{}',
  round_trip boolean not null default false,
  paper_bill boolean not null default false,
  amount numeric not null check (amount > 0),
  limit_at numeric not null,
  note text not null default '',
  status text not null default 'submitted' check (status in ('submitted', 'returned', 'approved', 'rejected', 'cancelled', 'paid')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  voucher_id text,
  voucher_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conv_claims_user on public.conv_claims (user_id, trip_date);
create index if not exists conv_claims_status on public.conv_claims (status, trip_date);

alter table public.conv_types enable row level security;
alter table public.conv_claims enable row level security;
revoke all on public.conv_types, public.conv_claims from anon;
revoke insert, update, delete on public.conv_types, public.conv_claims from authenticated;
grant select on public.conv_types, public.conv_claims to authenticated;
revoke all on sequence public.conv_claim_no from anon, authenticated;

-- who pays: the Books accountant (with the PIN), or the Principal and the COO (with the PIN)
create or replace function private.conv_payer() returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(private.is_active(), false) and private.pin_ok()
     and (private.is_owner() or private.is_coo() or coalesce(private.books_role(), '') = 'Accountant')
$$;

drop policy if exists conv_types_read on public.conv_types;
create policy conv_types_read on public.conv_types for select to authenticated using (coalesce(private.is_active(), false));

drop policy if exists conv_claims_read on public.conv_claims;
create policy conv_claims_read on public.conv_claims for select to authenticated using (
  coalesce(private.is_active(), false) and (
    user_id = auth.uid() or auth.uid() = any(people)
    or private.is_owner() or private.is_coo()
    or (status in ('approved', 'paid') and private.conv_payer())));

create or replace function private.conv_name(p uuid) returns text
language sql stable security definer set search_path to '' as $$
  select coalesce(nullif(x.label, ''), x.full_name, 'Someone') from public.profiles x where x.id = p
$$;

-- make or change a claim (your own, while it is waiting or was returned to you)
create or replace function public.conv_submit(p jsonb) returns text
language plpgsql security definer set search_path to '' as $$
declare
  me uuid := auth.uid(); c public.conv_claims; t public.conv_types; d date; ppl uuid[]; allowed numeric; amt numeric;
  prj text := nullif(trim(coalesce(p->>'project', '')), ''); dup record; td date := (now() at time zone 'Asia/Dhaka')::date;
  pur text := coalesce(p->>'purpose', ''); fr text := trim(coalesce(p->>'from', '')); tp text := trim(coalesce(p->>'to', ''));
  rt boolean := coalesce((p->>'round')::boolean, false); pb boolean := coalesce((p->>'paperBill')::boolean, false); nt text := trim(coalesce(p->>'note', '')); newid text; coo uuid;
begin
  if me is null or not coalesce(private.is_active(), false) then raise exception 'Sign in again, then try.'; end if;
  if p ? 'id' and nullif(p->>'id', '') is not null then
    select * into c from public.conv_claims where id = p->>'id' for update;
    if c.id is null or c.user_id <> me then raise exception 'This claim isn''t yours.'; end if;
    if c.status not in ('submitted', 'returned') then raise exception 'This claim has already been %; it can''t be changed.', c.status; end if;
  end if;
  begin d := (p->>'date')::date; exception when others then raise exception 'Choose the date of the trip.'; end;
  if d is null then raise exception 'Choose the date of the trip.'; end if;
  if d > td then raise exception 'The trip date can''t be in the future.'; end if;
  if d < date_trunc('month', td - interval '1 month')::date then raise exception 'Claims are for this month and last month only.'; end if;
  if pur not in ('site', 'client', 'authority', 'consultant', 'market', 'errand', 'other') then raise exception 'Choose what the trip was for.'; end if;
  if prj is not null and not exists (select 1 from public.docs where coll = 'projects' and doc_id = prj) then raise exception 'Choose the project again.'; end if;
  if prj is null and pur in ('site') then raise exception 'Choose the project for a site visit.'; end if;
  if prj is null and nt = '' then raise exception 'Without a project, add a note saying what the trip was for.'; end if;
  if fr = '' or tp = '' then raise exception 'Enter where you went from and to.'; end if;
  select * into t from public.conv_types where id = p->>'mode';
  if t.id is null or not t.active or t.limit_amt <= 0 then raise exception 'Choose how you travelled.'; end if;
  select coalesce(array_agg(distinct x), '{}') into ppl from (select (jsonb_array_elements_text(coalesce(p->'people', '[]'::jsonb)))::uuid x) s where x <> me;
  if exists (select 1 from unnest(ppl) x where not exists (select 1 from public.profiles pr where pr.id = x and pr.active)) then raise exception 'Choose the people who were with you again.'; end if;
  begin amt := round((p->>'amount')::numeric, 2); exception when others then raise exception 'Enter the amount.'; end;
  if amt is null or amt <= 0 then raise exception 'Enter the amount.'; end if;
  allowed := t.limit_amt * (case when t.per_person then 1 + cardinality(ppl) else 1 end) * (case when rt then 2 else 1 end);
  if amt > allowed then raise exception 'The most you can claim for this trip is Tk %.', to_char(allowed, 'FM999,999,990'); end if;
  -- the same trip, claimed twice (one claim at a time per day, so two people pressing Send together can't both get through)
  perform pg_advisory_xact_lock(hashtext('conv:' || d::text));
  for dup in select x.id, x.user_id, x.people from public.conv_claims x
     where x.trip_date = d and x.status not in ('cancelled', 'rejected') and x.id is distinct from c.id
       and (case when prj is not null then x.project_id = prj else x.project_id is null and lower(x.to_place) = lower(tp) end)
       and (array[x.user_id] || x.people) && (array[me] || ppl) loop
    raise exception '% already claimed this trip (%). Only one person claims for a trip taken together.',
      case when dup.user_id = me then 'You have' else private.conv_name(dup.user_id) || ' has' end, dup.id;
  end loop;

  if c.id is null then
    insert into public.conv_claims (user_id, trip_date, project_id, purpose, from_place, to_place, mode, people, round_trip, paper_bill, amount, limit_at, note)
    values (me, d, prj, pur, left(fr, 120), left(tp, 120), t.id, ppl, rt, pb, amt, allowed, left(nt, 300)) returning id into newid;
  else
    update public.conv_claims set trip_date = d, project_id = prj, purpose = pur, from_place = left(fr, 120), to_place = left(tp, 120), mode = t.id,
      people = ppl, round_trip = rt, paper_bill = pb, amount = amt, limit_at = allowed, note = left(nt, 300), status = 'submitted', updated_at = now()
    where id = c.id;
    newid := c.id;
  end if;
  -- tell whoever approves it
  for coo in select id from public.profiles where active and (case when private.is_coo() then designation = 'principal' else designation = 'coo' end) loop
    perform private.notify(coo, 'conveyance', 'Conveyance claim ' || newid, private.conv_name(me) || ' claimed Tk ' || to_char(amt, 'FM999,999,990') || ' for ' || t.label || ', ' || fr || ' to ' || tp || ' on ' || to_char(d, 'DD Mon') || '.');
  end loop;
  return newid;
end $$;

create or replace function public.conv_cancel(p_id text) returns void
language plpgsql security definer set search_path to '' as $$
begin
  update public.conv_claims set status = 'cancelled', updated_at = now()
  where id = p_id and user_id = auth.uid() and status in ('submitted', 'returned');
  if not found then raise exception 'Only your own claim, before it is approved, can be cancelled.'; end if;
end $$;

-- the COO (or the Principal) approves, returns for a change, or rejects
create or replace function public.conv_decide(p_ids text[], p_action text, p_note text default '') returns int
language plpgsql security definer set search_path to '' as $$
declare r public.conv_claims; n int := 0; owner boolean := private.is_owner(); coo boolean := private.is_coo();
begin
  if not (owner or coo) or not coalesce(private.is_active(), false) then raise exception 'Only the COO or the Principal approves conveyance.'; end if;
  if p_action not in ('approve', 'return', 'reject') then raise exception 'Unknown action'; end if;
  if p_action in ('return', 'reject') and trim(coalesce(p_note, '')) = '' then raise exception 'Say why, so they know what to change.'; end if;
  for r in select * from public.conv_claims where id = any(p_ids) for update loop
    if r.status <> 'submitted' then raise exception 'Claim % is already %.', r.id, r.status; end if;
    if r.user_id = auth.uid() then raise exception 'You can''t approve your own claim (%).', r.id; end if;
    if not owner and exists (select 1 from public.profiles where id = r.user_id and designation in ('principal', 'coo')) then raise exception 'Only the Principal approves this claim (%).', r.id; end if;
    update public.conv_claims set status = case p_action when 'approve' then 'approved' when 'return' then 'returned' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = r.id;
    perform private.notify(r.user_id, 'conveyance', 'Conveyance ' || r.id || ' ' || case p_action when 'approve' then 'approved' when 'return' then 'returned to you' else 'not approved' end,
      'Tk ' || to_char(r.amount, 'FM999,999,990') || ', ' || r.from_place || ' to ' || r.to_place || ' on ' || to_char(r.trip_date, 'DD Mon') || '.'
      || case when p_action = 'approve' then ' Accounts pays it with this month''s conveyance.' else ' ' || trim(p_note) end);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Accounts records the monthly payment in Books, then marks those claims paid
create or replace function public.conv_mark_paid(p_ids text[], p_voucher text, p_voucher_no text) returns int
language plpgsql security definer set search_path to '' as $$
declare r public.conv_claims; n int := 0;
begin
  if not private.conv_payer() then raise exception 'Only Accounts, the COO or the Principal records conveyance payments (with the PIN).'; end if;
  if coalesce(p_voucher, '') = '' or not exists (select 1 from public.books_docs where path = 'vouchers/' || p_voucher) then raise exception 'Record the payment in Books first.'; end if;
  for r in select * from public.conv_claims where id = any(p_ids) for update loop
    if r.status <> 'approved' then raise exception 'Claim % is %, not approved.', r.id, r.status; end if;
    update public.conv_claims set status = 'paid', paid_at = now(), paid_by = auth.uid(), voucher_id = p_voucher, voucher_no = p_voucher_no, updated_at = now() where id = r.id;
    perform private.notify(r.user_id, 'conveyance', 'Conveyance ' || r.id || ' paid', 'Tk ' || to_char(r.amount, 'FM999,999,990') || ' paid by Accounts (' || coalesce(p_voucher_no, '') || ').');
    n := n + 1;
  end loop;
  return n;
end $$;

-- the Principal sets the kinds of transport and their limits
create or replace function public.conv_set_types(p jsonb) returns void
language plpgsql security definer set search_path to '' as $$
declare x jsonb;
begin
  if not private.is_owner() then raise exception 'Only the Principal sets conveyance limits.'; end if;
  for x in select * from jsonb_array_elements(p) loop
    if coalesce(x->>'id', '') !~ '^[a-z0-9_-]{2,20}$' or trim(coalesce(x->>'label', '')) = '' then raise exception 'Each kind needs a name.'; end if;
    insert into public.conv_types (id, label, limit_amt, per_person, active, sort, updated_at, updated_by)
    values (x->>'id', left(trim(x->>'label'), 40), greatest(coalesce((x->>'limit')::numeric, 0), 0), coalesce((x->>'perPerson')::boolean, false),
            coalesce((x->>'active')::boolean, false), coalesce((x->>'sort')::int, 0), now(), auth.uid())
    on conflict (id) do update set label = excluded.label, limit_amt = excluded.limit_amt, per_person = excluded.per_person,
      active = excluded.active, sort = excluded.sort, updated_at = now(), updated_by = auth.uid();
  end loop;
end $$;

revoke all on function public.conv_submit(jsonb), public.conv_cancel(text), public.conv_decide(text[], text, text),
  public.conv_mark_paid(text[], text, text), public.conv_set_types(jsonb) from public, anon;
grant execute on function public.conv_submit(jsonb), public.conv_cancel(text), public.conv_decide(text[], text, text),
  public.conv_mark_paid(text[], text, text), public.conv_set_types(jsonb) to authenticated;

commit;
