-- No entry PIN for the Principal and the COO (Principal, 23 Nov 2026).
-- Their morning greeting on a computer is the plain tap-in again, so log_day_in must write their computer entry
-- even if they set a PIN earlier. Everyone else keeps the PIN: only the PIN writes their computer entry.

create or replace function public.log_day_in(p_device text) returns void
language plpgsql security definer set search_path to '' as $$
declare d date := (now() at time zone 'Asia/Dhaka')::date; dev text := case when p_device = 'mobile' then 'mobile' else 'computer' end;
begin
  if (select auth.uid()) is null then return; end if;
  if dev = 'computer' and not private.is_top()
     and exists(select 1 from private.entry_pins where user_id = (select auth.uid())) then return; end if;
  insert into public.day_log (user_id, day, device, in_at) values ((select auth.uid()), d, dev, now())
  on conflict (user_id, day, device) do update set in_at = coalesce(public.day_log.in_at, excluded.in_at);
end $$;

-- their old PINs are no longer used
delete from private.entry_pins e using public.profiles p
where p.id = e.user_id and p.designation in ('principal', 'coo');
