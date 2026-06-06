-- DB tests (§11): monthly occurrence counts (4 vs 5 weekday months), mid-month
-- start, and pricing = rate * hours * inserted-rows (ad-hoc + monthly).
-- enumerate_slot_dates floors the start at max(today_ict, first-of-month); the
-- count tests use months far in the future so the floor is the 1st (full month).

begin;
do $$
declare
	v_cnt   int;
	v_dates date[];
	v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
	-- Full-month counts. Pick months safely in the future (year 2030) so the
	-- enumeration starts on the 1st regardless of the real clock.
	-- 2030-01 Tuesdays (dow=2): Jan 1,8,15,22,29 -> 5.
	select array_agg(d order by d) into v_dates
	from public.enumerate_slot_dates('monthly', date '2030-01-15', 2, null) as d;
	assert array_length(v_dates, 1) = 5, format('expected 5 Tuesdays in 2030-01, got %', v_dates);
	assert v_dates[1] = date '2030-01-01' and v_dates[5] = date '2030-01-29', format('wrong Tuesdays: %', v_dates);

	-- 2030-02 Tuesdays: Feb 5,12,19,26 -> 4.
	select count(*) into v_cnt
	from public.enumerate_slot_dates('monthly', date '2030-02-10', 2, null) as d;
	assert v_cnt = 4, format('expected 4 Tuesdays in 2030-02, got %', v_cnt);

	-- Mid-month: for the CURRENT month + this exact weekday, every enumerated
	-- date must be >= today (mid-month start locks only remaining dates) and end
	-- within the month.
	select array_agg(d order by d) into v_dates
	from public.enumerate_slot_dates('monthly', v_today, extract(dow from v_today)::int, null) as d;
	assert v_dates[1] >= v_today, format('mid-month start leaked a past date: %', v_dates);
	assert (select bool_and(extract(dow from x)::int = extract(dow from v_today)::int) from unnest(v_dates) x),
		'mid-month enumeration returned a wrong weekday';
	assert (select bool_and(date_trunc('month', x) = date_trunc('month', v_today)) from unnest(v_dates) x),
		'mid-month enumeration leaked beyond the month';

	-- Ad-hoc is exactly one date — the one supplied.
	select array_agg(d) into v_dates
	from public.enumerate_slot_dates('adhoc', null, null, date '2030-03-09') as d;
	assert v_dates = array[date '2030-03-09'], format('adhoc enumeration wrong: %', v_dates);

	raise notice 'OK 03 enumeration';
end;
$$;
rollback;

-- Pricing via create_pending_booking: amount = rate * hours * inserted-rows.
begin;
do $$
declare
	v_court uuid;
	v_rate  bigint := 200000;
	v_ref   text;
	v_amt   bigint;
	v_occ   int;
begin
	insert into public.court (name, open_time, close_time) values ('P', time '06:00', time '21:00') returning id into v_court;
	insert into public.settings (id, flat_hourly_rate_vnd) values (1, v_rate)
	on conflict (id) do update set flat_hourly_rate_vnd = excluded.flat_hourly_rate_vnd;

	-- Ad-hoc, 2 blocks = 1h, 1 occurrence -> 200000 * 1 * 1.
	select reference, amount_vnd, occurrences into v_ref, v_amt, v_occ
	from public.create_pending_booking(v_court, 'adhoc', 'A', '1', 1, time '10:00', 2, null, null, date '2030-04-10');
	assert v_occ = 1, format('adhoc rows %', v_occ);
	assert v_amt = v_rate * 1 * 1, format('adhoc amount %', v_amt);
	assert length(v_ref) >= 8, format('reference too short: %', v_ref);

	-- Monthly, 3 blocks = 1.5h, Wednesdays in 2030-05 (dow=3): May 1,8,15,22,29
	-- -> 5 occurrences -> 200000 * 1.5 * 5 = 1,500,000.
	select amount_vnd, occurrences into v_amt, v_occ
	from public.create_pending_booking(v_court, 'monthly', 'B', '2', 1, time '14:00', 3, date '2030-05-15', 3, null);
	assert v_occ = 5, format('monthly rows %', v_occ);
	assert v_amt = (v_rate * 1.5 * 5)::bigint, format('monthly amount %', v_amt);

	raise notice 'OK 03 pricing';
end;
$$;
rollback;
