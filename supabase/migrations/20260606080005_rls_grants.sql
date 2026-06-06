-- Tennis Court Booking v1 — Phase 1 (Database)
-- RLS, grants, and realtime authorization (§9). Posture: default-deny on every
-- base table; anon may read public_availability ONLY; the single owner (keyed on
-- their exact auth uid) gets full read/write via policies.

-- ---------------------------------------------------------------------------
-- is_owner(): true iff the current request is the seeded owner. SECURITY DEFINER
-- so it can read settings.owner_uid even though the caller cannot read settings.
-- ---------------------------------------------------------------------------
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.settings
		where id = 1 and owner_uid is not null and owner_uid = auth.uid()
	);
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- Default-deny RLS on all base tables. No anon policy anywhere => anon reads 0.
-- ---------------------------------------------------------------------------
alter table public.court              enable row level security;
alter table public.booking            enable row level security;
alter table public.booking_occurrence enable row level security;
alter table public.settings           enable row level security;

-- Strip every table privilege from anon (REVOKE ALL, §9). PostgREST then cannot
-- touch base tables as anon regardless of RLS.
revoke all on public.court              from anon;
revoke all on public.booking            from anon;
revoke all on public.booking_occurrence from anon;
revoke all on public.settings           from anon;

-- ---------------------------------------------------------------------------
-- Owner policies — keyed on the exact owner uid, not 'authenticated'.
-- A second authenticated (non-owner) account fails is_owner() and is denied.
-- ---------------------------------------------------------------------------
create policy court_owner_all on public.court
	for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy booking_owner_all on public.booking
	for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy booking_occurrence_owner_all on public.booking_occurrence
	for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy settings_owner_all on public.settings
	for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- The owner's session needs table privileges for the policies to have effect.
grant select, insert, update, delete on public.court              to authenticated;
grant select, insert, update, delete on public.booking            to authenticated;
grant select, insert, update, delete on public.booking_occurrence to authenticated;
grant select, insert, update, delete on public.settings           to authenticated;

-- ---------------------------------------------------------------------------
-- public_availability: anon's ONLY read. The view runs definer-side so it can
-- read the base table; anon is granted SELECT on the view alone.
-- ---------------------------------------------------------------------------
grant select on public.public_availability to anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_pending_booking: NOT executable by anon (§9). The public write path is
-- the server action (service-side), never a direct PostgREST RPC as anon.
-- ---------------------------------------------------------------------------
revoke all on function public.create_pending_booking(
	uuid, text, text, text, int, time, int, date, int, date
) from public, anon;

-- enumerate_slot_dates / pricing helpers are pure and PII-free; the server-side
-- preview (Phase 2) calls them under the service or owner context. anon does not
-- get EXECUTE (default revoke from public covers it; be explicit).
revoke all on function public.enumerate_slot_dates(text, date, int, date) from anon;
revoke all on function public.max_block_count() from anon;

-- ---------------------------------------------------------------------------
-- Realtime Authorization (§6.1): availability is a PUBLIC channel. Allow anon
-- (and authenticated) to RECEIVE broadcasts on availability:court:* topics only.
-- The payload is already PII-free (built by the broadcast trigger).
-- ---------------------------------------------------------------------------
create policy "anyone can receive availability broadcasts"
	on realtime.messages
	for select
	to anon, authenticated
	using (
		realtime.messages.extension = 'broadcast'
		and realtime.topic() like 'availability:court:%'
	);
