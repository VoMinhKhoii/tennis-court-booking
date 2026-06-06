-- Tennis Court Booking v1 — Phase 1 (Database)
-- Shared enumeration + pricing, integrity triggers, broadcast, and the hardened
-- create_pending_booking SECURITY DEFINER function. Spec §5, §6, §8, §9.

set search_path = public;

-- Maximum consecutive 30-min blocks a single booking may span (cap, §6).
-- 28 blocks = 14h, comfortably within a 15h operating day.
create or replace function public.max_block_count()
returns int
language sql
immutable
as $$ select 28 $$;

-- ---------------------------------------------------------------------------
-- enumerate_slot_dates: the ONE canonical date enumeration, shared by the
-- amount preview (Phase 2/3) and create_pending_booking. Spec §3 monthly
-- semantics: every matching weekday-date from
--   start = first matching weekday on/after max(today_ict, first-of-month)
-- through the last day of that month. Ad-hoc is a single explicit date.
--
-- p_type    : 'monthly' | 'adhoc'
-- p_month   : any date within the target calendar month (monthly only)
-- p_weekday : ISO target weekday 0=Sunday..6=Saturday (monthly only)
-- p_date    : the explicit session date (adhoc only)
-- Returns the set of slot_date values, ascending.
-- ---------------------------------------------------------------------------
create or replace function public.enumerate_slot_dates(
	p_type    text,
	p_month   date default null,
	p_weekday int default null,
	p_date    date default null
)
returns setof date
language plpgsql
stable
as $$
declare
	v_today        date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
	v_first        date;
	v_last         date;
	v_start        date;
	v_offset       int;
	d              date;
begin
	if p_type = 'adhoc' then
		if p_date is null then
			raise exception 'adhoc booking requires p_date';
		end if;
		return next p_date;
		return;
	elsif p_type = 'monthly' then
		if p_month is null or p_weekday is null then
			raise exception 'monthly booking requires p_month and p_weekday';
		end if;
		if p_weekday < 0 or p_weekday > 6 then
			raise exception 'p_weekday must be 0..6 (Sunday..Saturday)';
		end if;
		v_first := date_trunc('month', p_month)::date;
		v_last  := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
		-- Begin no earlier than today (mid-month bookings lock only remaining dates).
		v_start := greatest(v_first, v_today);
		-- Advance v_start forward to the first matching weekday.
		-- extract(dow) returns 0=Sunday..6=Saturday, matching p_weekday.
		v_offset := (p_weekday - extract(dow from v_start)::int + 7) % 7;
		d := v_start + v_offset;
		while d <= v_last loop
			return next d;
			d := d + 7;
		end loop;
		return;
	else
		raise exception 'unknown booking type: %', p_type;
	end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Integrity trigger functions (§5).
-- ---------------------------------------------------------------------------

-- BEFORE INSERT on booking_occurrence: court_id always comes from the parent
-- booking, never trusted from the inserting statement.
create or replace function public.occurrence_set_court_id()
returns trigger
language plpgsql
as $$
begin
	select b.court_id into new.court_id
	from public.booking b
	where b.id = new.booking_id;
	if new.court_id is null then
		raise exception 'occurrence references unknown booking %', new.booking_id;
	end if;
	return new;
end;
$$;

-- AFTER UPDATE OF status on booking: booking_occurrence.status is never written
-- by app code. Mirror the parent status onto every child. Rejecting a booking
-- flips children to 'rejected', which drops them out of the no_overlap predicate
-- and frees the slot.
create or replace function public.booking_status_mirror()
returns trigger
language plpgsql
as $$
begin
	update public.booking_occurrence
	set status = new.status
	where booking_id = new.id
	  and status is distinct from new.status;
	return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime broadcast (§6.1). PII-safe: the payload carries ONLY
-- court_id, slot_date, time_range, occupied — never customer name/phone/etc.
-- We use realtime.send (not broadcast_changes, which would serialize the whole
-- row) so the payload shape and the public channel flag are explicit.
-- Channel: 'availability:court:<court_id>'. public flag = true (anon listeners).
-- 'occupied' reflects whether the slot is held AFTER this change: for an
-- INSERT/UPDATE into pending|confirmed it is true; otherwise (DELETE, or status
-- left the active set) it is false.
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_availability_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_court_id   uuid;
	v_time_range tstzrange;
	v_slot_date  date;
	v_status     text;
	v_occupied   boolean;
begin
	if tg_op = 'DELETE' then
		v_court_id   := old.court_id;
		v_time_range := old.time_range;
		v_slot_date  := old.slot_date;
		v_occupied   := false;
	else
		v_court_id   := new.court_id;
		v_time_range := new.time_range;
		v_slot_date  := new.slot_date;
		v_status     := new.status;
		v_occupied   := v_status in ('pending', 'confirmed');
	end if;

	perform realtime.send(
		jsonb_build_object(
			'court_id', v_court_id,
			'slot_date', v_slot_date,
			'time_range', v_time_range,
			'occupied', v_occupied
		),
		tg_op,                                            -- event name
		'availability:court:' || v_court_id::text,        -- topic (public channel)
		false                                             -- public (private = false)
	);
	return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_pending_booking (§6, §8, §9): the ONLY public write path, reached
-- exclusively through the server action. SECURITY DEFINER so it can write base
-- tables under default-deny RLS; EXECUTE is revoked from anon (see RLS
-- migration) so it cannot be called directly via PostgREST.
--
-- Accepts only safe inputs. Derives EVERYTHING sensitive: reference, status,
-- source, time_range, slot dates, and amount. The exclusion constraint is the
-- atomic backstop against double-booking under concurrency.
-- ---------------------------------------------------------------------------
create or replace function public.create_pending_booking(
	p_court_id      uuid,
	p_type          text,
	p_customer_name text,
	p_zalo_phone    text,
	p_group_size    int,
	p_start_time    time,
	p_block_count   int,
	p_month         date default null,
	p_weekday       int default null,
	p_date          date default null
)
returns table (reference text, amount_vnd bigint, occurrences int)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_court        public.court%rowtype;
	v_rate         bigint;
	v_alphabet     text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- ambiguity-free (no 0/O/1/I/L)
	v_reference    text := '';
	v_i            int;
	v_end_time     time;
	v_duration     interval := (p_block_count * 30) * interval '1 minute';
	v_hours        numeric;
	v_rows         int;
	v_amount       bigint;
	v_booking_id   uuid;
	v_slot_date    date;
	v_range        tstzrange;
begin
	-- Hardened input validation (§6). The server action also Zod-validates, but
	-- this function is the trust boundary of record and must stand alone.
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

	-- 30-min alignment of the start time.
	if extract(minute from p_start_time) not in (0, 30) or extract(second from p_start_time) <> 0 then
		raise exception 'start_time must be 30-min aligned';
	end if;
	v_end_time := p_start_time + v_duration;

	-- Court must exist and be active.
	select * into v_court from public.court where id = p_court_id;
	if not found then
		raise exception 'court not found';
	end if;
	if not v_court.is_active then
		raise exception 'court is not active';
	end if;

	-- Range must sit within the operating window (which also prevents crossing
	-- midnight, since close_time <= 24:00 wall-clock and v_end_time <= close_time).
	if p_start_time < v_court.open_time or v_end_time > v_court.close_time then
		raise exception 'requested range is outside court operating hours';
	end if;

	select flat_hourly_rate_vnd into v_rate from public.settings where id = 1;
	if v_rate is null then
		raise exception 'settings row missing';
	end if;

	-- Generate a >=8-char crypto-random reference from the ambiguity-free alphabet.
	for v_i in 1..8 loop
		v_reference := v_reference
			|| substr(v_alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(v_alphabet)), 1);
	end loop;

	-- Insert the parent. amount_vnd is a placeholder; it is recomputed from the
	-- rows actually inserted (§8) so displayed/stored amounts cannot diverge.
	insert into public.booking (court_id, type, customer_name, zalo_phone, group_size, status, reference, amount_vnd, source)
	values (p_court_id, p_type, p_customer_name, p_zalo_phone, p_group_size, 'pending', v_reference, 0, 'public')
	returning id into v_booking_id;

	-- Insert occurrences for each enumerated date. court_id and status are set by
	-- triggers / explicit literal — never from caller input. Any overlap raises
	-- (exclusion constraint) and rolls back the whole transaction (all-or-nothing).
	v_rows := 0;
	for v_slot_date in
		select d from public.enumerate_slot_dates(p_type, p_month, p_weekday, p_date) as d
	loop
		v_range := tstzrange(
			(v_slot_date + p_start_time) at time zone 'Asia/Ho_Chi_Minh',
			(v_slot_date + v_end_time)   at time zone 'Asia/Ho_Chi_Minh',
			'[)'
		);
		insert into public.booking_occurrence (booking_id, court_id, time_range, status)
		values (v_booking_id, p_court_id, v_range, 'pending');
		v_rows := v_rows + 1;
	end loop;

	if v_rows = 0 then
		raise exception 'no occurrences to book for the requested period';
	end if;

	-- Pricing (§8): counts come from rows actually inserted, never a separate int.
	v_hours  := (p_block_count::numeric) / 2;
	v_amount := (v_rate * v_hours * v_rows)::bigint;

	update public.booking set amount_vnd = v_amount where id = v_booking_id;

	return query select v_reference, v_amount, v_rows;
end;
$$;
