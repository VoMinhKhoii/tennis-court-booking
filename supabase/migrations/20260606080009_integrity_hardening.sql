-- Tennis Court Booking v1 — integrity hardening (from PR #1 review).
-- Two belt-and-suspenders guards around the overlap invariant.

-- 1. Whitelist booking_occurrence.status. The partial exclusion constraint keys
--    on status IN ('pending','confirmed'); an out-of-set value would silently
--    drop a row out of the overlap predicate. The parent booking already has
--    this CHECK; mirror it on the occurrence.
alter table public.booking_occurrence
	add constraint booking_occurrence_status_check
	check (status in ('pending', 'confirmed', 'rejected'));

-- 2. court_id is derived from the parent on INSERT via occurrence_set_court_id().
--    Extend the same guard to UPDATE so a stray court_id change can't move an
--    occurrence onto a different court's overlap space.
drop trigger if exists occurrence_set_court_id_trg on public.booking_occurrence;
create trigger occurrence_set_court_id_trg
	before insert or update on public.booking_occurrence
	for each row execute function public.occurrence_set_court_id();

-- Note: a cross-midnight CHECK was considered and skipped — create_pending_booking
-- builds time_range strictly within a court's same-day open/close window (close >
-- open as plain time), so an occurrence cannot span midnight by construction.
