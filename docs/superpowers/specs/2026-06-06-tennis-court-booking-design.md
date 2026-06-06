# Tennis Court Booking — v1 Design Spec

**Date:** 2026-06-06
**Status:** Approved (brainstorming) → pending multi-agent review
**Scope:** v1 = core booking loop on the web. No Zalo, no AI, no stock, no renewal automation.

---

## 1. Context & Business Model

A single owner-operator tennis court business in Vietnam (1–4 physical courts, 15 operational
hours/day). No membership system; the owner manages every booking personally. Customers are
Vietnamese coaches, students, and recreational players (30–40 yr), all Zalo-native, with existing
personal relationships to the owner.

Two booking types:

- **Monthly booking (primary):** a recurring weekly slot held for a **calendar month**. The bulk of
  capacity (13–14 h/court/day) is filled this way.
- **Ad-hoc booking (secondary):** a one-off slot from the ~1 h/court/day remainder.

The owner is the **sole** admin. No other user has write access. The system automates availability
display, slot holding, and amount computation — but **every confirm/reject/edit decision stays a
manual owner action**.

### Out of scope for v1 (deferred slices)

Zalo notifications (all triggers), AI Facebook/Zalo post generator, stock/inventory tracking,
monthly renewal & month-rollover automation, ad-hoc-unfilled alerts, payment tier-2 (automated
reconciliation), court block-out dates (maintenance/holidays). Each becomes its own spec later.

---

## 2. Stack & Conventions

- **Next.js 16.2.6** (App Router), React 19. v16 has real breaking changes vs. training data — the
  relevant guide in `node_modules/next/dist/docs/` **must** be read before writing any code (per
  `AGENTS.md`).
- **Supabase:** Postgres (data + RLS), Auth (owner login), Realtime (live availability), Storage
  (static QR image).
- **TanStack Query** for client data fetching/caching on interactive surfaces.
- **Zod** at every untrusted boundary (form input, server-action args, RPC payloads).
- **Biome** replaces the starter's ESLint (format + lint).
- **Bun** as package manager/runtime. **Vercel** for hosting.
- **Timezone:** fixed to `Asia/Ho_Chi_Minh` (UTC+7, no DST). All timestamps stored as `timestamptz`
  (UTC), rendered in ICT. All "dates" (slot_date) are calendar dates in ICT.

---

## 3. Core Concepts & Definitions

- **Court:** a physical court with a name and daily operating window (`open_time`–`close_time`,
  aligned to 30-min boundaries). 1–4 courts, owner-configurable.
- **Block:** the atomic bookable unit = **30 minutes**. A 15-hour day = 30 blocks/court/day. A
  booking spans one or more **consecutive** blocks.
- **Booking:** a customer's request for capacity. Has a `type` (monthly | adhoc) and a lifecycle
  status (pending → confirmed | rejected | expired).
- **Occurrence:** a single concrete dated session belonging to a booking. **This is the unit of
  occupancy.** An ad-hoc booking has 1 occurrence; a monthly booking has one occurrence per matching
  weekday-date in the calendar month.
- **Monthly semantics:** a monthly booking for `weekday + time` locks **every matching date from the
  selected start date through the last day of that calendar month** (4–5 occurrences typically). A
  monthly booking created mid-month locks only the remaining matching dates in that month.

---

## 4. Architecture Decision: Materialized Occurrences

**Chosen: Approach A — materialized occurrence rows** (over rule-based expansion).

A `booking` parent row holds customer/pricing/status. Child `booking_occurrence` rows hold one row
per concrete dated session. Monthly "Mondays 18:00–19:00 in June" → 4 occurrence rows.

**Rationale:** double-booking is the one bug this product cannot ship with. Materialized occurrences
let **Postgres enforce non-overlap at the database level** via a GiST exclusion constraint — app code
cannot accidentally create a double-book even under concurrent requests. Calendar rendering and
Realtime become trivial date-range queries. Rule-based expansion was rejected because overlap
detection would move into race-prone app logic with no DB guarantee.

---

## 5. Data Model

```
court
  id            uuid pk
  name          text not null
  open_time     time not null   -- 30-min aligned, ICT wall-clock
  close_time    time not null   -- 30-min aligned, exclusive end
  is_active     boolean not null default true
  created_at    timestamptz not null default now()

booking
  id            uuid pk
  court_id      uuid fk -> court
  type          text not null check (type in ('monthly','adhoc'))
  customer_name text not null
  zalo_phone    text not null
  group_size    int  not null default 1     -- metadata only, no capacity logic
  status        text not null check (status in ('pending','confirmed','rejected','expired'))
  reference     text not null unique         -- human code, e.g. TC-7F3K
  amount_vnd    bigint not null              -- computed at creation
  expires_at    timestamptz                  -- set when pending; null once resolved
  reject_reason text
  source        text not null default 'public' check (source in ('public','owner'))
  created_at    timestamptz not null default now()
  confirmed_at  timestamptz

booking_occurrence
  id            uuid pk
  booking_id    uuid fk -> booking (on delete cascade)
  court_id      uuid not null                -- denormalized for the exclusion constraint
  slot_date     date not null                -- ICT calendar date
  time_range    tstzrange not null           -- concrete [start, end) for the day in UTC
  status        text not null                -- mirrors parent's active state (pending/confirmed)

settings  (single row)
  id                    int pk default 1 (check id = 1)
  flat_hourly_rate_vnd  bigint not null
  qr_image_path         text                 -- Supabase Storage path
  expiry_window_minutes int not null default 120
```

### Double-booking guarantee

```sql
ALTER TABLE booking_occurrence
  ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (court_id WITH =, time_range WITH &&)
  WHERE (status IN ('pending','confirmed'));
```

Two requests for any overlapping block on the same court cannot both succeed — the second insert
fails atomically.

### Lazy expiry (no cron)

A pending booking past `expires_at` is treated as expired. Because the exclusion constraint cannot
reference `now()`:

- **On read:** the public availability view filters out occurrences whose parent is `pending` with
  `expires_at < now()`.
- **On write:** any booking-creation transaction first **releases** expired pendings touching the
  target court/slots (`UPDATE booking SET status='expired' ... WHERE status='pending' AND expires_at
  < now()` + cascade occurrence status), then inserts. The exclusion constraint remains the atomic
  backstop. No background job required.

---

## 6. Public Surfaces (no login)

### 6.1 Availability display

- Per-court 30-min grid; navigable across **current + next calendar month**.
- Status-only: each block is **available** or **occupied**. No customer names, amounts, or any PII.
- Reads exclusively from a Postgres **view** (`public_availability`) that exposes only
  `court_id, slot_date, time_range, occupied` — never `booking` PII.
- **Realtime:** Supabase Realtime subscription refreshes the grid when occupancy changes
  (confirm/expire/create). TanStack Query cache invalidation on realtime events.
- Mobile-first, shareable URL, no auth.

### 6.2 Booking form

- Reachable from the availability display or a direct link.
- Fields: name, Zalo phone, court, session type (monthly | adhoc), slot selection
  (weekday + time for monthly; specific date + time for adhoc), duration (N consecutive blocks),
  group size. All validated with **Zod** client + server.
- The computed **amount** is shown before submit (see §8).
- On submit → server action / `SECURITY DEFINER` RPC creates the `booking` (status `pending`,
  `expires_at = now() + expiry_window`) and its `booking_occurrence` rows in **one transaction**
  (release-expired-then-insert; exclusion constraint backstops). Returns the **static QR image +
  amount + reference code**. If the exclusion constraint trips (slot taken since page load), return a
  friendly "slot just got taken" error and refresh availability.
- No account creation.

---

## 7. Owner Dashboard (private)

- **Auth:** Supabase Auth, single seeded admin account (email + magic link). All dashboard routes and
  mutations require the authenticated owner.
- **Pending queue:** sorted by `created_at`, each row shows an expiry countdown; flagged when near
  expiry. One-tap **Confirm** (→ `confirmed`, `confirmed_at` set, occurrences locked) and **Reject**
  (→ `rejected`, optional reason, slots released).
- **Confirmed bookings view:** filterable by court, calendar month, customer name.
- **Manual booking creation:** owner creates a booking straight to `confirmed` (source `owner`),
  bypassing the pending/payment flow, for existing regulars. Same occurrence generation + exclusion
  constraint.
- **Court management:** add/edit courts; set name and 30-min-aligned operating hours; toggle active.
  (Block-out dates deferred.)

---

## 8. Pricing

Single flat hourly rate stored in `settings.flat_hourly_rate_vnd`.

```
hours  = (total consecutive blocks) / 2
amount = flat_hourly_rate_vnd * hours * occurrence_count
```

- Ad-hoc: `occurrence_count = 1`.
- Monthly: `occurrence_count` = number of matching weekday-dates locked in the calendar month.

Computed server-side at booking creation and stored in `booking.amount_vnd` (never trust a
client-sent amount). Displayed on the form pre-submit via the same server computation.

---

## 9. Security (RLS)

- **anon role:** may `SELECT` only from `public_availability` (PII-free view). No direct table access.
- **Booking creation:** the only public write path is a single `SECURITY DEFINER` RPC (or server
  action using a constrained role) that inserts the pending booking + occurrences. Public cannot
  write tables directly.
- **owner (authenticated):** full read on `booking` / `booking_occurrence` / `settings`; all
  confirm/reject/edit/court/settings writes. RLS policies restrict every base table to the
  authenticated owner; the public sees data only through the view + RPC.
- Secrets (service role key) never reach the client. Server actions run server-side only.

---

## 10. Edge Cases & Rules

- **Concurrent grab of same slot:** exclusion constraint → one wins, the other gets a friendly retry.
- **Mid-month monthly booking:** locks only remaining matching dates through month end.
- **Booking spanning closed hours:** server validates the requested range is fully within the court's
  `open_time`–`close_time` and 30-min aligned.
- **Expired pending:** released lazily on read (view) and on write (release-then-insert).
- **Owner reject:** releases occurrences immediately; slots reopen on the public grid via Realtime.
- **Month boundary for monthly:** occurrences are generated only within the selected calendar month;
  no rollover (renewal deferred).
- **Cross-midnight ranges:** not allowed — a booking stays within one slot_date.

---

## 11. Testing Strategy

- **DB-level:** test the exclusion constraint rejects overlapping pending/confirmed occurrences;
  test lazy-expiry release path; test occurrence generation count for monthly (4 vs 5 weekday months,
  mid-month start).
- **Pricing:** unit tests for `amount = rate * hours * occurrences` across ad-hoc/monthly.
- **Server actions/RPC:** Zod rejection of malformed input; PII never returned to anon; slot-taken
  error path.
- **RLS:** anon cannot read `booking`; anon cannot write; owner-only mutations enforced.
- **E2E (smoke):** public sees availability → submits booking → owner confirms → slot shows occupied.

---

## 12. Verification / Definition of Done (v1)

1. Owner can configure 1–4 courts with operating hours and a flat hourly rate + QR image.
2. Public sees a live, PII-free availability grid (current + next month) per court.
3. Public can submit a monthly or ad-hoc booking and receive QR + amount + reference.
4. Two concurrent bookings for the same block cannot both succeed (DB-enforced).
5. Owner confirms/rejects from the dashboard; grid updates in real time.
6. Owner can create a confirmed booking manually.
7. Expired pendings free their slots without any cron.
8. anon cannot read or write any PII; all mutations are owner-authenticated.
