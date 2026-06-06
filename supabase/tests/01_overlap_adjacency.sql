-- DB tests (§11): overlap rejected, adjacency allowed, generated slot_date,
-- reject frees the slot. Run later against the linked DB, e.g.:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/01_overlap_adjacency.sql
-- Each test runs in a transaction it rolls back, leaving no residue.

begin;
do $$
declare
	v_court  uuid;
	v_b1     uuid;
	v_b2     uuid;
	v_failed boolean;
	v_slot   date;
begin
	insert into public.court (name, open_time, close_time)
	values ('T', time '06:00', time '21:00') returning id into v_court;

	insert into public.booking (court_id, type, customer_name, zalo_phone, status, reference, amount_vnd)
	values (v_court, 'adhoc', 'A', '1', 'pending', 'REF00001', 0) returning id into v_b1;

	-- Base occupied range 10:00–11:00 ICT.
	insert into public.booking_occurrence (booking_id, court_id, time_range, status)
	values (v_b1, v_court,
		tstzrange((date '2026-07-01' + time '10:00') at time zone 'Asia/Ho_Chi_Minh',
		          (date '2026-07-01' + time '11:00') at time zone 'Asia/Ho_Chi_Minh', '[)'),
		'pending');

	-- (1) Generated slot_date is the ICT calendar date of the start instant.
	select slot_date into v_slot from public.booking_occurrence where booking_id = v_b1;
	assert v_slot = date '2026-07-01', format('slot_date wrong: %', v_slot);

	-- (2) Overlap on the same court is rejected by no_overlap.
	insert into public.booking (court_id, type, customer_name, zalo_phone, status, reference, amount_vnd)
	values (v_court, 'adhoc', 'B', '2', 'pending', 'REF00002', 0) returning id into v_b2;
	v_failed := false;
	begin
		insert into public.booking_occurrence (booking_id, court_id, time_range, status)
		values (v_b2, v_court,
			tstzrange((date '2026-07-01' + time '10:30') at time zone 'Asia/Ho_Chi_Minh',
			          (date '2026-07-01' + time '11:30') at time zone 'Asia/Ho_Chi_Minh', '[)'),
			'pending');
	exception when exclusion_violation then
		v_failed := true;
	end;
	assert v_failed, 'overlapping occurrence was NOT rejected';

	-- (3) Adjacency allowed: [09:30,10:00) and [11:00,11:30) coexist with the base.
	insert into public.booking_occurrence (booking_id, court_id, time_range, status)
	values (v_b2, v_court,
		tstzrange((date '2026-07-01' + time '09:30') at time zone 'Asia/Ho_Chi_Minh',
		          (date '2026-07-01' + time '10:00') at time zone 'Asia/Ho_Chi_Minh', '[)'),
		'pending');
	insert into public.booking_occurrence (booking_id, court_id, time_range, status)
	values (v_b2, v_court,
		tstzrange((date '2026-07-01' + time '11:00') at time zone 'Asia/Ho_Chi_Minh',
		          (date '2026-07-01' + time '11:30') at time zone 'Asia/Ho_Chi_Minh', '[)'),
		'pending');

	-- (4) Rejecting the base booking frees its slot: a range that previously
	-- overlapped b1's 10:00–11:00 (here 10:00–10:30, which does not touch b2's
	-- own 09:30–10:00 / 11:00–11:30 ranges) now inserts successfully.
	update public.booking set status = 'rejected' where id = v_b1;
	assert (select status from public.booking_occurrence where booking_id = v_b1) = 'rejected',
		'reject trigger did not mirror status to occurrence';
	insert into public.booking_occurrence (booking_id, court_id, time_range, status)
	values (v_b2, v_court,
		tstzrange((date '2026-07-01' + time '10:00') at time zone 'Asia/Ho_Chi_Minh',
		          (date '2026-07-01' + time '10:30') at time zone 'Asia/Ho_Chi_Minh', '[)'),
		'pending');

	raise notice 'OK 01_overlap_adjacency';
end;
$$;
rollback;
