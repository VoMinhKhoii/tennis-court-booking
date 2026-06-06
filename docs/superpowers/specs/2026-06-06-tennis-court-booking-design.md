# Tennis Court Booking — v1 Design Spec

**Date:** 2026-06-06
**Status:** Approved + multi-agent reviewed (5 reviewers, all "ship-with-fixes", findings applied)
**Scope:** v1 = core booking loop on the web. No Zalo, no AI, no stock, no renewal, **no auto-expiry**.

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

The owner is the **sole** admin. No user has write access except through the owner-authenticated
dashboard. The system automates availability display, slot holding, and amount computation — but
**every confirm/reject/edit decision stays a manual owner action**.

### Out of scope for v1 (deferred slices)

Zalo notifications (all triggers), AI Facebook/Zalo post generator, stock/inventory tracking,
monthly renewal & month-rollover automation, ad-hoc-unfilled alerts, payment tier-2 (automated
reconciliation), court block-out dates, **automatic pending expiry** (a pending booking is released
only by an owner Reject in v1). Each becomes its own spec later.

---

## 2. Stack & Conventions

- **Next.js 16.2.6** (App Router), React 19. v16 has real breaking changes vs. training data — the
  relevant guide in `node_modules/next/dist/docs/` **must** be read before writing any code (per
  `AGENTS.md`).
- **Supabase:** Postgres (data + RLS), Auth (owner login), Realtime (live availability via
  **Broadcast**), Storage (static QR image). `@supabase/ssr` for App Router clients.
- **TanStack Query** for client data fetching/caching/invalidation on interactive surfaces.
- **Zod** is the only trust boundary: every server action begins with `safeParse`; client-side Zod is
  UX-only and never trusted.
- **Biome** replaces the starter's ESLint. Setup task: remove `eslint` + `eslint-config-next`, add
  `@biomejs/biome`, replace `lint`/`format` scripts.
- **Bun** package manager/runtime. **Vercel** hosting.
- **Timezone:** fixed `Asia/Ho_Chi_Minh` (UTC+7, no DST). Timestamps stored `timestamptz` (UTC),
  rendered ICT. `slot_date` is an ICT calendar date, **derived** from the slot's start instant.

---

## 3. Core Concepts & Definitions

- **Court:** physical court with a name and daily operating window (`open_time`–`close_time`, 30-min
  aligned). 1–4 courts, owner-configurable.
- **Block:** atomic bookable unit = **30 minutes**. 15-hour day = 30 blocks/court/day. A booking
  spans one or more **consecutive** blocks.
- **Booking:** a customer's request for capacity. Has a `type` (monthly | adhoc) and lifecycle status
  (pending → confirmed | rejected).
- **Occurrence:** a single concrete dated session belonging to a booking. **This is the unit of
  occupancy.** Ad-hoc = 1 occurrence; monthly = one occurrence per matching weekday-date in the
  calendar month.
- **Monthly semantics:** customer picks a **target calendar month + weekday + start time + duration**.
  The booking locks every matching weekday-date from `start = first matching weekday on/after
  max(today, first-of-month)` through the last day of that month (4–5 occurrences typical). A
  mid-month booking locks only the remaining matching dates. **All-or-nothing**: the whole monthly
  hold succeeds or fails atomically.

---

## 4. Architecture Decision: Materialized Occurrences

**Chosen: Approach A — materialized occurrence rows** (over rule-based expansion).

A `booking` parent row holds customer/pricing/status. Child `booking_occurrence` rows hold one row
per concrete dated session.

**Rationale:** double-booking is the one bug this product cannot ship with. Materialized occurrences
let **Postgres enforce non-overlap** via a GiST exclusion constraint — app code cannot create a
double-book even under concurrency. Calendar rendering and Realtime become trivial. Rule-based
expansion was rejected: overlap detection would move into race-prone app logic with no DB guarantee.

---

## 5. Data Model

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- REQUIRED: enables uuid '=' inside the GiST exclusion

court(
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  open_time   time not null,                 -- 30-min aligned, ICT wall-clock
  close_time  time not null,                 -- 30-min aligned, exclusive end
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
)

booking(
  id            uuid primary key default gen_random_uuid(),
  court_id      uuid not null references court(id),
  type          text not null check (type in ('monthly','adhoc')),
  customer_name text not null,
  zalo_phone    text not null,
  group_size    int  not null default 1,     -- metadata only, no capacity logic
  status        text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  reference     text not null unique,         -- >=8 crypto-random chars, ambiguity-free alphabet
  amount_vnd    bigint not null,              -- derived from inserted occurrences (see §8)
  reject_reason text,
  source        text not null default 'public' check (source in ('public','owner')),
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz
)

booking_occurrence(
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references booking(id) on delete cascade,
  court_id    uuid not null references court(id),       -- kept consistent w/ parent by trigger
  time_range  tstzrange not null,                       -- concrete [start,end) instant range (UTC)
  slot_date   date generated always as
                ((lower(time_range) at time zone 'Asia/Ho_Chi_Minh')::date) stored,  -- cannot drift
  status      text not null,                            -- maintained by trigger off booking.status
  check (not isempty(time_range)),
  check (lower_inc(time_range) and not upper_inc(time_range))   -- canonical [) for adjacency
)

settings(  -- single row
  id                    int primary key default 1 check (id = 1),
  flat_hourly_rate_vnd  bigint not null,
  qr_image_path         text                            -- Supabase Storage path (owner-write only)
)
```

### Double-booking guarantee

```sql
ALTER TABLE booking_occurrence
  ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (court_id WITH =, time_range WITH &&)
  WHERE (status IN ('pending','confirmed'));
```

Adjacent half-open ranges (`[10:00,10:30)` and `[10:30,11:00)`) do **not** overlap — back-to-back
30-min bookings coexist. Overlapping ranges on the same court cannot both exist.

### Occurrence integrity (triggers, single source of truth)

- **`booking_occurrence.status` is never written by app code.** An `AFTER UPDATE OF status ON booking`
  trigger rewrites all child occurrence statuses (pending/confirmed stay active; rejected → 'rejected'
  drops them out of the exclusion predicate, freeing the slot). One place, no scattered cascades.
- **`court_id` consistency:** a `BEFORE INSERT` trigger (or the create function) sets
  `booking_occurrence.court_id` from the parent — never trusted from input.
- **Invariant test:** no occurrence in `('pending','confirmed')` may have a parent in `('rejected')`.

### No auto-expiry (v1)

A pending booking has **no expiry**. It occupies its slots until the owner **Confirms** (locks) or
**Rejects** (releases). The owner queue shows each pending's age so stale ones are easy to spot and
reject. This removes all cron/lazy-expiry/clock-race machinery.

---

## 6. Public Surfaces (no login)

### 6.1 Availability display

- Per-court 30-min grid; navigable across **current + next calendar month**.
- Status-only: each block is **available** or **occupied**. No names, amounts, or PII.
- Reads exclusively from a Postgres **view** `public_availability(court_id, slot_date, time_range,
  occupied)`. anon has **`SELECT` on this view only**; all base tables are RLS default-deny with no
  anon grant. The view's column list is the security boundary, reviewed on every change.
- **Realtime via Broadcast (not view subscription).** An `AFTER INSERT/UPDATE/DELETE` trigger on
  `booking_occurrence` calls `realtime.broadcast_changes()` on a **public** channel
  `availability:court:<id>` with a **non-PII** payload (`court_id, slot_date, time_range, occupied`).
  The client subscribes to that channel and invalidates the TanStack Query for `public_availability`
  on each event. (Realtime cannot subscribe to a view, and anon has no base-table SELECT — Broadcast
  is the only PII-safe live mechanism.)
- Mobile-first, shareable URL, no auth.

### 6.2 Booking form

- Reachable from availability display or a direct link.
- Fields: name, Zalo phone, court, session type (monthly | adhoc), slot selection, duration (N
  consecutive blocks), group size. **Monthly** additionally takes target **month + weekday + start
  time**; the picker then shows each concrete date with a **free/taken badge** (computed from
  `public_availability`) before submit. **Ad-hoc** takes a specific date + start time.
- The **amount preview** is produced by the *same server-side pricing function* used at insert (no
  client re-implementation; §8).
- Submit → **Next.js server action** (server-only): `safeParse` (Zod) → rate-limit + active-pending
  cap check (per `zalo_phone` and IP, e.g. max 3 active pendings) → calls the hardened
  `create_pending_booking` SQL function. Returns the **static QR + amount + reference**.
- **`create_pending_booking` (`SECURITY DEFINER`, EXECUTE not granted to anon):** accepts only
  `court_id, type, customer_name, zalo_phone, group_size, start spec (month/weekday/date + start time
  + block_count)`. It **derives** everything else: validates court `is_active` + range within
  open/close + 30-min alignment + `block_count` within a max cap; enumerates occurrence dates (one
  canonical function shared with the preview); builds each `time_range` as `tstzrange(start,end,'[)')`;
  hardcodes `status='pending'`, `source='public'`; generates the reference; **inserts occurrences
  first, then sets `amount_vnd = rate × hours × (rows inserted)`** in the same transaction. The
  exclusion constraint is the atomic backstop.
- **Monthly conflict:** pre-validate all dates against `public_availability` so the form names the
  conflicting date(s); the DB transaction is all-or-nothing if a race slips through. Error surfaces
  the specific `slot_date`, never a generic "slot taken."
- **Post-submit screen:** reference (prominent), amount, QR, instruction "transfer the exact amount
  with the reference in the bank memo, then send proof to the owner on Zalo," and "the owner will
  confirm manually." No account creation; no public lookup-by-reference endpoint.

---

## 7. Owner Dashboard (private)

- **Auth:** Supabase Auth, **public signups disabled**, single seeded owner. RLS keys on
  `auth.uid() = <owner uid>` (not merely `authenticated`). Defense-in-depth: middleware refreshes the
  session; the dashboard layout **and every owner server action** independently call
  `supabase.auth.getUser()` (verified) and reject non-owners. Owner actions run with the **owner's
  session** (RLS-enforced) — **not** the service-role key.
- **Pending queue:** sorted by `created_at`, shows age. One-tap **Confirm** (guarded
  `WHERE status='pending'`; → `confirmed`, `confirmed_at` set, slots lock) and **Reject** (optional
  reason; → `rejected`, trigger frees slots, grid updates via Broadcast).
- **Confirmed bookings view:** filterable by court, calendar month, customer name.
- **Manual booking creation:** owner creates a booking straight to `confirmed` (`source='owner'`) for
  regulars; same occurrence generation + exclusion constraint.
- **Court management:** add/edit courts, name + 30-min-aligned hours, toggle active.
- **Settings:** flat hourly rate; QR image upload (owner-only Storage write).

---

## 8. Pricing

Single flat rate in `settings.flat_hourly_rate_vnd`. **Counts come from the rows actually inserted**,
never a separately-derived integer:

```
hours  = (consecutive blocks) / 2
amount = flat_hourly_rate_vnd × hours × (occurrence rows inserted)
```

Ad-hoc → 1 occurrence. Monthly → matching weekday-dates in the month. The pre-submit preview calls the
same enumeration + pricing path, so displayed and stored amounts cannot diverge. Computed
server-side only; a client-sent amount is never trusted.

---

## 9. Security (RLS & Storage)

- **anon:** `SELECT` on `public_availability` **only**. `REVOKE ALL` on `booking`,
  `booking_occurrence`, `settings`, `court` from anon; RLS enabled, **default-deny** (no anon policy).
- **Booking creation:** sole public write path is the server action → `create_pending_booking`.
  `EXECUTE` on the function is **not** granted to anon (not callable via PostgREST). The server action
  is the trust boundary (Zod + rate-limit); the function derives all sensitive fields.
- **owner (authenticated as owner uid):** full read/write on base tables via RLS policies; all
  confirm/reject/edit/court/settings mutations.
- **Storage (QR):** public-read (or signed-URL) bucket; INSERT/UPDATE/DELETE on the QR object and
  `settings.qr_image_path` restricted to the owner. Public flow returns the QR strictly from
  `settings.qr_image_path` (no client-supplied path).
- **Keys:** service-role key is server-only (never `NEXT_PUBLIC_`), and is **not** used for routine
  owner actions. Reference codes are ≥8 crypto-random chars; there is no public PII-returning
  endpoint, so references are not enumerable into data.

---

## 10. Edge Cases & Rules

- **Concurrent grab of same block:** exclusion constraint → one wins; the other gets a date-specific
  error and a fresh availability refetch.
- **Monthly partial conflict:** all-or-nothing; the form pre-flags the taken week and the error names
  the date.
- **Mid-month monthly:** locks only remaining matching dates through month end.
- **Range outside open hours / misaligned / zero-length:** rejected server-side and by DB CHECK.
- **Adjacency:** back-to-back `[)` ranges coexist (explicit test).
- **Owner reject:** trigger flips occurrence status, slots reopen, Broadcast updates the grid.
- **Cross-midnight range:** not allowed — a booking stays within one ICT `slot_date`.
- **No rollover:** occurrences only within the selected month (renewal deferred).

---

## 11. Testing Strategy

- **DB:** `btree_gist` present + `no_overlap` rejects overlap; **adjacency allowed** (10:00–10:30 &
  10:30–11:00 coexist); monthly occurrence counts (4 vs 5 weekday months, mid-month start);
  `slot_date` generated correctly; reject trigger frees slots; occurrence/parent invariant; occurrence
  `court_id` always equals parent.
- **Pricing:** `amount = rate × hours × inserted-rows` across ad-hoc/monthly, including mid-month.
- **Create function/server action:** Zod rejection; anon cannot set `status='confirmed'`/`amount`/
  `source`; cannot `EXECUTE` the function directly; rate-limit/active-pending cap enforced; monthly
  conflict returns the conflicting date; PII never returned to anon.
- **RLS/Storage:** anon `SELECT` on each base table = denied; a second (non-owner) authenticated user
  is denied all reads/mutations and cannot overwrite the QR or `settings`.
- **Auth:** confirm guarded by status; non-owner blocked at layout + action level.
- **E2E smoke:** public sees availability → submits monthly + ad-hoc → owner confirms → grid shows
  occupied in real time; owner rejects → slot reopens.

---

## 12. Verification / Definition of Done (v1)

1. Owner configures 1–4 courts (hours), a flat hourly rate, and a QR image.
2. Public sees a live, PII-free availability grid (current + next month) per court, updated in real
   time via Broadcast on owner actions.
3. Public submits a monthly (with per-week badges, all-or-nothing) or ad-hoc booking and receives QR +
   amount + reference + clear pay instructions.
4. Two concurrent bookings for the same block cannot both succeed (DB-enforced); adjacency works.
5. anon cannot read any PII, cannot call the create function directly, and cannot spoof
   `status`/`amount`/`source`.
6. Owner confirms (status-guarded) / rejects (frees slot) from the dashboard; grid updates live.
7. Owner creates a confirmed booking manually.
8. A second authenticated non-owner account is denied everything; QR/settings are owner-write only.
9. `bun run build`, typecheck, and Biome all pass; DB + unit + E2E-smoke tests pass against a Supabase
   instance.

### Known v1 residuals (accepted, documented)

- No auto-expiry: a never-paid pending holds its slot until the owner rejects it (manual cleanup, by
  design).
- DoS posture is rate-limit + active-pending caps only; sophisticated distributed abuse is out of
  scope for ≤100 MAU with existing-relationship customers.
