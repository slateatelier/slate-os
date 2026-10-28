-- SLATE OS · task weights from 1 Nov 2026 (28 Oct 2026)
-- The dashboard's averages include tasks a person can't see. They now also need each project's type (studio area),
-- number of scopes and priority, so the anonymous score rows carry those three values (still no titles, projects or names).
-- Also leaves out unscored work (on-call visits, drawing corrections, the handover billing check).
-- Run in Supabase › SQL Editor. Safe to run more than once.
drop function if exists public.dash_rows(date, date);
create function public.dash_rows(p_from date, p_to date)
 returns table(id text, target text, "originalTarget" text, "doneAt" text, kind text, assignee text, team text, rg text, pod text, pod2 text, katha text, pace text, studio boolean, ptype text, nscope integer, prio text)
 language sql stable security definer set search_path to ''
as $function$
  select t.doc_id,
         t.data->>'target', t.data->>'originalTarget', nullif(t.data->>'doneAt', ''), t.data->>'kind',
         case when t.assignee is null then null
              else 'anon:' || left(md5(t.assignee::text || current_date::text), 12) end,
         a.team,
         case
           when a.designation in ('principal','coo') or a.is_approver then 'boss'
           when a.designation = 'intern' then 'intern'
           when a.designation = 'visualizer' then 'viz'
           when a.designation = 'design_associate_lead' then 'dhead'
           when a.designation = 'design_associate' then 'draft'
           when a.pod_id is not null and (a.designation = 'pod_leader' or a.is_manager) then 'lead'
           when a.pod_id is not null and a.designation in ('junior_architect','other') then 'junior'
           else 'other' end,
         p.data->>'pod', p.data->>'pod2', p.data->>'katha', p.data->'std'->>'pace',
         coalesce(p.data->>'pod', 'Studio') = 'Studio',
         p.data->>'type',
         case when jsonb_typeof(p.data->'scope') = 'array' then jsonb_array_length(p.data->'scope') else 0 end,
         p.data->>'priority'
  from public.docs t
  left join public.profiles a on a.id = t.assignee
  left join public.docs p on p.path = 'projects/' || t.project_id
  where t.coll = 'tasks'
    and private.is_active()
    and coalesce((t.data->>'archived')::boolean, false) = false
    and coalesce((t.data->>'legacy')::boolean, false) = false
    and coalesce((t.data->>'unscored')::boolean, false) = false
    and coalesce(t.data->>'target', '') between p_from::text and p_to::text
    and coalesce(a.is_private, false) = false
    and not private.can_see_task_doc(false, t.assignee, t.project_id)
    and t.created_by is distinct from auth.uid()
    and lower(trim(coalesce(p.data->>'pod', ''))) <> 'chalk create'
    and lower(trim(coalesce(a.team, ''))) <> 'chalk create'
$function$;
revoke all on function public.dash_rows(date, date) from public, anon;
grant execute on function public.dash_rows(date, date) to authenticated, service_role;
