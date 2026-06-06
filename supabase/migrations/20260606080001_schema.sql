-- Tennis Court Booking v1 — Phase 1 (Database)
-- Spec §5 Data Model + double-booking guarantee.
--
-- Timezone is fixed Asia/Ho_Chi_Minh (UTC+7, no DST). Timestamps are stored as
-- timestamptz (UTC); slot_date is the ICT calendar date derived from the slot's
-- start instant and can never drift from time_range.

-- Required for the GiST exclusion constraint: btree_gist lets us combine the
-- scalar equality (court_id WITH =) with the range overlap (time_range WITH &&).
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- court: a physical court with a daily operating window (30-min aligned, ICT).
-- ---------------------------------------------------------------------------
create table public.court (
	id          uuid primary key default gen_random_uuid(),
	name        text not null,
	open_time   time not null,
	close_time  time not null,
	is_active   boolean not null default true,
	created_at  timestamptz not null default now(),
	-- 30-min aligned, open before close (exclusive end), ICT wall-clock.
	constraint court_open_aligned  check (extract(minute from open_time) in (0, 30) and extract(second from open_time) = 0),
	constraint court_close_aligned check (extract(minute from close_time) in (0, 30) and extract(second from close_time) = 0),
	constraint court_window        check (open_time < close_time)
);

-- ---------------------------------------------------------------------------
-- booking: the customer's request. Holds customer/pricing/status; occupancy
-- lives on the child occurrences. amount_vnd is derived from inserted rows.
-- ---------------------------------------------------------------------------
create table public.booking (
	id            uuid primary key default gen_random_uuid(),
	court_id      uuid not null references public.court (id),
	type          text not null check (type in ('monthly', 'adhoc')),
	customer_name text not null,
	zalo_phone    text not null,
	group_size    int not null default 1 check (group_size >= 1),
	status        text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
	reference     text not null unique,
	amount_vnd    bigint not null,
	reject_reason text,
	source        text not null default 'public' check (source in ('public', 'owner')),
	created_at    timestamptz not null default now(),
	confirmed_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- booking_occurrence: one concrete dated session — THE unit of occupancy.
-- status is maintained exclusively by a trigger off booking.status (§5).
-- court_id is set from the parent by a trigger and never trusted from input.
-- ---------------------------------------------------------------------------
create table public.booking_occurrence (
	id          uuid primary key default gen_random_uuid(),
	booking_id  uuid not null references public.booking (id) on delete cascade,
	court_id    uuid not null references public.court (id),
	time_range  tstzrange not null,
	slot_date   date generated always as
		(((lower(time_range) at time zone 'Asia/Ho_Chi_Minh'))::date) stored,
	status      text not null,
	constraint occurrence_nonempty check (not isempty(time_range)),
	-- Canonical half-open [start,end) so back-to-back ranges are adjacent, not
	-- overlapping ([10:00,10:30) and [10:30,11:00) coexist).
	constraint occurrence_half_open check (lower_inc(time_range) and not upper_inc(time_range))
);

-- Double-booking guarantee (§5): Postgres rejects any two pending/confirmed
-- occurrences on the same court whose instant ranges overlap. Rejected rows
-- drop out of the predicate, freeing the slot.
alter table public.booking_occurrence
	add constraint no_overlap
	exclude using gist (court_id with =, time_range with &&)
	where (status in ('pending', 'confirmed'));

create index booking_occurrence_booking_id_idx on public.booking_occurrence (booking_id);
create index booking_occurrence_court_slot_idx on public.booking_occurrence (court_id, slot_date);
create index booking_status_created_idx on public.booking (status, created_at);

-- ---------------------------------------------------------------------------
-- settings: single owner-configurable row (flat rate + QR storage path).
-- ---------------------------------------------------------------------------
create table public.settings (
	id                   int primary key default 1 check (id = 1),
	flat_hourly_rate_vnd bigint not null check (flat_hourly_rate_vnd > 0),
	qr_image_path        text,
	-- The single seeded owner's auth uid. RLS keys on this exact uid (not merely
	-- 'authenticated') so a second authenticated account is denied everything.
	owner_uid            uuid
);
