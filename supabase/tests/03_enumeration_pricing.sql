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
	assert array_length(v_dates, 1) = 5, format('expected 5 Tuesdays in 2030-01, got %s', v_dates);
	assert v_dates[1] = date '2030-01-01' and v_dates[5] = date '2030-01-29', format('wrong Tuesdays: %s', v_dates);

	-- 2030-02 Tuesdays: Feb 5,12,19,26 -> 4.
	select count(*) into v_cnt
	from public.enumerate_slot_dates('monthly', date '2030-02-10', 2, null) as d;
	assert v_cnt = 4, format('expected 4 Tuesdays in 2030-02, got %s', v_cnt);

	-- Mid-month: for the CURRENT month + this exact weekday, every enumerated
	-- date must be >= today (mid-month start locks only remaining dates) and end
	-- within the month.
	select array_agg(d order by d) into v_dates
	from public.enumerate_slot_dates('monthly', v_today, extract(dow from v_today)::int, null) as d;
	assert v_dates[1] >= v_today, format('mid-month start leaked a past date: %s', v_dates);
	assert (select bool_and(extract(dow from x)::int = extract(dow from v_today)::int) from unnest(v_dates) x),
		'mid-month enumeration returned a wrong weekday';
	assert (select bool_and(date_trunc('month', x) = date_trunc('month', v_today)) from unnest(v_dates) x),
		'mid-month enumeration leaked beyond the month';

	-- Ad-hoc is exactly one date — the one supplied.
	select array_agg(d) into v_dates
	from public.enumerate_slot_dates('adhoc', null, null, date '2030-03-09') as d;
	assert v_dates = array[date '2030-03-09'], format('adhoc enumeration wrong: %s', v_dates);

	raise notice 'OK 03 enumeration';
end;
$$;
rollback;

-- Band-aware pricing via create_pending_booking: amount = per-block band rate
-- (price_span) * inserted-rows. Uses the current 12-arg auto-assign signature.
begin;
do $$
declare
	v_court uuid;
	v_ref   text;
	v_amt   bigint;
	v_occ   int;
begin
	insert into public.court (name, open_time, close_time) values ('P', time '06:00', time '21:00') returning id into v_court;
	-- Bands matching the advertised table; flat fallback (200k) only for pre-06:00.
	insert into public.settings (id, flat_hourly_rate_vnd, price_bands)
	values (1, 200000, '[{"start":"06:00","rate":350000},{"start":"11:00","rate":300000},{"start":"15:00","rate":350000},{"start":"17:00","rate":450000}]'::jsonb)
	on conflict (id) do update set
		flat_hourly_rate_vnd = excluded.flat_hourly_rate_vnd,
		price_bands = excluded.price_bands;

	-- price_span unit checks:
	-- within a band: 10:00 for 1h (2 blocks) -> 350000.
	assert public.price_span(time '10:00', 2) = 350000, format('within-band span %s', public.price_span(time '10:00', 2));
	-- crossing 17:00: 16:00 for 2h (4 blocks) -> 350000 + 450000 = 800000.
	assert public.price_span(time '16:00', 4) = 800000, format('boundary-crossing span %s', public.price_span(time '16:00', 4));

	-- p_hold_minutes => null is passed to uniquely select the 12-arg overload
	-- (an older 11-arg overload without p_hold_minutes still coexists, §RPC history).

	-- Ad-hoc, 10:00 for 1h, 1 occurrence -> 350000 * 1.
	select reference, amount_vnd, occurrences into v_ref, v_amt, v_occ
	from public.create_pending_booking('adhoc', 'A', '1', 1, time '10:00', 2, p_date => date '2030-04-10', p_hold_minutes => null);
	assert v_occ = 1, format('adhoc rows %s', v_occ);
	assert v_amt = 350000, format('adhoc amount %s', v_amt);
	assert length(v_ref) >= 8, format('reference too short: %s', v_ref);

	-- Ad-hoc crossing the 17:00 boundary: 16:00 for 2h -> 800000 * 1 occurrence.
	select amount_vnd into v_amt
	from public.create_pending_booking('adhoc', 'A', '1', 1, time '16:00', 4, p_date => date '2030-04-11', p_hold_minutes => null);
	assert v_amt = 800000, format('boundary-crossing amount %s', v_amt);

	-- Monthly, 12:00 for 1.5h (300k band, 12:00–13:30), Wednesdays in 2030-05
	-- (dow=3): 5 dates -> 300000 * 1.5 * 5 = 2,250,000.
	select amount_vnd, occurrences into v_amt, v_occ
	from public.create_pending_booking('monthly', 'B', '2', 1, time '12:00', 3, p_month => date '2030-05-15', p_weekdays => array[3], p_hold_minutes => null);
	assert v_occ = 5, format('monthly rows %s', v_occ);
	assert v_amt = 2250000, format('monthly amount %s', v_amt);

	raise notice 'OK 03 pricing';
end;
$$;
rollback;

-- price_bands_valid backstop: accepts canonical bands, rejects malformed ones.
do $$
begin
	assert public.price_bands_valid('[{"start":"06:00","rate":350000},{"start":"11:00","rate":300000}]'::jsonb), 'valid bands rejected';
	assert not public.price_bands_valid('[]'::jsonb), 'empty array accepted';
	assert not public.price_bands_valid('[{"start":"06:15","rate":350000}]'::jsonb), 'non-30-min-aligned start accepted';
	assert not public.price_bands_valid('[{"start":"06:00","rate":0}]'::jsonb), 'non-positive rate accepted';
	assert not public.price_bands_valid('[{"start":"06:00","rate":350000},{"start":"06:00","rate":300000}]'::jsonb), 'duplicate starts accepted';
	assert not public.price_bands_valid('[{"rate":350000}]'::jsonb), 'missing start accepted';
	raise notice 'OK 03 price_bands_valid';
end;
$$;
