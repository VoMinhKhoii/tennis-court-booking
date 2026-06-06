-- Tennis Court Booking v1 — Phase 1 (Database)
-- Wire the integrity + broadcast triggers (§5, §6.1).

-- court_id always derived from the parent booking, never trusted from input.
create trigger occurrence_set_court_id_trg
	before insert on public.booking_occurrence
	for each row execute function public.occurrence_set_court_id();

-- Single source of truth for occurrence.status: mirror it off booking.status.
create trigger booking_status_mirror_trg
	after update of status on public.booking
	for each row execute function public.booking_status_mirror();

-- PII-safe availability broadcast on every occupancy change.
create trigger broadcast_availability_change_trg
	after insert or update or delete on public.booking_occurrence
	for each row execute function public.broadcast_availability_change();
