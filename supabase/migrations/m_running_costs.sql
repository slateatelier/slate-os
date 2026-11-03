-- SLATE OS · Running costs and monthly entries in one place (3 Nov 2026)
--
-- Business › Running costs (Principal and COO) is now the only place a monthly cost is set up. Each cost is kept in Books as
-- recurring/<id>. On each cost's due day SLATE OS adds that month's entry to Books › More › Monthly entries as
-- rcmonth/<YYYY-MM>~<id>, marked "Amount to confirm". It is not in the books yet: the Accountant confirms it (Fixed: one tap;
-- Variable: the actual amount and the bill photo), which makes an ordinary Books payment that goes through the normal
-- check and approval. A bill more than the limit above its estimate (Books › More › Settings, 20% unless set) is flagged
-- to the COO and cannot be approved without a remark.
--
--  * private.rc_estimate: Fixed = the amount; office rent with an advance = the cash part (unchanged rule); Variable = the
--    average of the last 3 months' confirmed bills, or the same month last year once 12 months exist (seasonal costs such
--    as electricity), else the first estimate the COO set.
--  * private.rc_make_due: adds the month's entries whose due day has come (this month and anything missed last month).
--    Run daily at 06:05 Dhaka by pg_cron, and by Books when it opens (public.books_rc_due).
--  * Trigger books_rc: running costs only by the Principal or the COO; monthly entries only made by SLATE OS, skipped or
--    un-skipped by the Principal or the COO; a payment confirming a month carries rc{id, month} and gets the estimate,
--    the variance and the over-limit flag written in by the database; approval refused while over the limit with no remark.
--  * Trigger books_rc_sync: the monthly entry follows its payment (confirmed, amount, kWh); back to "to confirm" if the
--    payment is cancelled. The COO is notified when a bill is over the limit.
--  * OFFICE RENT becomes a Fixed running cost from Nov 2026 (Tk 1,10,000 on the 1st, Cash in SLATE vault, Office Rent,
--    Studio overhead). Vouchers already posted are not touched. "SLATE growth – Principal" stays deleted.
-- Run once in the Supabase SQL editor. One transaction: if any step fails, nothing changes.

begin;

create or replace function private.rc_ym_add(p_ym text, p_n int) returns text
language sql immutable set search_path = '' as
$$ select to_char((p_ym || '-01')::date + make_interval(months => p_n), 'YYYY-MM') $$;

create or replace function private.rc_ym_diff(a text, b text) returns int
language sql immutable set search_path = '' as
$$ select (split_part(b, '-', 1)::int - split_part(a, '-', 1)::int) * 12 + split_part(b, '-', 2)::int - split_part(a, '-', 2)::int $$;

create or replace function private.rc_num(j jsonb, k text) returns numeric
language sql immutable set search_path = '' as
$$ select case when coalesce(j->>k, '') ~ '^-?\d+(\.\d+)?$' then (j->>k)::numeric else 0 end $$;

-- what a cost is expected to be in a month
create or replace function private.rc_estimate(p_id text, c jsonb, p_ym text) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare k text := coalesce(nullif(c->>'kind', ''), 'fixed'); r numeric; a numeric; x numeric; n int; bef numeric; amts numeric[]; same numeric;
begin
  if k = 'rent' then  -- same rule as before: the advance is adjusted from advFrom at `adjust` a month; the rest is cash
    r := private.rc_num(c, 'rent'); a := private.rc_num(c, 'advance'); x := private.rc_num(c, 'adjust');
    n := private.rc_ym_diff(coalesce(nullif(c->>'advFrom', ''), c->>'from'), p_ym) + 1;
    if n < 1 or a = 0 or x = 0 then return r; end if;
    bef := greatest(0, a - x * (n - 1));
    return r - least(x, bef, r);
  end if;
  if k <> 'variable' then return private.rc_num(c, 'amount'); end if;
  select array_agg(s.amt order by s.m desc) into amts from (
    select d.data->>'month' m, private.rc_num(d.data, 'amount') amt from public.books_docs d
     where d.coll = 'rcmonth' and d.data->>'cost' = p_id and d.data->>'status' = 'confirmed' and d.data->>'month' < p_ym) s;
  if coalesce(c->>'seasonal', '') = 'true' and coalesce(array_length(amts, 1), 0) >= 12 then
    select private.rc_num(d.data, 'amount') into same from public.books_docs d
     where d.path = 'rcmonth/' || private.rc_ym_add(p_ym, -12) || '~' || p_id and d.data->>'status' = 'confirmed';
    if same is not null then return round(same); end if;
  end if;
  if coalesce(array_length(amts, 1), 0) > 0 then return round((select avg(v) from unnest(amts[1:3]) v)); end if;
  return private.rc_num(c, 'est');
end $$;

-- add the month's entries whose due day has come
create or replace function private.rc_make_due() returns int
language plpgsql security definer set search_path = '' as $$
declare t date := (now() at time zone 'Asia/Dhaka')::date; ym text; c record; d jsonb; dd int; due date; n int := 0; cut constant text := '2026-11';
begin
  perform set_config('slate.rc_sync', '1', true);
  foreach ym in array array[private.rc_ym_add(to_char(t, 'YYYY-MM'), -1), to_char(t, 'YYYY-MM')] loop
    continue when ym < cut;
    for c in select b.doc_id, b.data from public.books_docs b where b.coll = 'recurring' loop
      d := c.data;
      continue when coalesce(d->>'active', 'true') = 'false';
      continue when greatest(coalesce(nullif(d->>'from', ''), cut), cut) > ym;
      continue when coalesce(d->>'until', '') <> '' and d->>'until' < ym;
      dd := least(greatest(coalesce(nullif(regexp_replace(coalesce(d->>'day', ''), '\D', '', 'g'), '')::int, 1), 1),
                  extract(day from ((ym || '-01')::date + interval '1 month - 1 day'))::int);
      due := (ym || '-' || lpad(dd::text, 2, '0'))::date;
      continue when due > t;
      continue when exists (select 1 from public.books_docs x where x.path = 'rcmonth/' || ym || '~' || c.doc_id);
      insert into public.books_docs (path, coll, doc_id, data)
      values ('rcmonth/' || ym || '~' || c.doc_id, 'rcmonth', ym || '~' || c.doc_id,
        jsonb_build_object('cost', c.doc_id, 'month', ym, 'due', due::text, 'name', d->>'name', 'kind', coalesce(nullif(d->>'kind', ''), 'fixed'),
          'est', private.rc_estimate(c.doc_id, d, ym), 'status', 'due', 'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
      on conflict (path) do nothing;
      n := n + 1;
    end loop;
  end loop;
  perform set_config('slate.rc_sync', '', true);
  return n;
end $$;

-- Books calls this when it opens, so a cost due today appears straight away
create or replace function public.books_rc_due() returns int
language plpgsql security definer set search_path = '' as $$
begin
  if private.books_role() is null or private.books_role() not in ('Principal', 'COO', 'Accountant') then return 0; end if;
  return private.rc_make_due();
end $$;

-- the rules
create or replace function private.books_rc() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text := regexp_replace(coalesce(new.path, old.path), '/[^/]+$', ''); r text; d jsonb; m jsonb; rc jsonb; vid text;
  amt numeric; est numeric; lim numeric; ov boolean; ns text; os text; keep constant text[] := array['status', 'skipNote', 'skipBy', 'skipAt'];
begin
  if k not in ('recurring', 'rcmonth', 'vouchers') then return coalesce(new, old); end if;
  if auth.uid() is null or coalesce(current_setting('slate.rc_sync', true), '') = '1' or coalesce(current_setting('slate.books_sync', true), '') = '1' then
    return coalesce(new, old);
  end if;
  r := coalesce(private.books_role(), '');

  if k = 'recurring' then
    if r not in ('Principal', 'COO') then raise exception 'Running costs are set up by the Principal or the COO in Business › Running costs'; end if;
    if tg_op = 'DELETE' then return old; end if;
    d := new.data;
    if coalesce(trim(d->>'name'), '') = '' then raise exception 'A running cost needs a name'; end if;
    if coalesce(d->>'kind', '') not in ('fixed', 'variable', 'rent') then raise exception 'Choose Fixed or Variable'; end if;
    if not exists (select 1 from public.books_docs l where l.path = 'ledgers/' || coalesce(d->>'cat', '')) then raise exception 'Choose the head of account'; end if;
    if not exists (select 1 from public.books_docs l where l.path = 'ledgers/' || coalesce(d->>'acc', '') and l.data->>'group' in ('cash', 'bank')) then
      raise exception 'Choose the cash point it is paid from';
    end if;
    if coalesce(d->>'day', '') !~ '^\d{1,2}$' or (d->>'day')::int not between 1 and 31 then raise exception 'The due day is a day of the month, 1 to 31'; end if;
    if coalesce(d->>'from', '') !~ '^\d{4}-\d{2}$' or (coalesce(d->>'until', '') <> '' and (d->>'until' !~ '^\d{4}-\d{2}$' or d->>'until' < d->>'from')) then
      raise exception 'Check the start and end months';
    end if;
    if least(private.rc_num(d, 'amount'), private.rc_num(d, 'est'), private.rc_num(d, 'rent'), private.rc_num(d, 'advance'),
             private.rc_num(d, 'adjust'), private.rc_num(d, 'deposit')) < 0 then raise exception 'Amounts can''t be negative'; end if;
    if d->>'kind' = 'fixed' and private.rc_num(d, 'amount') <= 0 then raise exception 'Enter the monthly amount'; end if;
    if d->>'kind' = 'rent' and private.rc_num(d, 'rent') <= 0 then raise exception 'Enter the monthly rent'; end if;
    return new;
  end if;

  if k = 'rcmonth' then
    if tg_op = 'INSERT' then raise exception 'SLATE OS adds each month''s entry on the cost''s due day'; end if;
    if tg_op = 'DELETE' then
      if r <> 'Principal' then raise exception 'Only the Principal removes a monthly entry'; end if;
      return old;
    end if;
    if r not in ('Principal', 'COO') then raise exception 'Only the Principal or the COO skips a month'; end if;
    if (new.data - keep) is distinct from (old.data - keep) then raise exception 'A monthly entry changes only through its Books payment'; end if;
    if coalesce(old.data->>'status', '') not in ('due', 'skipped') or coalesce(new.data->>'status', '') not in ('due', 'skipped') then
      raise exception 'A confirmed month can''t be skipped. Cancel its Books payment first';
    end if;
    return new;
  end if;

  -- vouchers: only payments that confirm a monthly entry
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and jsonb_typeof(old.data->'rc') = 'object' and jsonb_typeof(new.data->'rc') is distinct from 'object' then
    new.data := jsonb_set(new.data, '{rc}', old.data->'rc');  -- the link to the month stays
  end if;
  rc := new.data->'rc';
  if rc is null or jsonb_typeof(rc) <> 'object' then return new; end if;
  vid := regexp_replace(new.path, '^.*/', '');
  if tg_op = 'UPDATE' and jsonb_typeof(old.data->'rc') = 'object' and (old.data->'rc'->>'id', old.data->'rc'->>'month') is distinct from (rc->>'id', rc->>'month') then
    raise exception 'A payment stays with the month it confirmed';
  end if;
  select x.data into m from public.books_docs x where x.path = 'rcmonth/' || coalesce(rc->>'month', '') || '~' || coalesce(rc->>'id', '');
  if m is null then raise exception 'This monthly entry isn''t in Books › Monthly entries'; end if;
  if m->>'status' = 'skipped' then raise exception 'This month was skipped. Ask the COO to put it back first'; end if;
  if m->>'status' = 'confirmed' and coalesce(m->>'vid', '') <> vid
     and exists (select 1 from public.books_docs v where v.path = 'vouchers/' || (m->>'vid') and coalesce(v.data->>'status', '') not in ('void', 'split')) then
    raise exception 'This month is already confirmed';
  end if;
  amt := private.books_v_amount(new.data);
  est := private.rc_num(m, 'est');
  lim := coalesce(nullif((select private.rc_num(s.data, 'rcVar') from public.books_docs s where s.path = 'settings/main'), 0), 20);
  ov := est > 0 and amt > est * (1 + lim / 100);
  rc := rc || jsonb_build_object('est', est, 'lim', lim, 'over', ov, 'pct', case when est > 0 then round((amt - est) / est * 100) end);
  new.data := jsonb_set(new.data, '{rc}', rc);
  ns := coalesce(new.data->>'status', 'approved');
  os := case when tg_op = 'UPDATE' then coalesce(old.data->>'status', 'approved') end;
  if ov and coalesce(trim(rc->>'note'), '') = '' and ns = 'approved'
     and (os is distinct from 'approved' or (old.data->'lines') is distinct from (new.data->'lines')) then
    raise exception '%', 'This bill is ' || round((amt - est) / est * 100) || '% over the estimate of Tk ' || to_char(est, 'FM99,99,99,990')
      || '. Add a remark before it is approved';
  end if;
  return new;
end $$;

-- the monthly entry follows its payment
create or replace function private.books_rc_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rc jsonb := new.data->'rc'; p text; m jsonb; vid text := regexp_replace(new.path, '^.*/', ''); st text := coalesce(new.data->>'status', 'approved');
  amt numeric; was boolean;
begin
  if rc is null or jsonb_typeof(rc) <> 'object' then return null; end if;
  p := 'rcmonth/' || coalesce(rc->>'month', '') || '~' || coalesce(rc->>'id', '');
  select x.data into m from public.books_docs x where x.path = p;
  if m is null then return null; end if;
  perform set_config('slate.rc_sync', '1', true);
  if st in ('void', 'split') then
    if m->>'vid' = vid then
      update public.books_docs set data = (data - array['vid', 'vno', 'amount', 'kwh', 'over', 'pct', 'confirmedAt']) || '{"status":"due"}'::jsonb where path = p;
    end if;
  elsif coalesce(m->>'vid', '') in ('', vid) or m->>'status' <> 'confirmed' then
    amt := private.books_v_amount(new.data);
    update public.books_docs set data = data || jsonb_build_object('status', 'confirmed', 'vid', vid, 'vno', coalesce(new.data->>'no', ''), 'amount', amt,
        'kwh', coalesce(rc->'kwh', 'null'::jsonb), 'over', coalesce((rc->>'over')::boolean, false), 'pct', coalesce(rc->'pct', 'null'::jsonb),
        'confirmedAt', coalesce(m->>'confirmedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
     where path = p;
    was := tg_op = 'UPDATE' and coalesce((old.data->'rc'->>'over')::boolean, false);
    if coalesce((rc->>'over')::boolean, false) and not was and coalesce(trim(rc->>'note'), '') = '' then
      insert into public.notifications (user_id, kind, title, body)
      select pr.id, 'account', 'Bill over the estimate',
             left(coalesce(m->>'name', 'A running cost') || ' · ' || to_char((rc->>'month' || '-01')::date, 'Mon YYYY') || ': Tk ' || to_char(amt, 'FM99,99,99,990')
               || ', ' || coalesce(rc->>'pct', '?') || '% over the estimate of Tk ' || to_char(private.rc_num(rc, 'est'), 'FM99,99,99,990')
               || '. Add a remark when you check it in Books.', 500)
        from public.profiles pr where pr.active and pr.designation = 'coo';
    end if;
  end if;
  perform set_config('slate.rc_sync', '', true);
  return null;
end $$;

drop trigger if exists books_rc on public.books_docs;
create trigger books_rc before insert or update or delete on public.books_docs
  for each row execute function private.books_rc();
drop trigger if exists books_rc_sync on public.books_docs;
create trigger books_rc_sync after insert or update on public.books_docs
  for each row when (new.coll = 'vouchers') execute function private.books_rc_sync();

revoke all on function private.rc_ym_add(text, int), private.rc_ym_diff(text, text), private.rc_num(jsonb, text), private.rc_estimate(text, jsonb, text),
  private.rc_make_due(), private.books_rc(), private.books_rc_sync() from public, anon, authenticated;
revoke all on function public.books_rc_due() from public, anon;
grant execute on function public.books_rc_due() to authenticated;

-- OFFICE RENT becomes a Fixed running cost (the only running cost today)
update public.books_docs
   set data = data || '{"kind":"fixed","from":"2026-11","until":"","proj":"p00","payee":"","meter":"","paid":"pre","kwh":false,"seasonal":false,"est":0,"note":""}'::jsonb
 where path = 'recurring/rcmw0fef30dslubt' and coalesce(data->>'kind', '') = '';

-- daily at 06:05 Dhaka (00:05 UTC); then once now, so November's rent (due 1 Nov) is waiting to be confirmed
select cron.unschedule(jobid) from cron.job where jobname = 'slate-running-costs';
select cron.schedule('slate-running-costs', '5 0 * * *', 'select private.rc_make_due()');
select private.rc_make_due();

commit;
