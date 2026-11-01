-- October 2026 money received, from the "Receiving Amount Details for Oct-26" sheet (1 Nov 2026).
--  * 7 receipts, Tk 21,50,000 in all: Tk 19,50,000 into the SLATE vault and Tk 2,00,000 into the Mercantile Bank account (MBL 3111000006601).
--      6 Oct  RAFTA (Rafter 01 Riviera)       1,00,000  vault
--      6 Oct  RAFTA (Rafter 01 Riviera)       3,00,000  vault
--      6 Oct  UC HAIDER (Mr. Haider UC)       5,00,000  vault
--      7 Oct  RAFTA (Rafter 01 Riviera)       3,00,000  vault
--     11 Oct  NAVANA 009 (Navana 02)          2,00,000  Mercantile Bank
--     16 Oct  MARINER (Mariner 5kth)          3,50,000  vault
--     17 Oct  COMILLA COMPANYGANJ             4,00,000  vault
--  * Each is a Receipt voucher, CV/26-27/013 to 019, approved, tagged to its project.
--  * UC HAIDER and COMILLA COMPANYGANJ get their client ledgers in Books (they had none yet).
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.
-- It stops without changing anything if these receipts are already in Books.

begin;

do $$ begin
  if exists (select 1 from public.books_docs where coll = 'vouchers' and (data->>'imp' = 'oct26-receipts' or path in ('vouchers/v0333','vouchers/v0339'))) then
    raise exception 'The October 2026 receipts are already in SLATE Books. Nothing was changed.';
  end if;
  if exists (select 1 from public.books_docs where path in ('ledgers/l135','ledgers/l136')) then
    raise exception 'Ledgers l135/l136 already exist. Nothing was changed.';
  end if;
  if exists (select 1 from public.books_docs where coll = 'vouchers' and data->>'no' between 'CV/26-27/013' and 'CV/26-27/019') then
    raise exception 'Voucher numbers CV/26-27/013 to 019 are already used. Nothing was changed.';
  end if;
end $$;

insert into public.books_docs (path, coll, doc_id, data) values
  ('ledgers/l135', 'ledgers', 'l135', '{"name": "UNI-HAID-5K-2640 · UC HAIDER", "group": "inc", "notes": "", "active": true, "opening": 0, "project": "os_feeHAID2640"}'::jsonb),
  ('ledgers/l136', 'ledgers', 'l136', '{"name": "CML-COMP-24K-2639 · COMILLA COMPANYGANJ", "group": "inc", "notes": "", "active": true, "opening": 0, "project": "os_feeCOMI2639"}'::jsonb);

insert into public.books_docs (path, coll, doc_id, data) values
  ('vouchers/v0333', 'vouchers', 'v0333', '{"type": "Receipt", "date": "2026-10-06", "no": "CV/26-27/013", "party": "", "narr": "Rafter 01 Riviera: amount received in the SLATE vault. From the October 2026 receiving sheet.", "ref": "Receiving Oct-26", "lines": [{"l": "l109", "cr": 100000, "dr": 0, "cc": [{"a": 100000, "p": "os_170e2d89f9b3dd500503"}]}, {"l": "l103", "cr": 0, "dr": 100000}], "files": [], "status": "approved", "src": "app", "madeBy": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "madeName": "Syed Imran", "at": "2026-11-01T21:00:00+06:00", "imp": "oct26-receipts", "trail": [{"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "created", "note": "October 2026 receiving sheet"}, {"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "approved", "note": ""}]}'::jsonb),
  ('vouchers/v0334', 'vouchers', 'v0334', '{"type": "Receipt", "date": "2026-10-06", "no": "CV/26-27/014", "party": "", "narr": "Rafter 01 Riviera: amount received in the SLATE vault. From the October 2026 receiving sheet.", "ref": "Receiving Oct-26", "lines": [{"l": "l109", "cr": 300000, "dr": 0, "cc": [{"a": 300000, "p": "os_170e2d89f9b3dd500503"}]}, {"l": "l103", "cr": 0, "dr": 300000}], "files": [], "status": "approved", "src": "app", "madeBy": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "madeName": "Syed Imran", "at": "2026-11-01T21:00:00+06:00", "imp": "oct26-receipts", "trail": [{"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "created", "note": "October 2026 receiving sheet"}, {"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "approved", "note": ""}]}'::jsonb),
  ('vouchers/v0335', 'vouchers', 'v0335', '{"type": "Receipt", "date": "2026-10-06", "no": "CV/26-27/015", "party": "", "narr": "Mr. Haider UC: amount received in the SLATE vault. From the October 2026 receiving sheet.", "ref": "Receiving Oct-26", "lines": [{"l": "l135", "cr": 500000, "dr": 0, "cc": [{"a": 500000, "p": "os_feeHAID2640"}]}, {"l": "l103", "cr": 0, "dr": 500000}], "files": [], "status": "approved", "src": "app", "madeBy": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "madeName": "Syed Imran", "at": "2026-11-01T21:00:00+06:00", "imp": "oct26-receipts", "trail": [{"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "created", "note": "October 2026 receiving sheet"}, {"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "approved", "note": ""}]}'::jsonb),
  ('vouchers/v0336', 'vouchers', 'v0336', '{"type": "Receipt", "date": "2026-10-07", "no": "CV/26-27/016", "party": "", "narr": "Rafter 01 Riviera: amount received in the SLATE vault. From the October 2026 receiving sheet.", "ref": "Receiving Oct-26", "lines": [{"l": "l109", "cr": 300000, "dr": 0, "cc": [{"a": 300000, "p": "os_170e2d89f9b3dd500503"}]}, {"l": "l103", "cr": 0, "dr": 300000}], "files": [], "status": "approved", "src": "app", "madeBy": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "madeName": "Syed Imran", "at": "2026-11-01T21:00:00+06:00", "imp": "oct26-receipts", "trail": [{"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "created", "note": "October 2026 receiving sheet"}, {"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "approved", "note": ""}]}'::jsonb),
  ('vouchers/v0337', 'vouchers', 'v0337', '{"type": "Receipt", "date": "2026-10-11", "no": "CV/26-27/017", "party": "", "narr": "Navana 02: amount received in the Mercantile Bank (MBL 3111000006601). From the October 2026 receiving sheet.", "ref": "Receiving Oct-26", "lines": [{"l": "l077", "cr": 200000, "dr": 0, "cc": [{"a": 200000, "p": "os_b6bbe5b3dd5bc85df4ee"}]}, {"l": "l055", "cr": 0, "dr": 200000}], "files": [], "status": "approved", "src": "app", "madeBy": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "madeName": "Syed Imran", "at": "2026-11-01T21:00:00+06:00", "imp": "oct26-receipts", "trail": [{"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "created", "note": "October 2026 receiving sheet"}, {"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "approved", "note": ""}]}'::jsonb),
  ('vouchers/v0338', 'vouchers', 'v0338', '{"type": "Receipt", "date": "2026-10-16", "no": "CV/26-27/018", "party": "", "narr": "Mariner 5kth: amount received in the SLATE vault. From the October 2026 receiving sheet.", "ref": "Receiving Oct-26", "lines": [{"l": "l120", "cr": 350000, "dr": 0, "cc": [{"a": 350000, "p": "os_marinerSun2628"}]}, {"l": "l103", "cr": 0, "dr": 350000}], "files": [], "status": "approved", "src": "app", "madeBy": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "madeName": "Syed Imran", "at": "2026-11-01T21:00:00+06:00", "imp": "oct26-receipts", "trail": [{"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "created", "note": "October 2026 receiving sheet"}, {"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "approved", "note": ""}]}'::jsonb),
  ('vouchers/v0339', 'vouchers', 'v0339', '{"type": "Receipt", "date": "2026-10-17", "no": "CV/26-27/019", "party": "", "narr": "Comilla Companyganj: amount received in the SLATE vault. From the October 2026 receiving sheet.", "ref": "Receiving Oct-26", "lines": [{"l": "l136", "cr": 400000, "dr": 0, "cc": [{"a": 400000, "p": "os_feeCOMI2639"}]}, {"l": "l103", "cr": 0, "dr": 400000}], "files": [], "status": "approved", "src": "app", "madeBy": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "madeName": "Syed Imran", "at": "2026-11-01T21:00:00+06:00", "imp": "oct26-receipts", "trail": [{"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "created", "note": "October 2026 receiving sheet"}, {"at": "2026-11-01T21:00:00+06:00", "by": "9700a1d6-577a-4168-8a39-25f55f8cc2fc", "act": "approved", "note": ""}]}'::jsonb);

commit;
