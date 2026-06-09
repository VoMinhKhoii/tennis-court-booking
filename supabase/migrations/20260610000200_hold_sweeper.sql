-- Sweeper: expire holds whose pay window elapsed. Flipping booking.status to
-- 'expired' fires booking_status_mirror, which cascades to the occurrences and
-- drops them out of the no_overlap predicate (freeing the slot) and broadcasts
-- occupied=false. A pg_cron job runs it every minute.

set search_path = public;

create or replace function public.expire_stale_holds()
returns void
language sql
security definer
set search_path = ''
as $$
	update public.booking set status = 'expired'
	where status = 'held' and hold_expires_at < now();
$$;

revoke all on function public.expire_stale_holds() from public, anon;

-- pg_cron schedules the sweep. If pg_cron is unavailable on the plan, the view
-- already hides holds whose window elapsed; re-bookability of a just-expired slot
-- then waits for the next conflicting insert. Prefer enabling pg_cron in the
-- Supabase dashboard (Database → Extensions).
create extension if not exists pg_cron;

-- Idempotent (re)schedule: unschedule any prior job of this name, then schedule.
do $$
begin
	if exists (select 1 from cron.job where jobname = 'expire-stale-holds') then
		perform cron.unschedule('expire-stale-holds');
	end if;
	perform cron.schedule('expire-stale-holds', '* * * * *', $sql$select public.expire_stale_holds();$sql$);
end;
$$;
