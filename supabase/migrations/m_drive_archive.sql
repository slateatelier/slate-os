-- SLATE OS · Google Drive bills archive (3 Nov 2026), applied as drive_archive
-- Bill photos stay in the private storage bucket 'books' (the working copy). Every night the Edge Function
-- 'drive-archive' copies any file uploaded in an earlier month and not yet archived to
--   SLATE OS Archive / Bills / YYYY-MM /   (named date · ref · party · amount)
-- and refreshes that month's "Bills index YYYY-MM" sheet. The current month is copied after it ends.
-- Drive access: Google account slateos.archive@gmail.com, scope drive.file; the OAuth secrets live only in
-- Supabase Edge Function secrets (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN).
-- All tables are private; the function reaches them through service-role-only RPCs.

create table if not exists private.drive_cfg (
  id int primary key default 1 check (id = 1),
  cron_token text not null default encode(extensions.gen_random_bytes(24), 'hex')
);
insert into private.drive_cfg (id) values (1) on conflict do nothing;

create table if not exists private.drive_folders (   -- Drive folder / index ids, by key ('root', 'bills', 'bills/2026-11', 'index/2026-11')
  key text primary key,
  drive_id text not null,
  at timestamptz not null default now()
);
create table if not exists private.drive_files (     -- one row per storage object copied to Drive
  object_name text primary key,
  month text not null,
  drive_id text not null,
  drive_name text not null,
  kind text not null default '',
  doc_date text not null default '',
  ref text not null default '',
  party text not null default '',
  amount numeric,
  size_bytes bigint,
  uploaded_at timestamptz,
  archived_at timestamptz not null default now()
);
create index if not exists drive_files_month on private.drive_files (month);
create table if not exists private.drive_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null default 'cron',
  ok boolean,
  copied int not null default 0,
  pending int not null default 0,
  note text not null default ''
);
alter table private.drive_cfg enable row level security;
alter table private.drive_folders enable row level security;
alter table private.drive_files enable row level security;
alter table private.drive_runs enable row level security;

-- review logins never write (same guard as every other table)
do $$
declare t text;
begin
  foreach t in array array['drive_cfg', 'drive_folders', 'drive_files', 'drive_runs'] loop
    execute format('drop trigger if exists zz_reviewer_guard on private.%I', t);
    execute format('create trigger zz_reviewer_guard before insert or update or delete on private.%I for each row execute function private.reviewer_guard()', t);
  end loop;
end $$;

/* ---------- RPCs for the Edge Function (service role only) ---------- */
create or replace function public.drive_cron_ok(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_token, '') <> '' and exists (select 1 from private.drive_cfg where cron_token = p_token)
$$;

-- files in 'books' uploaded before the start of the current Dhaka month and not yet archived,
-- with the Books records that point at them
create or replace function public.drive_pending(p_limit int default 200) returns table (
  object_name text, mime text, size_bytes bigint, uploaded_at timestamptz, month text, docs jsonb)
language sql stable security definer set search_path = '' as $$
  select o.name, coalesce(o.metadata->>'mimetype', ''), (o.metadata->>'size')::bigint, o.created_at,
         to_char(o.created_at at time zone 'Asia/Dhaka', 'YYYY-MM'),
         coalesce((select jsonb_agg(jsonb_build_object('coll', d.coll, 'path', d.path, 'data', d.data))
                     from public.books_docs d where position(o.name in d.data::text) > 0), '[]'::jsonb)
    from storage.objects o
   where o.bucket_id = 'books'
     and o.created_at < date_trunc('month', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka'
     and not exists (select 1 from private.drive_files f where f.object_name = o.name)
   order by o.created_at
   limit greatest(1, least(p_limit, 1000))
$$;

create or replace function public.drive_pending_count() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from storage.objects o
   where o.bucket_id = 'books'
     and o.created_at < date_trunc('month', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka'
     and not exists (select 1 from private.drive_files f where f.object_name = o.name)
$$;

create or replace function public.drive_ledger_names() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(replace(path, 'ledgers/', ''), data->>'name'), '{}'::jsonb)
    from public.books_docs where coll = 'ledgers'
$$;

create or replace function public.drive_folder(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select drive_id from private.drive_folders where key = p_key
$$;
create or replace function public.drive_folder_set(p_key text, p_id text) returns void
language sql security definer set search_path = '' as $$
  insert into private.drive_folders (key, drive_id) values (p_key, p_id)
  on conflict (key) do update set drive_id = excluded.drive_id, at = now()
$$;

create or replace function public.drive_file_done(p jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into private.drive_files (object_name, month, drive_id, drive_name, kind, doc_date, ref, party, amount, size_bytes, uploaded_at)
  values (p->>'object_name', p->>'month', p->>'drive_id', p->>'drive_name', coalesce(p->>'kind', ''), coalesce(p->>'doc_date', ''),
          coalesce(p->>'ref', ''), coalesce(p->>'party', ''), nullif(p->>'amount', '')::numeric, nullif(p->>'size_bytes', '')::bigint,
          nullif(p->>'uploaded_at', '')::timestamptz)
  on conflict (object_name) do nothing
$$;

create or replace function public.drive_month_files(p_month text) returns setof jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(f) from private.drive_files f where f.month = p_month order by f.doc_date, f.uploaded_at
$$;

create or replace function public.drive_run_start(p_trigger text) returns bigint
language sql security definer set search_path = '' as $$
  insert into private.drive_runs (trigger) values (coalesce(p_trigger, 'cron')) returning id
$$;
create or replace function public.drive_run_end(p_id bigint, p_ok boolean, p_copied int, p_pending int, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update private.drive_runs set finished_at = now(), ok = p_ok, copied = p_copied, pending = p_pending, note = left(coalesce(p_note, ''), 2000)
   where id = p_id;
  -- tell the Principal: when a month's bills are all archived, or when a run fails (once a day at most)
  if not p_ok and not exists (select 1 from private.drive_runs r where r.id <> p_id and r.ok = false and r.started_at > now() - interval '20 hours') then
    insert into public.notifications (user_id, kind, title, body)
    select p.id, 'account', 'Drive archive didn’t run', left('Bill photos weren’t copied to Google Drive tonight. ' || coalesce(p_note, ''), 500)
      from public.profiles p where p.active and p.designation = 'principal';
  elsif p_ok and p_copied > 0 and p_pending = 0 then
    insert into public.notifications (user_id, kind, title, body)
    select p.id, 'account', 'Bills archived to Google Drive',
           p_copied || ' bill photo' || case when p_copied = 1 then '' else 's' end || ' copied to SLATE OS Archive › Bills, with the month’s index sheet.'
      from public.profiles p where p.active and p.designation = 'principal';
  end if;
end $$;

-- who may run it by hand (Principal and COO), checked by the function with the caller's own token
create or replace function public.drive_can_run() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.designation in ('principal', 'coo'))
$$;

do $$
declare f text;
begin
  foreach f in array array['drive_cron_ok(text)', 'drive_pending(int)', 'drive_pending_count()', 'drive_ledger_names()', 'drive_folder(text)',
                           'drive_folder_set(text,text)', 'drive_file_done(jsonb)', 'drive_month_files(text)', 'drive_run_start(text)',
                           'drive_run_end(bigint,boolean,int,int,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.drive_can_run() from public, anon;
grant execute on function public.drive_can_run() to authenticated;

/* ---------- every night at 03:17 Dhaka (21:17 UTC) ---------- */
select cron.unschedule('slate-drive-archive') where exists (select 1 from cron.job where jobname = 'slate-drive-archive');
select cron.schedule('slate-drive-archive', '17 21 * * *', $cron$
  select net.http_post(
    url := 'https://fbktoepdfegtkazbytel.supabase.co/functions/v1/drive-archive',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-slate-cron', (select cron_token from private.drive_cfg where id = 1)),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 5000)
$cron$);
