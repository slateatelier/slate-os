-- SLATE OS · Leads (28 Oct 2026)
-- Leads are kept with proposed projects (proposals/<id>, lead = true), so the same Principal-and-COO-only rules apply.
-- This only updates the wording of the notifications so leads read as leads, and tells the other one when a lead moves
-- to Proposed. Run after m_proposals.sql in Supabase › SQL Editor. Safe to run more than once.
create or replace function private.docs_proposal_notify() returns trigger language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); nm text; e jsonb; n_old int; ttl text; body text; u uuid;
  ld boolean := coalesce((new.data->>'lead')::boolean, false);
  was_ld boolean := tg_op = 'UPDATE' and coalesce((old.data->>'lead')::boolean, false);
  src text := nullif(new.data->>'src', '');
begin
  nm := coalesce(nullif(new.data->>'name', ''), nullif(new.data->>'client', ''), 'Proposal')
        || case when nullif(new.data->>'name', '') is not null then coalesce(' · ' || nullif(new.data->>'client', ''), '') else '' end;
  n_old := case when tg_op = 'UPDATE' and jsonb_typeof(old.data->'log') = 'array' then jsonb_array_length(old.data->'log') else 0 end;
  if tg_op = 'INSERT' then
    ttl := case when ld then 'New lead: ' else 'New proposed project: ' end || nm;
    body := case when ld then concat_ws(' · ', 'Lead', src, nullif(new.data->>'phone', '')) else coalesce(nullif(new.data->>'scopeNote', ''), 'Proposed projects') end;
  elsif was_ld and not ld then
    ttl := 'Lead moved to Proposed: ' || nm; body := 'A proposal is being prepared.';
  elsif coalesce(new.data->>'status', 'open') <> coalesce(old.data->>'status', 'open') then
    ttl := case new.data->>'status' when 'won' then 'Proposal confirmed: ' when 'lost' then case when ld then 'Lead lost: ' else 'Proposal lost: ' end
             when 'dropped' then case when ld then 'Lead dropped: ' else 'Proposal dropped: ' end else case when ld then 'Lead reopened: ' else 'Proposal reopened: ' end end || nm;
    body := coalesce(nullif(new.data->>'outcomeNote', ''), case when new.data->>'status' = 'won' then 'It is now a client project.' when ld then 'Leads' else 'Proposed projects' end);
  elsif jsonb_typeof(new.data->'log') = 'array' and jsonb_array_length(new.data->'log') > n_old then
    e := new.data->'log'->-1;
    ttl := case when ld then 'Lead contact logged: ' else 'Client response logged: ' end || nm;
    body := concat_ws(' · ', nullif(e->>'kindL', ''), nullif(e->>'respL', ''))
            || coalesce(E'\n“' || nullif(e->>'note', '') || '”', '')
            || coalesce(E'\nNext follow-up ' || to_char(nullif(new.data->>'next', '')::date, 'FMDD Mon'), '');
  else return null; end if;
  for u in select id from public.profiles where active and designation in ('principal', 'coo') and id is distinct from me loop
    insert into public.notifications (user_id, kind, title, body) values (u, 'proposal', ttl, body);
  end loop;
  return null;
end $$;

create or replace function private.proposal_followups() returns void language plpgsql security definer set search_path = '' as $$
declare td date := (now() at time zone 'Asia/Dhaka')::date; r record; u uuid; last jsonb; dd int; ld boolean; nm text;
begin
  if extract(dow from td) in (5, 6) then return; end if;
  for r in select data from public.docs where coll = 'proposals' and coalesce(data->>'status', 'open') = 'open'
             and coalesce(data->>'next', '') ~ '^\d{4}-\d{2}-\d{2}$' and (data->>'next')::date <= td loop
    dd := td - (r.data->>'next')::date;
    if not (dd = 0 or dd % 3 = 0 or (extract(dow from td) = 0 and dd in (1, 2))) then continue; end if;
    ld := coalesce((r.data->>'lead')::boolean, false);
    nm := coalesce(nullif(r.data->>'name', ''), nullif(r.data->>'client', ''), 'Proposal')
          || case when nullif(r.data->>'name', '') is not null then coalesce(' · ' || nullif(r.data->>'client', ''), '') else '' end;
    last := case when jsonb_typeof(r.data->'log') = 'array' and jsonb_array_length(r.data->'log') > 0 then r.data->'log'->-1 end;
    for u in select id from public.profiles where active and designation in ('principal', 'coo') loop
      insert into public.notifications (user_id, kind, title, body)
      values (u, 'proposal',
              'Follow up' || case when ld then ' lead' else '' end
                || case when dd > 0 then ' (' || dd || ' day' || case when dd = 1 then '' else 's' end || ' overdue)' else ' today' end || ': ' || nm,
              coalesce('Last: ' || to_char((last->>'at')::timestamptz at time zone 'Asia/Dhaka', 'FMDD Mon') || ' · '
                       || concat_ws(' · ', nullif(last->>'kindL', ''), nullif(last->>'respL', ''))
                       || coalesce(E'\n“' || nullif(last->>'note', '') || '”', ''),
                       case when ld then 'Not contacted yet.' || coalesce(' ' || nullif(r.data->>'phone', ''), '') else 'No client response logged yet.' end));
    end loop;
  end loop;
end $$;
