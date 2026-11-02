-- Drafting board (Principal, 2 Nov 2026): every POD leader sees the status of all drafting-team tasks, on every POD's
-- projects. Read-only and limited to what the board needs (title, project code/name/POD, phase, dates, state): no
-- project fees or other project data, and no right to change another POD's tasks (the docs policies are unchanged).
create or replace function public.drafting_board()
returns table(id text, assignee uuid, req_to uuid, title text, project_id text, code text, name text, pod text,
              phase text, target text, done_at text, stage text, verify boolean)
language sql stable security definer set search_path = '' as $$
  select t.doc_id,
         t.assignee,
         private.as_uuid((t.data->'assignReq')->>'to'),
         t.data->>'title', t.project_id,
         p.data->>'code', p.data->>'name', p.data->>'pod',
         t.data->>'phase', t.data->>'target', t.data->>'doneAt', t.data->>'stage',
         coalesce(jsonb_typeof(t.data->'verify') = 'object', false)
  from public.docs t
  left join public.docs p on p.coll = 'projects' and p.doc_id = t.project_id
  where t.coll = 'tasks'
    and coalesce((t.data->>'archived')::boolean, false) = false
    and (private.is_drafting_member(t.assignee) or private.is_drafting_member(private.as_uuid((t.data->'assignReq')->>'to')))
    and (t.data->>'doneAt' is null or left(t.data->>'doneAt', 10) >= to_char(now() - interval '14 days', 'YYYY-MM-DD'))
    and (private.is_pod_leader() or private.is_approver() or private.is_owner() or private.is_coo()
         or private.my_designation() in ('design_associate_lead', 'design_associate'));
$$;
revoke all on function public.drafting_board() from public, anon;
grant execute on function public.drafting_board() to authenticated;
