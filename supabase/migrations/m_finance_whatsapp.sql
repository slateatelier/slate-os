-- SLATE OS · Finance · invoices by WhatsApp
-- Two ways to send an issued invoice, switched on or off in Finance › Settings (config/settings → waOn):
--   1. Share PDF: the PDF goes out from the sender's own WhatsApp; the database only logs that it was shared.
--   2. Send to client: opens the client's chat with a private link to os.slate-atelier.com/i/<token>.
--      The PDF sits in a private storage bucket; only someone holding a live link can fetch it,
--      and each open is counted so Finance can see whether the client has looked at it.
-- Nothing here is visible to the team: only the Principal and the COO (private.is_finance) read or create links.

create table if not exists public.fin_links (
  id bigserial primary key,
  kind text not null check (kind in ('link', 'pdf')),
  token text unique check (token is null or token ~ '^[A-Za-z0-9]{32}$'),
  invoice_id text not null check (invoice_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  file_path text,
  phone text check (phone is null or phone ~ '^880\d{10}$'),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  open_count int not null default 0,
  check (kind = 'pdf' or (token is not null and file_path is not null and expires_at is not null))
);
create index if not exists fin_links_invoice on public.fin_links (invoice_id);

alter table public.fin_links enable row level security;
revoke all on public.fin_links from anon, public, authenticated;
grant select, insert, update on public.fin_links to authenticated;
revoke all on sequence public.fin_links_id_seq from anon, public;
grant usage on sequence public.fin_links_id_seq to authenticated;

drop policy if exists fin_links_select on public.fin_links;
drop policy if exists fin_links_insert on public.fin_links;
drop policy if exists fin_links_update on public.fin_links;
create policy fin_links_select on public.fin_links for select to authenticated using ((select private.is_finance()));
create policy fin_links_insert on public.fin_links for insert to authenticated with check ((select private.is_finance()));
create policy fin_links_update on public.fin_links for update to authenticated using ((select private.is_finance())) with check ((select private.is_finance()));

-- Server-kept fields; links only for issued invoices; the only change allowed later is switching a link off.
create or replace function private.fin_links_guard()
returns trigger language plpgsql security definer set search_path to '' as $$
declare st text;
begin
  if tg_op = 'INSERT' then
    select coalesce(data->>'status', 'draft') into st from public.fin_docs where path = 'invoices/' || new.invoice_id;
    if st is null then raise exception 'Invoice not found'; end if;
    if st <> 'issued' then raise exception 'Only an issued invoice can be sent'; end if;
    new.created_at := now(); new.created_by := auth.uid();
    new.revoked_at := null; new.revoked_by := null;
    new.first_opened_at := null; new.last_opened_at := null; new.open_count := 0;
    if new.kind = 'link' then
      if new.file_path is distinct from (new.token || '/' || split_part(new.file_path, '/', 2)) or new.file_path !~ '^[A-Za-z0-9]{32}/[A-Za-z0-9_.-]{1,80}\.pdf$' then
        raise exception 'Link file path must sit under its token';
      end if;
      if new.expires_at is null or new.expires_at > now() + interval '366 days' then new.expires_at := now() + interval '365 days'; end if;
    else
      new.token := null; new.file_path := null; new.expires_at := null;
    end if;
    return new;
  end if;
  -- UPDATE: the open counter, written only by fin_link_open below
  if current_setting('slate.fin_link_open', true) = '1' then
    new := old; new.open_count := old.open_count + 1; new.last_opened_at := now(); new.first_opened_at := coalesce(old.first_opened_at, now());
    return new;
  end if;
  -- UPDATE: otherwise switching off only
  if old.revoked_at is not null then raise exception 'This link is already switched off'; end if;
  if new.revoked_at is null then raise exception 'A link can only be switched off'; end if;
  new := old; new.revoked_at := now(); new.revoked_by := auth.uid();
  return new;
end $$;
drop trigger if exists a_fin_links_guard on public.fin_links;
create trigger a_fin_links_guard before insert or update on public.fin_links for each row execute function private.fin_links_guard();

-- Is this storage path a live client link? Used by the bucket policy below.
create or replace function public.fin_link_live(p_path text)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.fin_links l join public.fin_docs d on d.path = 'invoices/' || l.invoice_id
    where l.kind = 'link' and l.file_path = p_path and l.revoked_at is null and l.expires_at > now()
      and coalesce(d.data->>'status', 'draft') = 'issued')
$$;

-- The client's page calls this with the token from the link. It counts the open and returns only what
-- the page shows: the file to download and the invoice's number, client, total and due date.
create or replace function public.fin_link_open(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare l public.fin_links; d jsonb; p jsonb; total numeric;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9]{32}$' then return jsonb_build_object('ok', false, 'why', 'invalid'); end if;
  select * into l from public.fin_links where token = p_token and kind = 'link';
  if not found then return jsonb_build_object('ok', false, 'why', 'invalid'); end if;
  select data into d from public.fin_docs where path = 'invoices/' || l.invoice_id;
  if l.revoked_at is not null or d is null or coalesce(d->>'status', 'draft') <> 'issued' then return jsonb_build_object('ok', false, 'why', 'off'); end if;
  if l.expires_at <= now() then return jsonb_build_object('ok', false, 'why', 'expired'); end if;
  select data into p from public.fin_docs where path = 'projects/' || coalesce(d->>'projectId', '');
  total := private.fin_inv_total(d);
  -- the sender testing their own link from a signed-in Finance account isn't counted as the client opening it
  if not coalesce(private.is_finance(), false) then
    perform set_config('slate.fin_link_open', '1', true);
    update public.fin_links set open_count = open_count + 1 where id = l.id;
    perform set_config('slate.fin_link_open', '', true);
  end if;
  return jsonb_build_object('ok', true, 'file', l.file_path, 'no', d->>'no', 'date', d->>'date', 'due', d->>'due',
    'client', coalesce(p->>'client', ''), 'project', coalesce(p->>'name', ''), 'total', round(total));
end $$;
revoke all on function public.fin_link_open(text) from public;
grant execute on function public.fin_link_open(text) to anon, authenticated;

-- Private bucket for the client PDFs. Finance writes; anyone may read a file only while its link is live.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fin-invoices', 'fin-invoices', false, 5242880, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['application/pdf'];

drop policy if exists fin_inv_files_write on storage.objects;
drop policy if exists fin_inv_files_finance_read on storage.objects;
drop policy if exists fin_inv_files_link_read on storage.objects;
create policy fin_inv_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'fin-invoices' and (select private.is_finance()));
create policy fin_inv_files_finance_read on storage.objects for select to authenticated
  using (bucket_id = 'fin-invoices' and (select private.is_finance()));
create policy fin_inv_files_link_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'fin-invoices' and public.fin_link_live(name));
revoke all on function public.fin_link_live(text) from public;
grant execute on function public.fin_link_live(text) to anon, authenticated;
