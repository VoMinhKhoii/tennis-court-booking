-- Time-band pricing. The venue prices by time-of-day: an ordered set of bands,
-- each = { start "HH:MM", rate VND/hour }. A band applies from its start until the
-- next band's start; the last runs to court close. Replaces the single flat rate
-- as the pricing model; flat_hourly_rate_vnd is kept only as a fallback for any
-- minute earlier than the first band's start.
--
-- Amount is computed per 30-min block against the band that block falls in, so a
-- span crossing a boundary (e.g. 16:00–18:00) is priced correctly. price_span()
-- is the authoritative per-occurrence amount; lib/booking/pricing.ts mirrors it.

set search_path = public;

-- Ordered band array on the single settings row. Default backfills the id=1 row
-- to match the advertised "Bảng Giá Theo Giờ" table.
alter table public.settings
	add column if not exists price_bands jsonb not null
	default '[{"start":"06:00","rate":350000},{"start":"11:00","rate":300000},{"start":"15:00","rate":350000},{"start":"17:00","rate":450000}]'::jsonb;

alter table public.settings
	add constraint settings_price_bands_nonempty
	check (jsonb_typeof(price_bands) = 'array' and jsonb_array_length(price_bands) >= 1);

-- Per-occurrence amount (VND) for a span: for each 30-min block, the rate is the
-- band with the greatest start <= the block's minute (else the flat fallback);
-- each block contributes rate/2. Truncated to bigint, matching the TS mirror.
create or replace function public.price_span(p_start_time time, p_block_count int)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
	v_bands  jsonb;
	v_flat   bigint;
	v_total  numeric := 0;
	v_i      int;
	v_min    int;
	v_start  int := (extract(hour from p_start_time) * 60 + extract(minute from p_start_time))::int;
	v_rate   bigint;
begin
	select price_bands, flat_hourly_rate_vnd into v_bands, v_flat
	from public.settings where id = 1;
	if v_bands is null then
		raise exception 'settings row missing';
	end if;

	for v_i in 0 .. (p_block_count - 1) loop
		v_min := v_start + v_i * 30;
		select (b->>'rate')::bigint into v_rate
		from jsonb_array_elements(v_bands) as b
		where (split_part(b->>'start', ':', 1)::int * 60 + split_part(b->>'start', ':', 2)::int) <= v_min
		order by (split_part(b->>'start', ':', 1)::int * 60 + split_part(b->>'start', ':', 2)::int) desc
		limit 1;
		if v_rate is null then
			v_rate := v_flat; -- minute earlier than the first band → flat fallback
		end if;
		v_total := v_total + v_rate::numeric / 2;
	end loop;

	return trunc(v_total)::bigint;
end;
$$;

revoke all on function public.price_span(time, int) from public, anon;

-- Drop the stale 11-arg overload (pre-hold-mode). 20260610000100 added p_hold_minutes
-- as a NEW 12-arg overload via create-or-replace, leaving this older signature behind;
-- the two coexisting overloads make an 11-named-arg call (owner manual booking) resolve
-- ambiguously ("function is not unique") and, worse, the stale one still prices FLAT.
-- Removing it leaves exactly one band-aware function that every call resolves to.
drop function if exists public.create_pending_booking(
	text, text, text, int, time, int, date, int[], date, uuid, boolean
);

-- create_pending_booking: body copied verbatim from 20260610000100_create_hold_mode.sql,
-- changing ONLY the pricing — the flat-rate load is dropped and the amount now comes
-- from price_span() (per-occurrence) × occurrence count.
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
	p_force_court      boolean default false,
	p_hold_minutes     int     default null
)
returns table (reference text, amount_vnd bigint, occurrences int, court_id uuid, court_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
	v_alphabet   text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- ambiguity-free (no 0/O/1/I/L)
	v_reference  text := '';
	v_i          int;
	v_end_time   time;
	v_duration   interval := (p_block_count * 30) * interval '1 minute';
	v_amount     bigint;
	v_count      int;
	v_dates      date[];
	v_booking_id uuid;
	v_slot_date  date;
	v_range      tstzrange;
	v_cand       record;
	v_status     text := case when p_hold_minutes is null then 'pending' else 'held' end;
	v_expires    timestamptz := case when p_hold_minutes is null then null
	                                  else now() + (p_hold_minutes || ' minutes')::interval end;
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

	-- Band-aware pricing: price_span() is the per-occurrence amount (each occurrence
	-- shares the same time-of-day span), multiplied by the occurrence count.
	v_amount := public.price_span(p_start_time, p_block_count) * v_count;

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
				  and o.status in ('held', 'pending', 'confirmed')
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
			insert into public.booking (court_id, type, customer_name, zalo_phone, group_size, status, reference, amount_vnd, source, hold_expires_at)
			values (v_cand.id, p_type, p_customer_name, p_zalo_phone, p_group_size, v_status, v_reference, v_amount, 'public', v_expires)
			returning id into v_booking_id;

			foreach v_slot_date in array v_dates loop
				v_range := tstzrange(
					(v_slot_date + p_start_time) at time zone 'Asia/Ho_Chi_Minh',
					(v_slot_date + v_end_time)   at time zone 'Asia/Ho_Chi_Minh',
					'[)'
				);
				insert into public.booking_occurrence (booking_id, court_id, time_range, status)
				values (v_booking_id, v_cand.id, v_range, v_status);
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

-- Signature unchanged (12 args); re-issue the revoke to keep anon locked out (§9).
revoke all on function public.create_pending_booking(
	text, text, text, int, time, int, date, int[], date, uuid, boolean, int
) from public, anon;

-- Expose price_bands on the anon-safe public view (non-PII; the booking page and
-- the pricing table read it). Appends to the latest definition (owner_zalo included).
create or replace view public.public_settings
	with (security_invoker = off)
as
select id, flat_hourly_rate_vnd, qr_image_path, owner_zalo, price_bands
from public.settings
where id = 1;

grant select on public.public_settings to anon, authenticated;
