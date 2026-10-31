-- Fee income accounts named the SLATE OS way (31 Oct 2026). Data only; nothing about the structure changes.
--  * Each project's fee income account in Books is renamed "PROJECT CODE · PROJECT NAME", exactly as in SLATE OS
--    (e.g. "Unicorn Properties Ltd." becomes "SWA-UNIC-30.62K-2634 · UNICORN HEIGHTS").
--  * The old Tally name is kept on the account (tallyName) and the account is linked to its project (project), so nothing is lost.
--  * Vouchers point at accounts by their id, so no entry changes. "Fee Income" (for new bills) keeps its name.
-- Run once in the Supabase SQL editor. It runs as one transaction: if any step fails, nothing changes.

begin;

select set_config('slate.books_sync', '1', true);
with m(lid, pid, extra) as (values
  ('l001', 'os_oldDesdemonaC11', ''),
  ('l002', 'os_oldDesdemonaF11', ''),
  ('l004', 'os_oldDesdemonaC10', ''),
  ('l007', 'os_a4faad1140ceb0c43f6e', ''),
  ('l008', 'os_oldDesdemonaC9', ''),
  ('l009', 'os_17883a4704c8ec034319', ''),
  ('l022', 'os_oldEdisonVerona', ''),
  ('l023', 'os_oldEdisonOrleans', ''),
  ('l024', 'os_oldEdisonCelia', ''),
  ('l025', 'os_16cf7d7d6bae8a89f5a6', ''),
  ('l026', 'os_oldEdisonCamillo', ''),
  ('l027', 'os_36ea0d94d6428977dabc', ''),
  ('l033', 'os_00db9d27d1c585d86a6e', ''),
  ('l034', 'os_oldHandymanJolshiri', ''),
  ('l035', 'os_13d8bcc3dde826e159ff', ''),
  ('l039', 'os_oldTitaniaA5', ''),
  ('l040', 'os_oldEdisonLuxeVista', ''),
  ('l048', 'os_8629d29029b23ec5d303', ''),
  ('l051', 'os_1ea961a0a1cc5dba08d8', ''),
  ('l054', 'os_5c38c27ce1faf305c983', ''),
  ('l065', 'os_oldDesdemonaD5', ''),
  ('l066', 'os_oldEdisonHermiaB7', ''),
  ('l069', 'os_oldEdisonElena', ''),
  ('l070', 'os_d83a2d5798e6b04fc4bc', ''),
  ('l071', 'os_86bdae1b26d32742d566', ''),
  ('l077', 'os_b6bbe5b3dd5bc85df4ee', ''),
  ('l079', 'os_84879bbee5ad9bb9c0c8', ''),
  ('l080', 'os_642ba132d4238c0573f4', ''),
  ('l082', 'os_d65076465c4d6df120d8', ''),
  ('l085', 'os_feePOHS2638', ''),
  ('l086', 'os_4f2ba8388f1af36b0011', ''),
  ('l090', 'os_377513a33609bf0fe21b', ''),
  ('l094', 'os_ce43bb3b3c28b7888f4f', ''),
  ('l104', 'os_39814885ed097199c530', ''),
  ('l109', 'os_170e2d89f9b3dd500503', ''),
  ('l113', 'os_387e7c11dbafb06c2c1b', ' (fee share via Volumezero)'),
  ('l116', 'os_4c463d03a60f8f4c7513', ''),
  ('l117', 'os_b8c7dee8a5f4bf6a2b0f', ''),
  ('l120', 'os_marinerSun2628', ''))
update public.books_docs l
set data = l.data || jsonb_build_object(
      'name', (p.data->>'code') || ' · ' || (p.data->>'name') || m.extra,
      'tallyName', coalesce(l.data->>'tallyName', l.data->>'name'),
      'project', m.pid)
from m join public.books_docs p on p.path = 'projects/' || m.pid
where l.path = 'ledgers/' || m.lid and coalesce(p.data->>'code', '') <> '';
select set_config('slate.books_sync', '', true);

commit;
