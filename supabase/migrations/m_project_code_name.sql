-- SLATE OS · project codes carry the project name (27 Oct 2026)
-- Client projects: AREA-NAME-PLOT-SIZE-NO, e.g. BSD-ACE-6K-2610, JOL-CSRM-5K-2609, UTT-RAFT-5K-2608.
--   NAME is the first word of the project name with 3+ letters (up to 4), skipping area names and
--   words like plot / house / road; if nothing qualifies, the first 4 letters of the name.
--   Codes stay within 24 characters by dropping the plot, then shortening the name, never the number.
-- Studio areas (OPS-, DEV-, MGT-, BIZ-, HRM-, FIN-, STU-) and Chalk Create (CHK-) are unchanged.
-- Existing client projects are recoded once, keeping their number; the old code is kept as prevCode,
-- and Finance's copies of the codes are updated to match.

create or replace function private.project_name_code(p_name text)
 returns text language sql immutable set search_path to ''
as $$
  select coalesce(
    (select upper(left(w, 4))
       from regexp_split_to_table(regexp_replace(lower(coalesce(p_name, '')), '[^a-z]+', ' ', 'g'), ' ') with ordinality x(w, i)
      where length(w) >= 3
        and w !~ '^(the|and|plot|house|holding|road|sector|block|katha|nos?)$'
        and w !~ '^(gulshan|banani|baridhara|dhanmondi|uttara|bashundhara|purbachal|jolshiri|mirpur|mohammadpur|lalmatia|niketan|tejgaon|motijheel|banasree|aftabnagar|khilgaon|rampura|badda|mohakhali|cantonment|savar|narayanganj|gazipur|keraniganj|chattogram|chittagong|sylhet|khulna|rajshahi|cumilla|comilla|bogura|bogra|barishal|barisal|rangpur|mymensingh|wari|dhaka)$'
      order by i limit 1),
    nullif(upper(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z]', '', 'g'), 4)), ''))
$$;

create or replace function private.project_code(d jsonb, p_no text)
 returns text language plpgsql immutable set search_path to ''
as $function$
declare k numeric; size text; pre text; area text; nm text; plot text; c text;
begin
  if lower(trim(coalesce(d->>'pod', ''))) = 'chalk create' then
    return 'CHK-' || p_no;
  end if;
  pre := case d->>'type' when 'studioops' then 'OPS' when 'studiodev' then 'DEV' when 'studiomgmt' then 'MGT' when 'studiobd' then 'BIZ'
                         when 'studiohr' then 'HRM' when 'studiofin' then 'FIN' else null end;
  if pre is not null then
    return left(pre || '-' || coalesce(nullif(upper(left(regexp_replace(coalesce(d->>'name', ''), '[^A-Za-z]', '', 'g'), 4)), ''), 'STU') || '-' || p_no, 24);
  end if;
  if d->>'pod' = 'Studio' then
    return left('STU-' || coalesce(nullif(upper(left(regexp_replace(coalesce(d->>'name', ''), '[^A-Za-z]', '', 'g'), 4)), ''), 'INT') || '-' || p_no, 24);
  end if;
  k := nullif(regexp_replace(coalesce(d->>'katha', ''), '[^0-9.]', '', 'g'), '')::numeric;
  size := case when k is null or k = 0 then null
               when k = trunc(k) then trunc(k)::text || 'K'
               else trim(trailing '0' from round(k, 2)::text) || 'K' end;
  area := private.area_code(coalesce(nullif(d->>'location', ''), d->>'name'));
  nm := private.project_name_code(d->>'name');
  plot := private.plot_code(d->>'name', d->>'location');
  c := array_to_string(array_remove(array[area, nm, plot, size, p_no], null), '-');
  if length(c) > 24 then
    c := array_to_string(array_remove(array[area, nm, size, p_no], null), '-');
  end if;
  if length(c) > 24 and nm is not null then
    c := array_to_string(array_remove(array[area, left(nm, greatest(1, 4 - (length(c) - 24))), size, p_no], null), '-');
  end if;
  return c;
end $function$;

-- recode the existing client projects once (the code trigger normally keeps a code fixed)
alter table public.docs disable trigger a0_docs_project_code;
update public.docs d
   set data = d.data || jsonb_build_object(
         'prevCode', d.data->>'code',
         'code', upper(private.project_code(d.data, coalesce(d.data->>'codeNo', right(d.data->>'code', 4)))))
 where d.coll = 'projects'
   and coalesce(d.data->>'code', '') <> ''
   and d.data->>'code' !~ '^(CHK|OPS|DEV|MGT|BIZ|HRM|FIN|STU)-'
   and upper(private.project_code(d.data, coalesce(d.data->>'codeNo', right(d.data->>'code', 4)))) <> d.data->>'code';
alter table public.docs enable trigger a0_docs_project_code;

-- Finance keeps a copy of each linked project's code
update public.fin_docs f
   set data = f.data || jsonb_build_object('code', o.data->>'code'), updated_at = now()
  from public.docs o
 where f.coll = 'projects' and o.coll = 'projects'
   and o.doc_id = f.data->>'osId'
   and (f.data->>'code') is distinct from (o.data->>'code');
