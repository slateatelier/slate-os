-- Studio work: a fourth area, Business development (leads, lead meetings, follow-ups, proposals)
create or replace function private.project_code(d jsonb, p_no text)
 returns text language plpgsql immutable set search_path to ''
as $$
declare k numeric; size text; parts text[]; pre text;
begin
  if lower(trim(coalesce(d->>'pod', ''))) = 'chalk create' then
    return 'CHK-' || p_no;
  end if;
  pre := case d->>'type' when 'studioops' then 'OPS' when 'studiodev' then 'DEV' when 'studiomgmt' then 'MGT' when 'studiobd' then 'BIZ' else null end;
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
  parts := array_remove(array[private.area_code(coalesce(nullif(d->>'location', ''), d->>'name')),
                              private.plot_code(d->>'name', d->>'location'), size, p_no], null);
  return left(array_to_string(parts, '-'), 24);
end $$;

-- the area's project, so it shows in every project menu straight away
insert into public.docs (path, coll, doc_id, data)
select 'projects/studioBizArea0001', 'projects', 'studioBizArea0001',
  jsonb_build_object('name','STUDIO BUSINESS DEVELOPMENT','type','studiobd','pod','Studio','pod2','','pods','[]'::jsonb,
    'katha','','client','','location','','scope','[]'::jsonb,'note','Studio work: leads, lead meetings, follow-ups and proposals',
    'closed',false,'status','active','createdAt',to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'createdBy',d.data->>'createdBy',
    'approvedAt',to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'approvedBy',d.data->>'approvedBy')
from public.docs d where d.path = 'projects/studioDevArea0001'
on conflict (path) do nothing;
