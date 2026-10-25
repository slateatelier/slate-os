-- SLATE OS · Finance (ported from SLATE Ledger)
-- Finance lives in its own tables, never in the shared `docs` store.
-- Only the Principal (designation) and people on the finance allow-list (Mridula, COO) can read or write it.
-- No triggers here write to activity_log or notifications, so nothing about finance reaches anyone else.

-- 1. Who may use finance -------------------------------------------------------------
create table if not exists private.fin_access (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('coo')),          -- 'accountant' and 'petty' added later, when approved
  added_at timestamptz not null default now()
);
-- Mridula (COO). Named by account, not by designation, so giving someone else the COO title never opens finance.
insert into private.fin_access (user_id, role)
select id, 'coo' from public.profiles where id = '257542b1-e269-479a-94d9-6bb5a179f664'
on conflict (user_id) do nothing;

create or replace function private.fin_role()
returns text language sql stable security definer set search_path to '' as $$
  select case
    when exists (select 1 from public.profiles where id = auth.uid() and active and designation = 'principal') then 'principal'
    else (select a.role from private.fin_access a join public.profiles p on p.id = a.user_id
          where a.user_id = auth.uid() and p.active)
  end
$$;
create or replace function private.is_finance()
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(private.fin_role() in ('principal', 'coo'), false)
$$;
-- The app asks this only to decide whether to show the Finance link. It reveals nothing else.
create or replace function public.fin_role()
returns text language sql stable security definer set search_path to '' as $$ select private.fin_role() $$;
revoke all on function public.fin_role() from public, anon;
grant execute on function public.fin_role() to authenticated;

-- 2. Finance records -----------------------------------------------------------------
create table if not exists public.fin_docs (
  path text primary key check (path ~ '^[a-z]+/[A-Za-z0-9_-]{1,40}$'),
  coll text not null,
  doc_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists fin_docs_coll on public.fin_docs (coll);
create unique index if not exists fin_inv_no on public.fin_docs ((data->>'no')) where coll = 'invoices';
create unique index if not exists fin_proj_code on public.fin_docs ((upper(data->>'code'))) where coll = 'projects';
create unique index if not exists fin_proj_os on public.fin_docs ((data->>'osId')) where coll = 'projects' and coalesce(data->>'osId', '') <> '';

create table if not exists public.fin_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,
  path text not null,
  op text not null,
  before jsonb,
  after jsonb
);

alter table public.fin_docs enable row level security;
alter table public.fin_audit enable row level security;
revoke all on public.fin_docs, public.fin_audit from anon, public;
revoke all on public.fin_docs, public.fin_audit from authenticated;
grant select, insert, update, delete on public.fin_docs to authenticated;
grant select on public.fin_audit to authenticated;
revoke all on sequence public.fin_audit_id_seq from anon, public, authenticated;

drop policy if exists fin_select on public.fin_docs;
drop policy if exists fin_insert on public.fin_docs;
drop policy if exists fin_update on public.fin_docs;
drop policy if exists fin_delete on public.fin_docs;
create policy fin_select on public.fin_docs for select to authenticated using ((select private.is_finance()));
create policy fin_insert on public.fin_docs for insert to authenticated with check ((select private.is_finance()));
create policy fin_update on public.fin_docs for update to authenticated using ((select private.is_finance())) with check ((select private.is_finance()));
create policy fin_delete on public.fin_docs for delete to authenticated using ((select private.is_finance()));
drop policy if exists fin_audit_select on public.fin_audit;
create policy fin_audit_select on public.fin_audit for select to authenticated using ((select private.is_finance()));

-- 3. Book-keeping rules, enforced by the database -------------------------------------
-- Financial year runs July to June; FY 2026 = 1 Jul 2026 – 30 Jun 2027.
create or replace function private.fin_fy(d text)
returns int language sql immutable set search_path to '' as $$
  select case when d ~ '^\d{4}-\d{2}-\d{2}$' then
    case when substr(d, 6, 2)::int >= 7 then substr(d, 1, 4)::int else substr(d, 1, 4)::int - 1 end end
$$;
create or replace function private.fin_locked(d text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(private.fin_fy(d) in (
    select (x)::int from public.fin_docs s, jsonb_array_elements_text(coalesce(s.data->'lockedFYs', '[]'::jsonb)) x
    where s.path = 'config/settings'), false)
$$;
create or replace function private.fin_inv_total(inv jsonb)
returns numeric language sql immutable set search_path to '' as $$
  select round(coalesce((inv->>'amount')::numeric, 0) * (1 + coalesce((inv->>'vatPct')::numeric, 0) / 100), 2)
$$;

create or replace function private.fin_guard()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  uid uuid := auth.uid();
  role text := private.fin_role();
  od jsonb := case when tg_op in ('UPDATE', 'DELETE') then old.data else null end;
  nd jsonb;
  ost text; nst text; inv jsonb; settled numeric; k text;
  allowed text[];
begin
  if uid is not null and coalesce(role, '') not in ('principal', 'coo') then
    raise exception 'Finance is limited to the Principal and the COO';
  end if;

  if tg_op = 'DELETE' then
    if old.coll = 'invoices' then
      if coalesce(od->>'status', 'draft') <> 'draft' then raise exception 'Issued invoices are never deleted. Void it instead.'; end if;
    elsif old.coll = 'receipts' then
      if private.fin_locked(od->>'date') then raise exception 'That financial year is closed. The Principal can reopen it in Settings.'; end if;
    elsif old.coll = 'projects' then
      if exists (select 1 from public.fin_docs where coll = 'invoices' and data->>'projectId' = old.doc_id) then
        raise exception 'This project has invoices, so it can''t be deleted. Mark it closed instead.';
      end if;
    elsif old.path = 'config/settings' then
      raise exception 'Settings can''t be deleted';
    end if;
    return old;
  end if;

  -- path, collection and server-kept fields
  new.coll := split_part(new.path, '/', 1);
  new.doc_id := split_part(new.path, '/', 2);
  if new.coll not in ('projects', 'invoices', 'receipts', 'config') then
    raise exception 'Unknown finance record type: %', new.coll;
  end if;
  if new.coll = 'config' and new.doc_id <> 'settings' then raise exception 'Unknown settings record'; end if;
  if tg_op = 'UPDATE' and (new.path <> old.path) then raise exception 'Records can''t be moved'; end if;
  if tg_op = 'INSERT' then
    new.created_at := now(); new.created_by := uid;
  else
    new.created_at := old.created_at; new.created_by := old.created_by;
  end if;
  new.updated_at := now(); new.updated_by := uid;
  nd := new.data - 'createdAt' - 'createdBy' - 'updatedAt' - 'updatedBy';
  nd := nd || jsonb_build_object('createdAt', to_jsonb(new.created_at), 'createdBy', to_jsonb(new.created_by),
                                 'updatedAt', to_jsonb(new.updated_at), 'updatedBy', to_jsonb(new.updated_by));
  new.data := nd;

  if new.coll = 'config' then
    if (coalesce(od->'lockedFYs', '[]'::jsonb) is distinct from coalesce(nd->'lockedFYs', '[]'::jsonb)) and role <> 'principal' and uid is not null then
      raise exception 'Only the Principal closes or reopens a financial year';
    end if;
    return new;
  end if;

  if new.coll = 'projects' then
    if coalesce(nd->>'code', '') = '' or coalesce(nd->>'name', '') = '' then raise exception 'A project needs a code and a name'; end if;
    if coalesce((nd->>'fee')::numeric, 0) < 0 then raise exception 'Fee can''t be negative'; end if;
    return new;
  end if;

  if new.coll = 'invoices' then
    nst := coalesce(nd->>'status', 'draft');
    if nst not in ('draft', 'issued', 'void') then raise exception 'Unknown invoice status'; end if;
    if coalesce((nd->>'amount')::numeric, -1) < 0 then raise exception 'Invoice amount is missing'; end if;
    if coalesce(nd->>'no', '') = '' then raise exception 'Invoice number is missing'; end if;
    if not exists (select 1 from public.fin_docs where path = 'projects/' || coalesce(nd->>'projectId', '')) then
      raise exception 'Invoice project not found';
    end if;
    if tg_op = 'INSERT' then
      if nst = 'void' then raise exception 'A new invoice can''t start as void'; end if;
      if private.fin_locked(nd->>'date') then raise exception 'That financial year is closed. The Principal can reopen it in Settings.'; end if;
      return new;
    end if;
    ost := coalesce(od->>'status', 'draft');
    if ost = 'void' then raise exception 'A voided invoice can''t be changed. Issue a new one.'; end if;
    if private.fin_locked(od->>'date') or private.fin_locked(nd->>'date') then
      raise exception 'That financial year is closed. The Principal can reopen it in Settings.';
    end if;
    if ost = 'draft' then
      return new;                                    -- drafts are freely editable, and can be issued
    end if;
    -- issued: only the due date and the note may change, or it may be voided
    if nst = 'draft' then raise exception 'An issued invoice can''t go back to draft. Void it and issue a corrected one.'; end if;
    allowed := array['status', 'due', 'note', 'voidReason', 'voidedOn', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'];
    for k in select jsonb_object_keys(od || nd) loop
      if not (k = any(allowed)) and (od->k) is distinct from (nd->k) then
        raise exception 'An issued invoice can''t be edited (%). Void it and issue a corrected one.', k;
      end if;
    end loop;
    if nst = 'void' and exists (select 1 from public.fin_docs where coll = 'receipts' and data->>'invoiceId' = new.doc_id) then
      raise exception 'This invoice has payments recorded. Remove them before voiding.';
    end if;
    return new;
  end if;

  if new.coll = 'receipts' then
    select data into inv from public.fin_docs where path = 'invoices/' || coalesce(nd->>'invoiceId', '');
    if inv is null then raise exception 'Payment invoice not found'; end if;
    if coalesce(inv->>'status', 'draft') <> 'issued' then raise exception 'Payments can only be recorded against an issued invoice'; end if;
    if coalesce((nd->>'received')::numeric, 0) < 0 or coalesce((nd->>'ait')::numeric, 0) < 0 or coalesce((nd->>'vds')::numeric, 0) < 0 then
      raise exception 'Amounts can''t be negative';
    end if;
    if coalesce((nd->>'received')::numeric, 0) + coalesce((nd->>'ait')::numeric, 0) + coalesce((nd->>'vds')::numeric, 0) <= 0 then
      raise exception 'Enter the amount received';
    end if;
    if private.fin_locked(nd->>'date') or (od is not null and private.fin_locked(od->>'date')) then
      raise exception 'That financial year is closed. The Principal can reopen it in Settings.';
    end if;
    select coalesce(sum(coalesce((data->>'received')::numeric, 0) + coalesce((data->>'ait')::numeric, 0) + coalesce((data->>'vds')::numeric, 0)), 0)
      into settled from public.fin_docs where coll = 'receipts' and data->>'invoiceId' = nd->>'invoiceId' and path <> new.path;
    if settled + coalesce((nd->>'received')::numeric, 0) + coalesce((nd->>'ait')::numeric, 0) + coalesce((nd->>'vds')::numeric, 0)
       > private.fin_inv_total(inv) + 1 then
      raise exception 'That is more than the invoice balance';
    end if;
    nd := nd || jsonb_build_object('projectId', inv->>'projectId');
    new.data := nd;
    return new;
  end if;
  return new;
end $$;

create or replace function private.fin_log()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.fin_audit (actor, path, op, before, after)
  values (auth.uid(), coalesce(new.path, old.path), lower(tg_op),
          case when tg_op <> 'INSERT' then old.data end, case when tg_op <> 'DELETE' then new.data end);
  return null;
end $$;

drop trigger if exists a_fin_guard on public.fin_docs;
create trigger a_fin_guard before insert or update or delete on public.fin_docs for each row execute function private.fin_guard();
drop trigger if exists z_fin_log on public.fin_docs;
create trigger z_fin_log after insert or update or delete on public.fin_docs for each row execute function private.fin_log();


-- SLATE OS · weekly backup now includes Finance, but only when the person downloading is the Principal or the COO.
create or replace function public.backup_export(p_format text default 'json'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare own boolean := private.is_owner(); fin boolean := private.is_finance(); out jsonb; n int;
begin
  if not private.is_active() or not private.is_approver() then raise exception 'Only the Principal and the COO download backups'; end if;
  out := jsonb_build_object(
    'app', 'SLATE OS', 'exportedAt', now(), 'exportedBy', private.person_name(auth.uid()),
    'note', case when own then 'Full backup' else 'Full backup without the Principal''s private tasks' end,
    'profiles', coalesce((select jsonb_agg(to_jsonb(p) order by p.full_name) from public.profiles p), '[]'),
    'docs', coalesce((select jsonb_agg(jsonb_build_object('path', d.path, 'data', d.data, 'created_at', d.created_at, 'updated_at', d.updated_at) order by d.path)
                      from public.docs d where d.coll <> 'data' and (own or d.coll <> 'lead')), '[]'),
    'issue_reports', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.issue_reports r), '[]'),
    'notifications_sent', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'to', x.user_id, 'from', x.sender, 'kind', x.kind, 'title', x.title, 'body', x.body, 'created_at', x.created_at,
                                     'read_at', x.read_at, 'reply', x.reply, 'replied_at', x.replied_at, 'done_at', x.done_at, 'due_at', x.due_at, 'reply_note', x.reply_note) order by x.id)
                      from public.notifications x where x.kind = 'message'), '[]'),
    'activity_log', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.activity_log a where own or not a.is_private), '[]'));
  if fin then
    out := out || jsonb_build_object(
      'finance', coalesce((select jsonb_agg(jsonb_build_object('path', f.path, 'data', f.data, 'created_at', f.created_at, 'updated_at', f.updated_at) order by f.path) from public.fin_docs f), '[]'),
      'finance_log', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.fin_audit a), '[]'));
  end if;
  n := jsonb_array_length(out->'docs') + jsonb_array_length(out->'profiles') + jsonb_array_length(out->'activity_log')
       + coalesce(jsonb_array_length(out->'finance'), 0);
  insert into public.backup_log (by_user, rows_total, format) values (auth.uid(), n, left(coalesce(p_format, 'json'), 10));
  insert into public.activity_log (actor, table_name, row_id, action, is_private, after)
  values (auth.uid(), 'backup', null, 'download', false, jsonb_build_object('rows', n, 'format', p_format));
  return out;
end $function$;
