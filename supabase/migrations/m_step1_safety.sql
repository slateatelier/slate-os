-- Restructure Step 1 (31 Oct 2026): two safety fixes. Run once in the Supabase SQL editor.
-- 1. Invoice share links off: nobody outside SLATE OS can call the share-link functions. The code stays.
-- 2. The Principal's and the COO's backup download includes finance: fees, salaries and the finance change log.
-- Undo: grant execute on function public.fin_link_live(text), public.fin_link_open(text) to anon;
--       and re-run the previous backup_export definition (saved in the restructure notes).
begin;

revoke execute on function public.fin_link_live(text) from anon, public;
revoke execute on function public.fin_link_open(text) from anon, public;

do $mig$
declare src text := pg_get_functiondef('public.backup_export(text)'::regprocedure);
  a text := $a$    'activity_log', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.activity_log a where own or not a.is_private), '[]'));$a$;
  b text := $b$    'activity_log', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.activity_log a where own or not a.is_private), '[]'));
  -- finance: the Principal and the COO only (fees, invoices, payments, salaries and the finance change log)
  if private.is_top() then
    out := out || jsonb_build_object(
      'finance', coalesce((select jsonb_agg(jsonb_build_object('path', f.path, 'data', f.data, 'created_at', f.created_at, 'updated_at', f.updated_at) order by f.path) from public.fin_docs f), '[]'),
      'finance_log', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.fin_audit x), '[]'));
  end if;$b$;
begin
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'Step 1: backup_export is not the expected version; nothing changed'; end if;
  execute replace(src, a, b);
end $mig$;

commit;
