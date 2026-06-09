-- TTL hold: 'held'/'expired' statuses, hold_expires_at, widened exclusion + view,
-- broadcast fix, owner_zalo, confirm audit. See spec 2026-06-09.
--
-- A new 'held' status soft-locks a slot while a customer pays; it joins the GiST
-- exclusion constraint and public_availability so a hold atomically blocks a slot.
-- 'expired' is a terminal status for holds whose pay window elapsed; it drops out
-- of the exclusion predicate (freeing the slot) just like 'rejected'.

begin;

-- 1. Status CHECKs (drop both, recreate with held + expired). The booking check
--    is the inline auto-named booking_status_check (080001); the occurrence check
--    is booking_occurrence_status_check (080009).
alter table public.booking drop constraint if exists booking_status_check;
alter table public.booking
	add constraint booking_status_check
	check (status in ('held', 'pending', 'confirmed', 'rejected', 'expired'));

alter table public.booking_occurrence drop constraint if exists booking_occurrence_status_check;
alter table public.booking_occurrence
	add constraint booking_occurrence_status_check
	check (status in ('held', 'pending', 'confirmed', 'rejected', 'expired'));

-- 2. Expiry column (single source of truth; nullable, no backfill).
alter table public.booking add column if not exists hold_expires_at timestamptz;

-- 3. Widen the exclusion constraint to include 'held'. lock_timeout bounds the
--    ACCESS EXCLUSIVE lock so the rebuild can't block live writes indefinitely.
set local lock_timeout = '4s';
alter table public.booking_occurrence drop constraint if exists no_overlap;
alter table public.booking_occurrence
	add constraint no_overlap
	exclude using gist (court_id with =, time_range with &&)
	where (status in ('held', 'pending', 'confirmed'));

-- 4. public_availability: include held-not-expired, expose a non-PII 'held' flag.
--    The held filter joins booking for hold_expires_at; a held row whose window
--    elapsed reads as free even before the sweeper flips its status to 'expired'.
drop view if exists public.public_availability;
create view public.public_availability
	with (security_invoker = off)
as
select
	o.court_id,
	o.slot_date,
	o.time_range,
	true as occupied,
	(o.status = 'held') as held
from public.booking_occurrence o
join public.booking b on b.id = o.booking_id
where o.status in ('pending', 'confirmed')
   or (o.status = 'held' and b.hold_expires_at > now());
grant select on public.public_availability to anon, authenticated;

-- 5. Broadcast: treat held as occupied (was pending/confirmed only).
create or replace function public.broadcast_availability_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_court_id   uuid;
	v_time_range tstzrange;
	v_slot_date  date;
	v_status     text;
	v_occupied   boolean;
begin
	if tg_op = 'DELETE' then
		v_court_id   := old.court_id;
		v_time_range := old.time_range;
		v_slot_date  := old.slot_date;
		v_occupied   := false;
	else
		v_court_id   := new.court_id;
		v_time_range := new.time_range;
		v_slot_date  := new.slot_date;
		v_status     := new.status;
		v_occupied   := v_status in ('held', 'pending', 'confirmed');
	end if;

	perform realtime.send(
		jsonb_build_object(
			'court_id', v_court_id,
			'slot_date', v_slot_date,
			'time_range', v_time_range,
			'occupied', v_occupied
		),
		tg_op,                                            -- event name
		'availability:court:' || v_court_id::text,        -- topic (public channel)
		false                                             -- public (private = false)
	);
	return null;
end;
$$;

-- 6. owner_zalo + public_settings (drop+create re-grants). Keep the id = 1 filter
--    and the existing non-PII column list; add owner_zalo (a public contact link).
alter table public.settings add column if not exists owner_zalo text;
drop view if exists public.public_settings;
create view public.public_settings
	with (security_invoker = off)
as
select id, flat_hourly_rate_vnd, qr_image_path, owner_zalo
from public.settings
where id = 1;
grant select on public.public_settings to anon, authenticated;

-- 7. Confirm/reject audit log (owner-only). booking_id is nullable on delete so
--    the audit trail survives a removed booking.
create table if not exists public.booking_audit (
	id          uuid primary key default gen_random_uuid(),
	booking_id  uuid references public.booking (id) on delete set null,
	reference   text,
	action      text not null check (action in ('confirm', 'reject')),
	actor_uid   uuid,
	created_at  timestamptz not null default now()
);
alter table public.booking_audit enable row level security;
drop policy if exists booking_audit_owner_all on public.booking_audit;
create policy booking_audit_owner_all on public.booking_audit
	for all to authenticated using (public.is_owner()) with check (public.is_owner());

commit;
