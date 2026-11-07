-- Drawing-list progress checks folded into the weekly POD check-in (Principal, 8 Nov 2026).
-- POD leaders record their progress check on every drawing list of the POD when they submit the weekly check-in, so the
-- 3-working-day reminder now goes to the Design Associate Lead only (drafting progress). The COO is told when a list has
-- gone 6 working days without any check (the weekly check-in missed as well).
create or replace function private.dwg_reviews_due()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record; base date; n int; u uuid; lbl text; st text;
begin
  for r in select l.* from public.dwg_lists l
            where l.confirmed_at is not null
              and exists (select 1 from public.dwg_items i where i.project_id = l.project_id and i.phase = l.phase and i.issue <> 'gfc')
              and exists (select 1 from public.docs p where p.path = 'projects/' || l.project_id and coalesce(p.data->>'status', 'active') = 'active') loop
    base := (coalesce(r.review_at, r.confirmed_at) at time zone 'Asia/Dhaka')::date;
    n := private.work_days_since(base);
    continue when n < 3;
    lbl := coalesce(private.dwg_label(r.project_id, r.phase), 'Drawing list');
    select count(*) filter (where i.st in ('drafted','checked','issued')) || ' of ' || count(*) || ' drawn · ' ||
           count(*) filter (where i.st in ('checked','issued')) || ' checked · ' || count(*) filter (where i.issue = 'gfc') || ' GFC' ||
           case when count(*) filter (where i.due < (now() at time zone 'Asia/Dhaka')::date and i.st in ('todo','doing')) > 0
                then ' · ' || count(*) filter (where i.due < (now() at time zone 'Asia/Dhaka')::date and i.st in ('todo','doing')) || ' past their date' else '' end
      into st from public.dwg_items i where i.project_id = r.project_id and i.phase = r.phase;
    for u in select id from public.profiles where active and designation = 'design_associate_lead' loop
      if not exists (select 1 from public.notifications x where x.user_id = u and x.task_ref = 'dwgrev:' || r.project_id || ':' || r.phase || '@' || base) then
        insert into public.notifications (user_id, kind, title, body, task_ref)
        values (u, 'dwg_review', left('Progress check: ' || lbl, 90), left(st || '. Open the drawing list and mark it reviewed.', 300),
                'dwgrev:' || r.project_id || ':' || r.phase || '@' || base);
      end if;
    end loop;
    if n >= 6 then
      for u in select id from public.profiles where active and designation = 'coo' loop
        if not exists (select 1 from public.notifications x where x.user_id = u and x.task_ref = 'dwgesc:' || r.project_id || ':' || r.phase || '@' || base) then
          insert into public.notifications (user_id, kind, title, body, task_ref)
          values (u, 'dwg_review', left('Progress check not done: ' || lbl, 90), left(n || ' working days since the last check (the weekly check-in counts). ' || st || '.', 300),
                  'dwgesc:' || r.project_id || ':' || r.phase || '@' || base);
        end if;
      end loop;
    end if;
  end loop;
end $function$;
