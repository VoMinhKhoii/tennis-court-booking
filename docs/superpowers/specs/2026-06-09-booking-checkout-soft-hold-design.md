# Booking checkout: guided wizard + 3-state TTL hold

**Date:** 2026-06-09
**Status:** Approved design v3 (pre-implementation). Chosen model: timed reservation
(soft-lock) with a TTL, hardened with the findings from the agentic review.

## Context

Today's public booking is one `BookingForm` whose internal `stage` ("form" →
"review") creates a `pending` booking on confirm and swaps to
`BookingReceiptScreen`. The slot is held the instant the customer reaches payment,
holds forever if they abandon (no expiry), and the "Gửi ảnh qua Zalo" button is a
dead placeholder.

The owner wants a guided, Stripe-like checkout and a **timed soft-lock**: tapping
"book" reserves the slot briefly so a second customer can't pay for the same slot;
the reservation **auto-releases** if the customer never finishes; other customers
see **"⏳ đang giữ chỗ (còn X phút)"** instead of an opaque "kín sân"; and the owner
confirms after verifying the bank transfer.

We evaluated the simpler "reserve-at-final-confirm" alternative and the industry TTL
pattern. The owner chose the TTL hold for its stronger "no two people pay for the
same slot" guarantee, accepting the extra machinery. This spec is that design with
the review's correctness/security fixes baked in.

## Booking lifecycle (3 states + terminal)

```
 (no row) ─tap pay→ HELD ──final "Rồi, hoàn tất"──▶ PENDING ──owner confirm──▶ CONFIRMED
                     │ (TTL 15m, while paying)        │ (paid-claim, awaiting owner)   │
                     │ expires (sweeper)              │ owner reject                   │
                     ▼                                 ▼                               ▼
                  EXPIRED (terminal, recoverable)   REJECTED                    (slots locked)
```

- **held** — created when the customer reaches the payment step. Blocks the slot for
  **15 minutes** (the pay window). Carries `hold_expires_at`.
- **pending** — the customer tapped the final confirm (so they've clicked "Đã chuyển
  khoản" + "Đã gửi ảnh qua Zalo"). Durable, **no TTL**, appears in the owner queue.
  Every public `pending` is a payment-claim → owner UI labels it "khách báo đã chuyển".
- **confirmed / rejected** — owner action, unchanged.
- **expired** — a held that timed out (customer abandoned before finalizing). Terminal,
  **does not block** the slot, and is **kept (not deleted)** so a customer who paid
  during the hold but didn't finish can still be reconciled by reference.

## Why a hold needs 3 states (the key correction)

A single `expires_at` cannot cover both "time to pay" and "time for the owner to
verify a manual bank transfer" (which can take hours). The TTL governs only the
**held** (paying) window. The moment the customer finalizes, the reservation becomes
**pending with no TTL** and waits for the owner indefinitely. Conflating these would
expire a slot the customer already paid for.

## Race handling

The hold row is a real `booking_occurrence` protected by the existing `no_overlap`
GiST exclusion constraint (already verified: 25 concurrent same-slot → exactly one
winner, no double-book, no deadlock). **Creating the hold IS the lock** — no
read-then-write window. Two customers tapping pay for the same slot: the first hold
wins atomically; the second auto-assigns another free court or, if none, is turned
away **before any QR** with "hết sân cho khung giờ này". After a customer holds, the
final confirm is an `UPDATE` on the row they own and cannot lose to anyone.

(Note: `SELECT COUNT(*) … then INSERT` is NOT race-safe on Postgres READ COMMITTED —
we rely on the exclusion constraint, not a count.)

## Data model changes (`supabase/migrations/<new>.sql`)

1. **Status values `held` and `expired`** added to the CHECK constraints on BOTH
   `booking.status` (inline/auto-named `booking_status_check` in 080001) and
   `booking_occurrence.status` (named `booking_occurrence_status_check` in 080009).
   Each must be `DROP CONSTRAINT … ; ADD CONSTRAINT … CHECK (status IN
   ('held','pending','confirmed','rejected','expired'))`. **Missing the occurrence-
   level drop = every hold insert fails closed** — do not forget it.
2. **`booking.hold_expires_at timestamptz NULL`** (single source of truth for
   expiry; nullable, no default, no backfill — existing rows are never `held`).
   Optional integrity CHECK: `hold_expires_at IS NOT NULL` iff `status='held'` is
   not enforced (finalize/sweeper manage it); skip to stay simple.
3. **Exclusion constraint** `no_overlap` predicate widens to `status IN
   ('held','pending','confirmed')` (DROP + ADD; brief ACCESS EXCLUSIVE lock — safe
   on this tiny table; set `lock_timeout` so a stuck migration fails fast; existing
   pending/confirmed rows stay in-predicate so the rebuild can't fail on data).
4. **`public_availability` view** (DROP + CREATE, then re-GRANT SELECT to anon —
   recreate drops the grant). Column list stays EXACTLY `court_id, slot_date,
   time_range, occupied` (the PII boundary). Definition:
   ```sql
   select o.court_id, o.slot_date, o.time_range, true as occupied
   from booking_occurrence o join booking b on b.id = o.booking_id
   where o.status in ('pending','confirmed')
      or (o.status = 'held' and b.hold_expires_at > now());
   ```
   The `now()` filter hides expired-but-not-yet-swept holds immediately. The join to
   `booking` adds cost on the hottest anon read; acceptable at ≤100 MAU (PK lookup).
   Do NOT add any `booking` column to the SELECT list.
5. **`broadcast_availability_change()`** (080002) updates `v_occupied := v_status in
   ('held','pending','confirmed')` (currently only pending/confirmed — would
   broadcast a new hold as FREE). Realtime cannot time-filter, so it is
   eventually-consistent for expiry: a hold reads occupied on insert, and `occupied=
   false` is broadcast when the sweeper flips held→expired. The view's `now()` filter
   is the authoritative read.
6. **`settings.owner_zalo text`** column; exposed via `public_settings` (DROP +
   CREATE the view, re-GRANT). Business contact, not customer PII.

## Database function (`create_pending_booking`)

- New param **`p_hold_minutes int default null`**. When non-null: inserts
  `status='held'` and sets `booking.hold_expires_at = now() + (p_hold_minutes||'
  minutes')::interval`. When null: behaves exactly as today (`pending`).
- The candidate-court load-balance count includes `status IN
  ('held','pending','confirmed')` so balancing sees holds (slight over-count for
  expired-not-swept holds is self-correcting).
- **Stale-hold cleanup is NOT done in the exception handler** (the review showed
  that's unimplementable: you can't get the conflicting row from an
  `exclusion_violation`, and cleanup inside the rolled-back sub-block is undone).
  Instead: a scheduled sweeper (below) is the mechanism. Optionally, a single safe
  statement at the top of the function may pre-expire overlapping stale holds
  (`UPDATE booking SET status='expired' WHERE status='held' AND hold_expires_at <
  now() AND id IN (<overlapping on candidate courts/dates>)`) to shrink the
  re-bookability window; this is an optimization, not required for correctness.

## Expiry sweeper (required, not optional)

A scheduled job (Supabase `pg_cron`, every 1 minute):
```sql
update booking set status='expired'
where status='held' and hold_expires_at < now();
```
The `booking_status_mirror` trigger flips the occurrences to `expired` (drops them
out of the exclusion predicate → slot re-bookable) and the broadcast fires
`occupied=false`. The view already hid them via `now()`; the sweeper is what frees
them at the constraint level and keeps the table from accumulating dead holds.

## Server actions (`lib/actions/create-booking.ts`)

1. **`createHold(input)`** (the entry to checkout):
   - `bookingInputSchema.safeParse` + per-IP/phone rate-limit (as today).
   - **Authoritative concurrent-reservation cap** (DoS fix): reject if this
     phone OR this IP already has `>= MAX_ACTIVE_RESERVATIONS` rows in
     (`held` & not expired) ∪ `pending`. This both stops one actor minting holds to
     grief every court AND guarantees finalize can't later exceed the pending cap
     (so a customer is never rejected after paying). Reuse `MAX_ACTIVE_PENDING`
     semantics; the IP-based count is the load-bearing one (phone is forgeable).
   - `create_pending_booking(p_hold_minutes = 15, …)`.
   - Returns the existing `BookingReceipt` + `holdExpiresAt` (court IS assigned at
     hold time, so the payment screen can show the assigned court).
2. **`finalizeBooking(reference)`** (final "Rồi, hoàn tất"):
   - `UPDATE booking SET status='pending', hold_expires_at=null WHERE reference=?
     AND status='held' AND hold_expires_at > now() RETURNING …`.
   - **Idempotent**: if the reference is already `pending`, return success (covers
     double-tap / retry).
   - 0 rows + not-already-pending → hold expired/gone → typed "expired" error → the
     UI shows recovery copy (don't silently restart): *"Hết thời gian giữ chỗ. Nếu
     bạn đã chuyển khoản, gửi ảnh + mã [REFERENCE] qua Zalo — chủ sân sẽ xử lý."*
   - Per-IP rate-limited (the reference is a low-value capability; rate-limit bounds
     guessing — its only privileged effect is promoting an own/observed hold).

## Settings: owner Zalo (validated — security)

- `settingsInputSchema.ownerZalo` (optional). **Validate at write:** accept a bare
  phone (`^\+?\d{6,15}$` → normalize to `https://zalo.me/<digits>`) OR an `https://`
  URL whose host is `zalo.me` / `*.zalo.me` / `chat.zalo.me`. Reject everything else
  (blocks stored `javascript:`/`data:` XSS and open-redirect).
- `updateSettings` persists (blank → null). Dashboard settings gets an input.
- **Validate at render too:** emit the `href` only if `new URL()` parses and it
  `startsWith("https://")`; add `rel="noopener noreferrer" target="_blank"`. Unset →
  plain instruction text.

## Customer wizard (UI)

Refactor `booking-form.tsx` + `booking-receipt.tsx` into a stepper:

1. **Thông tin** — the form. Nothing reserved.
2. **Xác nhận** — review bill. Button **"Tiến hành thanh toán"** → `createHold`.
   Cap/rate failure or `no_court_available` → stay here with the message (no hold).
3. **Thanh toán** — QR (amount + reference), assigned court, pay-by-hand details, and
   a **countdown to `holdExpiresAt`**. Reassurance copy: *"Hết giờ giữ chỗ chỉ cần
   đặt lại — bạn không mất tiền."* Digits stay calm; red only under 1:00. Primary
   **"Đã chuyển khoản"** reveals the Zalo block: **deep-link to owner Zalo** + final
   **"Rồi, hoàn tất"**. `useTransition` disables during calls; guard double-submit.
   At 0:00 → "Đặt lại" that re-creates a hold from the same in-memory form (one tap,
   no re-fill); the old hold expires on its own.
4. **Hoàn tất** — success: "Đang chờ chủ sân xác nhận" with court, reference, amount,
   `Chờ xác nhận` pill, "Về lịch trống". Finalize failure → the recovery copy above.

**Refresh-resume (required):** persist `{ reference, holdExpiresAt, formInput }` to
`localStorage` on entering step 3; on mount, if a live reference exists, restore the
payment step (re-render from server via a tiny `getHold(reference)` read). Mobile
tabs are commonly evicted when the user switches to their banking app to pay —
without this, the customer returns to a blank form while **their own hold blocks the
slot they just paid for**. Clear on success/expiry.

## Slot grid (Layer 4) + owner visibility

- `components/availability/slot-grid.tsx`: a slot occupied only by a (not-expired)
  `held` reservation renders **"⏳ đang giữ chỗ"** (with minutes left if cheap to
  compute) instead of "kín sân". This makes the temporary lock honest and
  self-correcting — the transparency the owner originally wanted. Confirmed/pending
  still render "kín sân". (The public view exposes only `occupied`; to distinguish
  held vs confirmed for this label, either add a non-PII `held` boolean to
  `public_availability` — still no PII — or keep it simple and label all occupied as
  "kín sân" for v1. **Decision: add a boolean `held` column to the view** so the
  countdown UX works; column list becomes `court_id, slot_date, time_range,
  occupied, held` — still no PII.)
- **Owner calendar** shows held slots as "đang giữ chỗ (chưa thanh toán)" so the
  owner understands why a slot is blocked. Holds stay OUT of the actionable pending
  queue.

## Admin confirm safeguard (Layer 3)

- `confirmBooking` already guards `WHERE status='pending'` (verified — it cannot
  silently double-confirm). Keep, and on a no-op return a clear message ("Booking is
  no longer pending").
- **Reconciliation surface:** because a customer can pay during a hold that then
  expires (slot later taken by someone else), the owner dashboard surfaces
  `expired` bookings that may carry a payment claim, so the owner can refund or
  manually re-book. (The exclusion constraint already makes two simultaneous
  active reservations on one slot impossible, so there is never an auto-"override"
  needed — only this manual reconciliation view.)
- **Audit log:** record every confirm/reject with timestamp + owner uid (a simple
  `booking_audit` table or a structured log). Low cost, high value for disputes.

## Edge cases

- Refresh mid-pay → localStorage restores the hold/reference.
- Paid then hold expired before finalize → recovery copy + reference; owner
  reconciles the transfer (kept as `expired`, not deleted).
- Double-tap finalize → idempotent.
- Cap exceeded → caught at `createHold` (before QR), never after paying.
- Abandoned hold → swept to `expired` within ~1 min; slot frees.

## Verification plan

- **Concurrency:** extend `scripts/verify-concurrency.mjs` — N concurrent
  `createHold` on one slot → exactly #courts win, rest turned away; finalize winners
  → pending; force-expire a hold + run sweeper → slot frees and re-holds; assert no
  overlap across `held`/`pending`/`confirmed`.
- **Logic/unit:** `ownerZalo` validation (accept phone & zalo https, reject
  `javascript:`/other hosts); finalize idempotency + expired path; view hides
  expired holds; status CHECK accepts held/expired.
- **Browser:** full wizard (form → review → hold/QR+countdown → "Đã chuyển khoản" →
  Zalo deep-link → "Rồi, hoàn tất" → "Chờ xác nhận"); expiry → "Đặt lại"; grid shows
  "⏳ đang giữ chỗ"; refresh-on-payment restores the hold; owner sees held vs pending.
- **Static:** `bun test`, `tsc --noEmit`, `biome`, `next build` green.

## How the review findings are addressed (traceability)

- Broadcast excludes `held` → **fixed** (data-model #5).
- `booking_occurrence_status_check` rejects `held` → **fixed** (explicit drop/recreate, #1).
- Expiry-location incoherence → **fixed** (single source on `booking`; view joins; broadcast uses status only).
- Self-heal-in-exception unimplementable → **dropped**; replaced by required `pg_cron` sweeper (+ optional safe pre-insert expire).
- Hold-DoS (cap bypass) → **fixed** (authoritative per-IP/phone active-reservation cap at `createHold`).
- Cap rejected-after-paying → **fixed** (cap at hold creation, before QR).
- `owner_zalo` XSS/open-redirect → **fixed** (write + render validation).
- Refresh strands a paid customer → **fixed** (localStorage resume).
- Paid-but-expired silently lost → **fixed** (`expired` kept + recovery copy + owner reconciliation surface).
- Exclusion-constraint rebuild lock → **noted** (tiny table, `lock_timeout`, safe on existing rows).
- View join/now() on hot path → **noted/accepted** at scale; column list locked to non-PII.

## Out of scope / future

- Automated payment verification / bank webhook.
- Virtual waiting room / queue (contention far too low).
- Per-occurrence expiry denormalization (only if the view join becomes a measured hot-path problem).
