-- Review logins: fixes applied by Claude on 7 and 9 Nov 2026 (already in the database; safe to re-run).

-- 1. Open = not banned. The set-up used to write the window's end into banned_until, which blocked the logins for the whole window.
create or replace function public.review_open(p_kind text, p_days integer)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare rid uuid; u timestamptz := now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)));
begin
  if not private.review_admin() then raise exception 'Only the Principal manages review logins.'; end if;
  update private.reviewers set until = u, off_at = null where kind = p_kind returning id into rid;
  if rid is null then raise exception 'That review login was not found.'; end if;
  update auth.users set banned_until = null where id = rid;
  insert into public.activity_log (actor, table_name, row_id, action, subject_user, is_private, after)
  values (auth.uid(), 'account', rid::text, 'review_open', rid, true, jsonb_build_object('view', p_kind, 'until', u));
  return jsonb_build_object('until', u);
end $function$;

-- 2. Every 10 minutes: ban and sign out a review login whose window has ended or that was ended.
create or replace function private.review_expire()
 returns void language plpgsql security definer set search_path to ''
as $function$
declare r record;
begin
  for r in select id from private.reviewers where (off_at is not null or until <= now())
  loop
    update auth.users set banned_until = now() + interval '100 years'
     where id = r.id and (banned_until is null or banned_until < now() + interval '50 years');
    delete from auth.sessions where user_id = r.id;
    delete from private.pin_sessions where user_id = r.id;
  end loop;
end $function$;
revoke all on function private.review_expire() from public, anon, authenticated;
select cron.schedule('slate-review-expire', '*/10 * * * *', $$select private.review_expire()$$);

-- 3. No PIN for review logins (read-only and time-limited) to open Business and Books.
create or replace function private.pin_required()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select auth.uid() is not null and not private.is_reviewer() and (
    private.is_owner() or private.is_coo() or private.fin_role() is not null
    or coalesce(private.books_role() in ('COO', 'Accountant', 'Viewer'), false))
$function$;
