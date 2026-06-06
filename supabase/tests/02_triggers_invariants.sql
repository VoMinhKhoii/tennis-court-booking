-- DB tests (§11): occurrence.court_id == parent (never trusted from input);
-- occurrence/parent status invariant (no active child under a rejected parent).

begin;
do $$
declare
	v_court_a uuid;
	v_court_b uuid;
	v_b       uuid;
	v_occ_ct  uuid;
	v_bad     int;
begin
	insert into public.court (name, open_time, close_time) values ('A', time '06:00', time '21:00') returning id into v_court_a;
	insert into public.court (name, open_time, close_time) values ('B', time '06:00', time '21:00') returning id into v_court_b;

	insert into public.booking (court_id, type, customer_name, zalo_phone, status, reference, amount_vnd)
	values (v_court_a, 'adhoc', 'A', '1', 'pending', 'REF00010', 0) returning id into v_b;

	-- Insert with a SPOOFED court_id (the other court). Trigger must overwrite it
	-- with the parent's court_id.
	insert into public.booking_occurrence (booking_id, court_id, time_range, status)
	values (v_b, v_court_b,
		tstzrange((date '2026-07-02' + time '10:00') at time zone 'Asia/Ho_Chi_Minh',
		          (date '2026-07-02' + time '11:00') at time zone 'Asia/Ho_Chi_Minh', '[)'),
		'pending');

	select court_id into v_occ_ct from public.booking_occurrence where booking_id = v_b;
	assert v_occ_ct = v_court_a, 'occurrence.court_id was not forced to the parent court';

	-- Invariant: after rejecting the parent, NO child remains in (pending,confirmed).
	update public.booking set status = 'rejected' where id = v_b;
	select count(*) into v_bad
	from public.booking_occurrence o
	join public.booking p on p.id = o.booking_id
	where p.status = 'rejected' and o.status in ('pending', 'confirmed');
	assert v_bad = 0, 'invariant violated: active occurrence under a rejected parent';

	-- Confirm path also mirrors: pending -> confirmed keeps the child active.
	insert into public.booking (court_id, type, customer_name, zalo_phone, status, reference, amount_vnd)
	values (v_court_a, 'adhoc', 'C', '2', 'pending', 'REF00011', 0) returning id into v_b;
	insert into public.booking_occurrence (booking_id, court_id, time_range, status)
	values (v_b, v_court_a,
		tstzrange((date '2026-07-03' + time '08:00') at time zone 'Asia/Ho_Chi_Minh',
		          (date '2026-07-03' + time '09:00') at time zone 'Asia/Ho_Chi_Minh', '[)'),
		'pending');
	update public.booking set status = 'confirmed', confirmed_at = now() where id = v_b;
	assert (select status from public.booking_occurrence where booking_id = v_b) = 'confirmed',
		'confirm did not mirror to occurrence';

	raise notice 'OK 02_triggers_invariants';
end;
$$;
rollback;
