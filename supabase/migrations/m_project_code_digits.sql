-- SLATE OS · project code name part carries the name's own number (27 Oct 2026)
-- A number in the project name is added to the name part, so look-alike names stay apart:
--   BHAIYA 042 → JOL-BHAI042-5K-2613, BHAIYA 053 → JOL-BHAI053-5K-2614, CSRM JOLSHIRI 01 → JOL-CSRM01-5K-2609.
-- Numbers that belong to the plot, road, sector, area (Gulshan 2) or size (4 katha) are not used; up to 3 digits.
-- Existing client projects are recoded once; prevCode keeps the original code from before any recoding.

create or replace function private.project_name_code(p_name text)
 returns text language sql immutable set search_path to ''
as $$
  select nullif(concat(
    coalesce(
      (select upper(left(w, 4))
         from regexp_split_to_table(regexp_replace(lower(coalesce(p_name, '')), '[^a-z]+', ' ', 'g'), ' ') with ordinality x(w, i)
        where length(w) >= 3
          and w !~ '^(the|and|plot|house|holding|road|sector|block|katha|nos?)$'
          and w !~ '^(gulshan|banani|baridhara|dhanmondi|uttara|bashundhara|purbachal|jolshiri|mirpur|mohammadpur|lalmatia|niketan|tejgaon|motijheel|banasree|aftabnagar|khilgaon|rampura|badda|mohakhali|cantonment|savar|narayanganj|gazipur|keraniganj|chattogram|chittagong|sylhet|khulna|rajshahi|cumilla|comilla|bogura|bogra|barishal|barisal|rangpur|mymensingh|wari|dhaka)$'
        order by i limit 1),
      nullif(upper(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z]', '', 'g'), 4)), '')),
    (select left(m[2], 3)
       from regexp_matches(lower(coalesce(p_name, '')), '(^|[^a-z0-9])([0-9]+)(?![0-9a-z])', 'g') with ordinality r(m, i)
      where lower(p_name) !~ ('(plot|house|holding|road|sector|block|no|gulshan|mirpur|banani|baridhara|uttara)\s*[.#-]?\s*' || m[2] || '(?![0-9])')
        and lower(p_name) !~ (m[2] || '\s*(k|katha)\M')
      order by i limit 1)), '')
$$;

alter table public.docs disable trigger a0_docs_project_code;
update public.docs d
   set data = d.data || jsonb_build_object(
         'prevCode', coalesce(d.data->>'prevCode', d.data->>'code'),
         'code', upper(private.project_code(d.data, coalesce(d.data->>'codeNo', right(d.data->>'code', 4)))))
 where d.coll = 'projects'
   and coalesce(d.data->>'code', '') <> ''
   and d.data->>'code' !~ '^(CHK|OPS|DEV|MGT|BIZ|HRM|FIN|STU)-'
   and upper(private.project_code(d.data, coalesce(d.data->>'codeNo', right(d.data->>'code', 4)))) <> d.data->>'code';
alter table public.docs enable trigger a0_docs_project_code;

update public.fin_docs f
   set data = f.data || jsonb_build_object('code', o.data->>'code'), updated_at = now()
  from public.docs o
 where f.coll = 'projects' and o.coll = 'projects'
   and o.doc_id = f.data->>'osId'
   and (f.data->>'code') is distinct from (o.data->>'code');
