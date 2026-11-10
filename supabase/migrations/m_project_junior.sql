-- Junior architect named on each project (10 Nov 2026): projects.data.junior = a junior architect's id.
-- The Principal and the COO set it (Add / Edit project); the project's POD leader can change it on the project page.
do $mig$
declare def text; a text := '      elsif k = ''type'' then';
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'private' and p.proname = 'docs_guard';
  if position('k = ''junior''' in def) > 0 then return; end if;
  if position(a in def) = 0 then raise exception 'docs_guard: text not found'; end if;
  def := overlay(def placing '      elsif k = ''junior'' then
        if not is_lead then raise exception ''Only the project''''s POD leader, the Principal or the COO names its junior architect''; end if;
        if coalesce(nd->>''junior'', '''') <> '''' and not exists (select 1 from public.profiles j where j.id = private.as_uuid(nd->>''junior'')
                 and j.active and j.designation = ''junior_architect'') then
          raise exception ''Choose a junior architect'';
        end if;
' || a from position(a in def) for length(a));
  execute def;
end $mig$;
