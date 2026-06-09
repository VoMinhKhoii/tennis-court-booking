-- DB tests (§11): TTL-hold lifecycle. A 'held' occurrence is accepted by the
-- widened CHECK and blocks the slot via no_overlap; create_pending_booking's hold
-- mode (p_hold_minutes) creates a 'held' booking with a future hold_expires_at.
-- Run later against the linked DB, e.g.:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/06_hold_lifecycle.sql
-- Each test runs in a transaction it rolls back, leaving no residue.

\set ON_ERROR_STOP on

-- (Task 1) A held occurrence is accepted by the new CHECK and blocks the slot.
begin;
do $$
declare
	c        uuid;
	b        uuid;
	v_failed boolean;
begin
	select id into c from public.court where is_active limit 1;

	insert into public.booking (court_id, type, customer_name, zalo_phone, status, reference, amount_vnd, hold_expires_at, source)
	values (c, 'adhoc', 'TST_HOLD', '0900000000', 'held', 'TSTHOLD1', 100000, now() + interval '15 min', 'public')
	returning id into b;
	insert into public.booking_occurrence (booking_id, court_id, time_range, status)
	values (b, c, tstzrange('2031-01-01 00:00+00', '2031-01-01 01:00+00', '[)'), 'held');

	-- A second held on the same slot must violate no_overlap.
	v_failed := false;
	begin
		insert into public.booking (court_id, type, customer_name, zalo_phone, status, reference, amount_vnd, hold_expires_at, source)
		values (c, 'adhoc', 'TST_HOLD2', '0900000001', 'held', 'TSTHOLD2', 100000, now() + interval '15 min', 'public')
		returning id into b;
		insert into public.booking_occurrence (booking_id, court_id, time_range, status)
		values (b, c, tstzrange('2031-01-01 00:00+00', '2031-01-01 01:00+00', '[)'), 'held');
	exception when exclusion_violation then
		v_failed := true;
	end;
	assert v_failed, 'second held on same slot was NOT rejected by no_overlap';

	raise notice 'OK 06_hold_lifecycle (held CHECK + no_overlap)';
end;
$$;
rollback;

-- (Task 2) Hold mode: create_pending_booking(..., p_hold_minutes => 15) creates a
-- 'held' booking with a future hold_expires_at.
begin;
do $$
declare
	r        record;
	v_status text;
	v_expiry timestamptz;
begin
	select * into r from public.create_pending_booking(
		p_type             => 'adhoc',
		p_customer_name    => 'TST_HOLDMODE',
		p_zalo_phone       => '0900000002',
		p_group_size       => 1,
		p_start_time       => time '08:00',
		p_block_count      => 2,
		p_date             => date '2031-02-02',
		p_hold_minutes     => 15
	);
	assert r.reference is not null, 'hold-mode call returned no reference';

	select status, hold_expires_at into v_status, v_expiry
	from public.booking where reference = r.reference;
	assert v_status = 'held', format('expected status held, got %s', v_status);
	assert v_expiry > now(), format('expected hold_expires_at in the future, got %s', v_expiry);

	raise notice 'OK 06_hold_lifecycle (hold mode)';
end;
$$;
rollback;
