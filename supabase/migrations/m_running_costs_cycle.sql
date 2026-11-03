-- SLATE OS · Running costs that are not monthly: every 3 months, every 6 months or once a year (3 Nov 2026)
--
-- Business › Running costs gets "How often": Monthly (as before), Every 3 months, Every 6 months, Every year.
-- Kept on recurring/<id> as every = 1, 3, 6 or 12 (missing = 1, so every cost set up so far stays monthly).
-- For a cost that is not monthly, "from" is the first month it falls due; it then falls due every N months after that.
--
--  * private.rc_every: 1, 3, 6 or 12. Office rent with an advance is always monthly.
--  * private.rc_make_due: adds an entry only in the months a cost falls due (from, from + N, from + 2N, ...).
--  * private.rc_estimate: Variable costs use the average of the last 3 confirmed bills of that cost (so the last 3
--    quarters, half-years or years); Seasonal uses the bill 12 months earlier once a year of bills exists.
--  * Trigger books_rc: "every" must be 1, 3, 6 or 12; office rent with an advance must be monthly.
--  * private.rc_soon: 30 days before a cost that is not monthly falls due, the COO is told once (amount, due date,
--    cash point), so cash can be arranged for big bills. Kept in private.rc_warned so it is sent only once per due date.
--    Run daily with the running-costs job (06:05 Dhaka).
--  * Overhead: the app spreads the bill evenly over the months it covers (prepaid: the due month and the months after;
--    postpaid: the months before the due month). Cash still goes out in full in the due month. No extra vouchers.
-- Run once in the Supabase SQL editor (from a computer). One transaction: if any step fails, nothing changes.

begin;

create or replace function private.rc_every(d jsonb) returns int
language sql immutable set search_path = '' as
$$ select case when coalesce(d->>'kind', '') = 'rent' then 1
               when coalesce(d->>'every', '') in ('3', '6', '12') then (d->>'every')::int else 1 end $$;

-- does this cost fall due in month p_ym?
create or replace function private.rc_due_in(d jsonb, p_ym text) returns boolean
language sql immutable set search_path = '' as
$$ select coalesce(nullif(d->>'from', ''), '2026-11') <= p_ym
      and (coalesce(d->>'until', '') = '' or p_ym <= d->>'until')
      and mod(private.rc_ym_diff(coalesce(nullif(d->>'from', ''), '2026-11'), p_ym), private.rc_every(d)) = 0 $$;

-- what a cost is expected to be when it falls due in p_ym
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
  -- seasonal: once a year of bills exists (12 monthly, 4 quarterly, 2 half-yearly), the bill 12 months earlier
  if coalesce(c->>'seasonal', '') = 'true' and coalesce(array_length(amts, 1), 0) >= 12 / private.rc_every(c) then
    select private.rc_num(d.data, 'amount') into same from public.books_docs d
     where d.path = 'rcmonth/' || private.rc_ym_add(p_ym, -12) || '~' || p_id and d.data->>'status' = 'confirmed';
    if same is not null then return round(same); end if;
  end if;
  if coalesce(array_length(amts, 1), 0) > 0 then return round((select avg(v) from unnest(amts[1:3]) v)); end if;
  return private.rc_num(c, 'est');
end $$;

-- add the entries whose due day has come, only in the months each cost falls due
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
      continue when not private.rc_due_in(d, ym);
      dd := least(greatest(coalesce(nullif(regexp_replace(coalesce(d->>'day', ''), '\D', '', 'g'), '')::int, 1), 1),
                  extract(day from ((ym || '-01')::date + interval '1 month - 1 day'))::int);
      due := (ym || '-' || lpad(dd::text, 2, '0'))::date;
      continue when due > t;
      continue when exists (select 1 from public.books_docs x where x.path = 'rcmonth/' || ym || '~' || c.doc_id);
      insert into public.books_docs (path, coll, doc_id, data)
      values ('rcmonth/' || ym || '~' || c.doc_id, 'rcmonth', ym || '~' || c.doc_id,
        jsonb_build_object('cost', c.doc_id, 'month', ym, 'due', due::text, 'name', d->>'name', 'kind', coalesce(nullif(d->>'kind', ''), 'fixed'),
          'every', private.rc_every(d), 'est', private.rc_estimate(c.doc_id, d, ym), 'status', 'due',
          'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
      on conflict (path) do nothing;
      n := n + 1;
    end loop;
  end loop;
  perform set_config('slate.rc_sync', '', true);
  return n;
end $$;

-- heads-up 30 days before a quarterly, half-yearly or yearly cost falls due (once per due date)
create table if not exists private.rc_warned (cost text not null, due date not null, at timestamptz not null default now(), primary key (cost, due));
revoke all on private.rc_warned from public, anon, authenticated;

create or replace function private.rc_soon() returns int
language plpgsql security definer set search_path = '' as $$
declare t date := (now() at time zone 'Asia/Dhaka')::date; c record; d jsonb; ev int; ym text; dd int; due date; est numeric; n int := 0; i int;
begin
  for c in select b.doc_id, b.data from public.books_docs b where b.coll = 'recurring' loop
    d := c.data; ev := private.rc_every(d);
    continue when ev = 1 or coalesce(d->>'active', 'true') = 'false';
    -- the due dates in the next 30 days (this month and next)
    for i in 0..1 loop
      ym := private.rc_ym_add(to_char(t, 'YYYY-MM'), i);
      continue when not private.rc_due_in(d, ym);
      dd := least(greatest(coalesce(nullif(regexp_replace(coalesce(d->>'day', ''), '\D', '', 'g'), '')::int, 1), 1),
                  extract(day from ((ym || '-01')::date + interval '1 month - 1 day'))::int);
      due := (ym || '-' || lpad(dd::text, 2, '0'))::date;
      continue when due <= t or due > t + 30;
      continue when exists (select 1 from private.rc_warned w where w.cost = c.doc_id and w.due = due);
      est := private.rc_estimate(c.doc_id, d, ym);
      insert into private.rc_warned (cost, due) values (c.doc_id, due) on conflict do nothing;
      insert into public.notifications (user_id, kind, title, body)
      select pr.id, 'account', 'Running cost due in ' || (due - t) || ' days',
             left(coalesce(d->>'name', 'A running cost') || ' (' || case ev when 3 then 'every 3 months' when 6 then 'every 6 months' else 'yearly' end || '): '
               || case when coalesce(d->>'kind', '') = 'variable' then 'about ' else '' end || 'Tk ' || to_char(est, 'FM99,99,99,990')
               || ' due ' || to_char(due, 'FMDD Mon YYYY')
               || coalesce(' from ' || (select l.data->>'name' from public.books_docs l where l.path = 'ledgers/' || coalesce(d->>'acc', '')), '')
               || '. Keep the cash ready; it appears in Books › Monthly entries on the due day.', 500)
        from public.profiles pr where pr.active and pr.designation = 'coo';
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

create or replace function private.rc_daily() returns void
language plpgsql security definer set search_path = '' as $$
begin perform private.rc_make_due(); perform private.rc_soon(); end $$;

-- the rules: same as before, plus "every"
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
    if coalesce(d->>'every', '1') not in ('1', '3', '6', '12') then raise exception 'How often: monthly, every 3 months, every 6 months or every year'; end if;
    if d->>'kind' = 'rent' and coalesce(d->>'every', '1') <> '1' then raise exception 'Office rent with an advance is paid every month'; end if;
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
    if d->>'kind' = 'fixed' and private.rc_num(d, 'amount') <= 0 then raise exception 'Enter the amount'; end if;
    if d->>'kind' = 'rent' and private.rc_num(d, 'rent') <= 0 then raise exception 'Enter the monthly rent'; end if;
    return new;
  end if;

  if k = 'rcmonth' then
    if tg_op = 'INSERT' then raise exception 'SLATE OS adds each entry on the cost''s due day'; end if;
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

revoke all on function private.rc_every(jsonb), private.rc_due_in(jsonb, text), private.rc_estimate(text, jsonb, text), private.rc_make_due(),
  private.rc_soon(), private.rc_daily(), private.books_rc() from public, anon, authenticated;

-- the daily job now also sends the 30-day heads-up
select cron.unschedule(jobid) from cron.job where jobname = 'slate-running-costs';
select cron.schedule('slate-running-costs', '5 0 * * *', 'select private.rc_daily()');
select private.rc_soon();

commit;
