-- Tennis Court Booking — auto-assign court + multi-weekday recurring + bank QR.
--
-- The customer no longer picks a court. create_pending_booking now:
--   * accepts an array of weekdays (one monthly booking can cover T2/T4/T6),
--   * auto-assigns ONE court for the whole series, balanced across courts,
--     honoring an optional preferred court when it is free for every occurrence,
--   * returns the assigned court so the receipt can name it.
-- Also adds owner bank fields to settings for dynamic VietQR generation.

set search_path = public;

-- ---------------------------------------------------------------------------
-- Owner bank details for dynamic VietQR (built server-side in the action; never
-- exposed via the anon public_settings view).
-- ---------------------------------------------------------------------------
alter table public.settings
	add column if not exists bank_bin            text,
	add column if not exists bank_account_number text,
	add column if not exists bank_account_name   text;

-- ---------------------------------------------------------------------------
-- Replace create_pending_booking with the auto-court / multi-weekday variant.
-- The signature changes (p_court_id removed; p_weekdays / p_preferred_court_id /
-- p_force_court added; court returned), so drop the old function first.
-- ---------------------------------------------------------------------------
drop function if exists public.create_pending_booking(
	uuid, text, text, text, int, time, int, date, int, date
);

create or replace function public.create_pending_booking(
	p_type             text,
	p_customer_name    text,
	p_zalo_phone       text,
	p_group_size       int,
	p_start_time       time,
	p_block_count      int,
	p_month            date    default null,
	p_weekdays         int[]   default null,
	p_date             date    default null,
	p_preferred_court_id uuid  default null,
	p_force_court      boolean default false
)
returns table (reference text, amount_vnd bigint, occurrences int, court_id uuid, court_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
	v_rate       bigint;
	v_alphabet   text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- ambiguity-free (no 0/O/1/I/L)
	v_reference  text := '';
	v_i          int;
	v_end_time   time;
	v_duration   interval := (p_block_count * 30) * interval '1 minute';
	v_hours      numeric;
	v_amount     bigint;
	v_count      int;
	v_dates      date[];
	v_booking_id uuid;
	v_slot_date  date;
	v_range      tstzrange;
	v_cand       record;
begin
	-- Hardened input validation (§6) — the function is the trust boundary of record.
	if p_type not in ('monthly', 'adhoc') then
		raise exception 'invalid booking type';
	end if;
	if coalesce(p_customer_name, '') = '' then
		raise exception 'customer_name required';
	end if;
	if coalesce(p_zalo_phone, '') = '' then
		raise exception 'zalo_phone required';
	end if;
	if coalesce(p_group_size, 0) < 1 then
		raise exception 'group_size must be >= 1';
	end if;
	if p_block_count is null or p_block_count < 1 or p_block_count > public.max_block_count() then
		raise exception 'block_count out of range (1..%)', public.max_block_count();
	end if;
	if extract(minute from p_start_time) not in (0, 30) or extract(second from p_start_time) <> 0 then
		raise exception 'start_time must be 30-min aligned';
	end if;
	v_end_time := p_start_time + v_duration;

	select flat_hourly_rate_vnd into v_rate from public.settings where id = 1;
	if v_rate is null then
		raise exception 'settings row missing';
	end if;

	-- Build the occurrence date set. Monthly = union over every selected weekday.
	if p_type = 'adhoc' then
		if p_date is null then
			raise exception 'adhoc booking requires p_date';
		end if;
		v_dates := array(select d from public.enumerate_slot_dates('adhoc', null, null, p_date) as d);
	else
		if p_month is null or p_weekdays is null or array_length(p_weekdays, 1) is null then
			raise exception 'monthly booking requires p_month and p_weekdays';
		end if;
		v_dates := array(
			select distinct d
			from unnest(p_weekdays) as wd
			cross join lateral public.enumerate_slot_dates('monthly', p_month, wd, null) as d
			order by d
		);
	end if;

	v_count := coalesce(array_length(v_dates, 1), 0);
	if v_count = 0 then
		raise exception 'no occurrences to book for the requested period';
	end if;

	-- One crypto-random reference for the booking, reused across court attempts
	-- (a rolled-back attempt leaves no row, so there is no unique collision).
	for v_i in 1..8 loop
		v_reference := v_reference
			|| substr(v_alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(v_alphabet)), 1);
	end loop;

	v_hours  := (p_block_count::numeric) / 2;
	v_amount := (v_rate * v_hours * v_count)::bigint;

	-- Candidate courts: preferred first (or ONLY, when forced), then least-loaded
	-- over the series' dates, tie-broken by created_at. The booking holds ONE court
	-- for the whole series (court_id flows to occurrences via the trigger).
	for v_cand in
		select c.id, c.name, c.open_time, c.close_time
		from public.court c
		where c.is_active
		  and (not p_force_court or c.id = p_preferred_court_id)
		order by
			(c.id is not distinct from p_preferred_court_id) desc,
			(
				select count(*)
				from public.booking_occurrence o
				where o.court_id = c.id
				  and o.status in ('pending', 'confirmed')
				  and o.slot_date = any(v_dates)
			) asc,
			c.created_at asc
	loop
		-- The requested range must sit within this court's operating window.
		if p_start_time < v_cand.open_time or v_end_time > v_cand.close_time then
			continue;
		end if;

		-- Attempt the whole series on this court atomically. A conflict on ANY date
		-- raises the exclusion constraint; the sub-block rolls back and we try next.
		begin
			insert into public.booking (court_id, type, customer_name, zalo_phone, group_size, status, reference, amount_vnd, source)
			values (v_cand.id, p_type, p_customer_name, p_zalo_phone, p_group_size, 'pending', v_reference, v_amount, 'public')
			returning id into v_booking_id;

			foreach v_slot_date in array v_dates loop
				v_range := tstzrange(
					(v_slot_date + p_start_time) at time zone 'Asia/Ho_Chi_Minh',
					(v_slot_date + v_end_time)   at time zone 'Asia/Ho_Chi_Minh',
					'[)'
				);
				insert into public.booking_occurrence (booking_id, court_id, time_range, status)
				values (v_booking_id, v_cand.id, v_range, 'pending');
			end loop;

			-- Success: this court hosts the entire series.
			return query select v_reference, v_amount, v_count, v_cand.id, v_cand.name;
			return;
		exception
			when exclusion_violation then
				-- This court is busy on at least one date; fall through to the next.
				v_booking_id := null;
		end;
	end loop;

	-- No single active court could host every occurrence of the series.
	raise exception 'no_court_available';
end;
$$;

-- Match the original execute posture (§9): not callable by anon. The public path
-- is the service-side action; owner manual booking runs as authenticated. anon is
-- revoked explicitly; authenticated + service_role keep their Supabase defaults.
revoke all on function public.create_pending_booking(
	text, text, text, int, time, int, date, int[], date, uuid, boolean
) from public, anon;
