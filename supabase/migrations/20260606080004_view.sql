-- Tennis Court Booking v1 — Phase 1 (Database)
-- public_availability (§6.1): the ONLY thing anon may read. Its column list is
-- the security boundary — court_id, slot_date, time_range, occupied. No PII
-- (no name, phone, reference, amount, booking_id).
--
-- It exposes one row per currently-held occurrence (pending or confirmed). The
-- client renders the per-court 30-min grid by subtracting these occupied ranges
-- from the court's operating window. Rejected occurrences are absent, so a
-- rejected slot reads as free.
--
-- security_invoker=off (default): the view runs with the view owner's rights and
-- reads booking_occurrence even though anon has NO base-table SELECT and RLS is
-- default-deny. This is intentional and is the whole point of the view: anon is
-- granted SELECT on this view ONLY (see the RLS migration), and the view's
-- column list — not a base-table policy — is the non-PII security boundary.

create view public.public_availability
	with (security_invoker = off)
as
select
	o.court_id,
	o.slot_date,
	o.time_range,
	true as occupied
from public.booking_occurrence o
where o.status in ('pending', 'confirmed');
