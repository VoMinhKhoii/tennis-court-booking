-- DB tests (§11): anon denied on base tables, anon cannot EXECUTE the create
-- function, anon CAN read public_availability, and the create function hardcodes
-- status='pending'/source='public' (callers cannot spoof status/amount/source —
-- those are not even parameters).

-- (A) Hardcoded status/source + derived amount. Runs as the migration owner.
begin;
do $$
declare
	v_court uuid;
	v_ref   text;
	v_status text;
	v_source text;
	v_amt   bigint;
begin
	insert into public.court (name, open_time, close_time) values ('S', time '06:00', time '21:00') returning id into v_court;
	insert into public.settings (id, flat_hourly_rate_vnd) values (1, 200000)
	on conflict (id) do update set flat_hourly_rate_vnd = excluded.flat_hourly_rate_vnd;

	select reference into v_ref
	from public.create_pending_booking(v_court, 'adhoc', 'A', '1', 1, time '09:00', 2, null, null, date '2030-06-10');

	select status, source, amount_vnd into v_status, v_source, v_amt
	from public.booking where reference = v_ref;
	assert v_status = 'pending', format('status not forced to pending: %', v_status);
	assert v_source = 'public',  format('source not forced to public: %', v_source);
	assert v_amt = 200000, format('amount not derived server-side: %', v_amt);

	-- Out-of-hours range is rejected server-side (court closes 21:00).
	declare
		v_failed boolean := false;
	begin
		begin
			perform public.create_pending_booking(v_court, 'adhoc', 'A', '1', 1, time '20:30', 2, null, null, date '2030-06-11');
		exception when others then
			v_failed := true;
		end;
		assert v_failed, 'out-of-hours range was not rejected';
	end;

	raise notice 'OK 04A hardcoded fields + validation';
end;
$$;
rollback;

-- (B) anon is denied on base tables and cannot execute the create function,
-- but CAN read public_availability.
begin;
-- Seed a held occurrence as the owner-side (default) role so the view has a row.
do $$
declare v_court uuid; v_b uuid;
begin
	insert into public.court (name, open_time, close_time) values ('V', time '06:00', time '21:00') returning id into v_court;
	insert into public.booking (court_id, type, customer_name, zalo_phone, status, reference, amount_vnd)
	values (v_court, 'adhoc', 'Secret Name', '0900', 'confirmed', 'REFVIEW1', 100000) returning id into v_b;
	insert into public.booking_occurrence (booking_id, court_id, time_range, status)
	values (v_b, v_court,
		tstzrange((date '2030-07-01' + time '10:00') at time zone 'Asia/Ho_Chi_Minh',
		          (date '2030-07-01' + time '11:00') at time zone 'Asia/Ho_Chi_Minh', '[)'),
		'confirmed');
end;
$$;

set local role anon;

do $$
declare v_denied boolean; v_cnt int;
begin
	-- Base-table reads denied (permission denied = 42501, RLS no-row = 0 rows).
	-- REVOKE ALL makes these raise insufficient_privilege.
	v_denied := false;
	begin perform 1 from public.booking limit 1; exception when insufficient_privilege then v_denied := true; end;
	assert v_denied, 'anon could read public.booking';

	v_denied := false;
	begin perform 1 from public.booking_occurrence limit 1; exception when insufficient_privilege then v_denied := true; end;
	assert v_denied, 'anon could read public.booking_occurrence';

	v_denied := false;
	begin perform 1 from public.court limit 1; exception when insufficient_privilege then v_denied := true; end;
	assert v_denied, 'anon could read public.court';

	v_denied := false;
	begin perform 1 from public.settings limit 1; exception when insufficient_privilege then v_denied := true; end;
	assert v_denied, 'anon could read public.settings';

	-- create function not executable by anon.
	v_denied := false;
	begin
		perform public.create_pending_booking(gen_random_uuid(), 'adhoc', 'X', '1', 1, time '10:00', 2, null, null, date '2030-07-02');
	exception when insufficient_privilege then v_denied := true; end;
	assert v_denied, 'anon could EXECUTE create_pending_booking';

	-- public_availability IS readable, and exposes no PII columns (only the 4).
	select count(*) into v_cnt from public.public_availability;
	assert v_cnt >= 1, 'anon could not read public_availability';

	raise notice 'OK 04B anon denials + view access';
end;
$$;

reset role;
rollback;

-- (C) The view's column set is exactly the non-PII boundary.
do $$
declare v_cols text;
begin
	select string_agg(column_name, ',' order by ordinal_position) into v_cols
	from information_schema.columns
	where table_schema = 'public' and table_name = 'public_availability';
	assert v_cols = 'court_id,slot_date,time_range,occupied',
		format('public_availability columns drifted: %', v_cols);
	raise notice 'OK 04C view column boundary';
end;
$$;
