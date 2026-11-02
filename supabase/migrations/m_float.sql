-- SLATE Books: office staff float (2 Nov 2026).
-- A fixed amount of petty cash kept with office staff (Md. Rabbi Shikder) for small office expenses.
-- Adds the cash account "Cash with office staff (float)" and sets the float in Books settings (Tk 5,000).
-- The COO gives the float as a transfer from petty cash; office staff bills are posted against it and the COO
-- tops it back up by the approved bills. The Principal changes the holder, account or amount in Books › More › Settings.
begin;
insert into public.books_docs (path, coll, doc_id, data) values
  ('ledgers/lfloat', 'ledgers', 'lfloat', '{"name": "Cash with office staff (float)", "group": "cash", "active": true, "opening": 0, "notes": "Petty cash kept with office staff for small office expenses; a fixed float topped up from petty cash by approved bills. Count it weekly."}'::jsonb)
on conflict (path) do nothing;
update public.books_docs s set data = s.data || jsonb_build_object('floatLedger', 'lfloat', 'floatAmount', 5000)
  || coalesce((select jsonb_build_object('floatHolder', p.id::text) from public.profiles p where p.email = 'rabbi@slate-atelier.com' and p.active limit 1), '{}'::jsonb)
where s.path = 'settings/main' and coalesce(s.data->>'floatLedger', '') = '';
commit;
