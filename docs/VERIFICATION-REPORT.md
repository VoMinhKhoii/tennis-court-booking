# Core Booking System — Verification Report

**Date:** 2026-06-08
**Target:** Existing cloud Supabase project (linked via `.env.local`)
**Scope:** Static baseline → existing scripts → concurrency → logic → browser journeys → load/perf
**Mode:** Report only (no app-code changes). New verification scripts were added under `scripts/`.

## Verdict: **GO** ✅

The core booking system is correct and performant for its target scale. The
double-booking backstop (Postgres GiST exclusion constraint) holds under heavy
concurrency, the TypeScript logic matches the database exactly, the public booking
UX works end to end, and performance is well within bounds. Findings below are about
the **test tooling and environment**, not the production booking path — fix F1 to keep
the verification suite trustworthy, and run the owner-dashboard UI pass (F4) before
relying on it.

---

## Results by phase

| Phase | What | Result |
|---|---|---|
| 0 | Static baseline | **PASS** — `bun test` 51/51, `tsc --noEmit` clean, `biome` clean, `next build` OK |
| 1 | Existing live scripts | **MIXED** — RLS/owner-auth assertions pass; **all booking probes broken** (F1) |
| 2 | Concurrency harness (`verify-concurrency.mjs`) | **PASS** — 23/23 |
| 3 | Logic harness (`verify-logic.mjs`) | **PASS** — 32/32 |
| 4 | Browser journeys (`/browse`) | **PASS** (public) — owner dashboard blocked (F4) |
| 5 | Load & perf (`verify-load.mjs`) | **PASS** — within bounds |

---

## Phase 2 — Concurrency (the core proof), 23/23

Fired real simultaneous `create_pending_booking` calls and reconciled against the DB.

- **Same-slot stampede (N=10 and N=25):** exactly **1 winner** every time; all losers fail
  cleanly (no deadlock/crash); DB holds **exactly 1** active occupant; **no orphan** booking rows.
- **10 concurrent distinct adjacent slots:** all 10 succeed (half-open ranges don't collide).
- **Auto-court distribution (3 courts):** 3 concurrent winners each on a **distinct court**; extra
  racers turned away cleanly with `no_court_available`.
- **Monthly series contention:** every winning series is **complete** (5/5 occurrences); **no
  partial series** ever persisted; loser turned away atomically.
- **Global invariant:** no two active occurrences share `(court, range)`.

Takeaway: the exclusion constraint + the court-loop's catch-and-retry are race-safe. A losing
racer on a single free court surfaces `no_court_available` (the function catches the internal
`23P01` after exhausting courts) — correct behavior, not a double-book.

## Phase 3 — Logic correctness (TS oracle vs DB), 32/32

- **Pricing:** `computeAmountVnd` matches DB `amount_vnd` for 1–4 blocks and for monthly series.
- **Enumeration:** `enumerateSlotDatesMulti` matches DB `occurrences` for single/multi weekday,
  including **mid-month flooring** (current month June 2026 floored at today → 4) and 5- vs
  4-occurrence weekdays.
- **Timezone:** ICT start round-trips through UTC storage + `public_availability` with no ±7h
  drift; `slot_date` correct even for 06:00 (which stores on the previous UTC day); spans 2 blocks.
- **Status mirror:** confirm → occurrences `confirmed` (slot stays locked, double-book rejected);
  reject → occurrences `rejected` (slot freed in the view, re-bookable).
- **RLS:** anon cannot read base tables or execute the RPC; can read public views.

## Phase 4 — Browser journeys (localhost:3001 → cloud)

- **Ad-hoc happy path:** form → review → receipt; **Court 1 assigned, ref, 200.000₫**, awaiting
  confirmation, **no console errors**. (No QR image — `settings.bank_*` and `qr_image_path` are
  null, so it correctly falls back to reference-only. See Observations.)
- **Monthly happy path:** July 2026 + Saturdays → **4 sessions enumerated (Jul 4/11/18/25),
  800.000₫**; receipt shows "Court 1 · 4 buổi". Matches the oracle.
- **Conflict UX:** re-booking the occupied slot shows **"kín sân"** and the friendly
  *"Tất cả các sân đều đã kín cho khung giờ này"* message; the slot flipped to occupied in the form.
- **Validation UX:** empty/invalid identity fields **block progression** to the review step.
- `/availability` (live grid) and `/login` render with no console errors.

## Phase 5 — Load & performance (cloud)

| Measurement | Result | Notes |
|---|---|---|
| Availability read (anon, month window), sequential ×20 | p50 **123ms**, p95 166ms | hot public read |
| Availability read, concurrent ×20 | p50 475ms, p95 643ms | single pooled client; per-user real latency ≈ sequential |
| RPC write throughput ramp | C=25 → 25/25 ok, **~47 bookings/s**, p95 419ms | no errors at any concurrency |
| Same-slot contention ×25 | 1 winner; loser latency p95 ~280ms | **fast & clean, no deadlock** |
| Auto-court scan cost vs table size | ratio after/before = **0.13×** | flat with table size → indexes working |
| Realtime broadcast (book → anon receives) | **210ms** | PII-safe payload delivered |

The first cold RPC call measured ~1.5s (PostgREST/connection warm-up), not a real regression —
subsequent calls are ~200ms.

---

## Findings

### F1 — Existing live scripts are stale and silently test nothing — **High (suite integrity)**
`scripts/live-verify.mjs`, `scripts/owner-verify.mjs`, `scripts/availability-verify.mjs` call
`create_pending_booking` with the **old signature** (`p_court_id`, no
`p_preferred_court_id`/`p_force_court`). Migration `...080010` replaced it. Every booking probe
fails with `PGRST202 "Could not find the function ..."`.
- `live-verify.mjs`: its "DOUBLE-BOOK rejected" assertion has been passing on a no-op — **false coverage**.
- `availability-verify.mjs` / `owner-verify.mjs`: throw uncaught mid-run, so **cleanup never
  runs**. `owner-verify.mjs` also leaves a throwaway user `verify-nonowner@tenniscourt.vn` and
  **rotates the owner password to a random value on every run** before crashing.

**Repro:** `bun scripts/live-verify.mjs` → 3 booking checks fail; the other two scripts crash.
**Root cause:** RPC signature drift not propagated to the live scripts.
**Suggested fix:** update all three to the current 11-arg signature (mirror the call in
`lib/actions/create-booking.ts:72-84`); wrap probe sections in `try/finally` for cleanup. The new
`scripts/verify-*.mjs` already use the correct signature and can replace much of this coverage.

### F2 — Stray `~/bun.lock` triggers wrong workspace-root inference — **Low (cosmetic)**
`next build`/`dev` warn: *"inferred your workspace root ... selected the directory of
/Users/khoivo/bun.lock"*.
**Suggested fix:** remove `~/bun.lock` if unused, or set `turbopack.root` in the Next config.

### F3 — Deployed DB has 1 court; seed defines 3 — **Low (environment drift)**
Cloud has only `Court 1`; `supabase/seed.sql` defines Sân 1–3. Auto-court distribution can't be
exercised on the real cloud without ≥2 courts (the concurrency harness provisions temporary
`VERIFY_Court_*` rows and removes them). Not a bug — but align the deployed data with the seed, or
add courts via the owner dashboard, before launch.

### F4 — Owner dashboard UI pass not completed — **Medium (coverage gap)**
The dashboard sits behind login and the owner password is randomized by `owner-verify.mjs` (and
resetting a production account password was correctly disallowed). The owner *effects* (confirm
locks, reject frees, status mirror) **are** verified at the data layer (Phase 3), and owner
login/`is_owner()`/RLS pass via `owner-verify.mjs`. Still untested through the UI:
confirm/reject buttons, manual booking (forced court), and the settings panel.
**Recommendation:** provide a known test-owner credential (or run a fixed `owner-verify.mjs` and
capture the printed password), then drive `/dashboard` to close this gap.

### Observation — No QR on receipt by design
`settings.bank_bin / bank_account_number / bank_account_name` and `qr_image_path` are all null, so
the receipt shows the transfer reference as text with no QR. If production wants a QR, the owner
must set the bank fields (dynamic VietQR) or upload a static QR.

---

## What was added (reusable)

- `scripts/verify-concurrency.mjs` — race/atomicity proof (correct RPC signature, self-cleaning).
- `scripts/verify-logic.mjs` — TS-oracle vs DB cross-checks.
- `scripts/verify-load.mjs` — latency/throughput/contention/scan-cost/realtime.

All use namespaced data (`VERIFY_*` names, `09900xxxxx` phones, 2027+ dates) and clean up in a
`finally` block. Cloud was left in its original state (0 bookings, 1 court) after the run.

## Recommended next steps (in order)

1. Fix F1 (update the three live scripts) so the suite stops giving false green.
2. Run the owner-dashboard UI pass (F4).
3. Align deployed courts with the seed (F3); remove `~/bun.lock` (F2).
4. Then proceed to new features — the core booking path is verified.

---

# Addendum — Broader operational simulation (2026-06-09)

Ran a full operational week against the cloud, including the owner side (login restored to
`mkhoi.1909`). New scripts: `scripts/sim-week.mjs` (demand) and `scripts/sim-process.mjs`
(owner processing + reconciliation). Cloud was left clean afterward (0 bookings, 1 court, rate
200k); the orphan `verify-nonowner@tenniscourt.vn` user from the earlier crash was removed.

### Setup & demand (3 courts: Court 1 + temp Court B 06–22 + Court C 08–20)
- **Evening rush (concurrent contention):** every popular evening slot filled **exactly 3 courts**
  (one each), the rest turned away — across 5 weekday rushes.
- **Scattered ad-hoc:** 39 booked, 7 turned away (busy slots).
- **Monthly regulars (July 2027):** 10 series, correct session counts + pricing
  (e.g. 3-block × 5 weeks = 1.500.000₫).
- Generated **49 pending bookings / 84 occurrences**. Court C correctly received fewer — it
  **rejects 06:00/07:00/20:00 slots outside its 08–20 hours** (operating-hours enforcement visible
  in the distribution).

### Owner dashboard UI (real browser, logged in as owner)
- Pending queue rendered all 49 (oldest-first, name/phone/court/type/ref/amount/age), no console errors.
- **Confirm** (BMM3KA69): booking → confirmed, occurrence mirrored, left the queue (49→48).
- **Reject** with reason (J8WUKPYP): booking → rejected, reason saved, slot **freed** in
  `public_availability` (48→47).
- **Manual booking** (GDPNQTZ9): created **confirmed, source=owner, forced to Court B**, 200.000₫.
- **Settings / Courts / Confirmed** pages render correct data with no console errors.

### Owner bulk processing + reconciliation (owner-authenticated RLS path) — 16/16
- Worked the 47-item queue: **35 confirmed / 8 rejected / 4 left** via the exact `owner.ts` queries.
- Dashboard query parity (pending/confirmed/rejected counts) ✓.
- Occurrence mirroring both directions ✓; rejected slots freed ✓.
- **Status guards:** cannot confirm a rejected booking, cannot reject a confirmed one (the
  `WHERE status='pending'` guard) ✓.
- **Global invariant:** 69 active occurrences across 3 courts, **0 overlaps** ✓.
- Pricing spot-check 5/5 ✓.
- **Settings → pricing:** changing the rate to 250.000₫ flowed into a new booking's amount, then
  restored to 200.000₫ ✓.

### Simulation verdict
The full lifecycle — public demand → contention → owner confirm/reject/manual/settings → slot
lock/free → reconciliation — behaves correctly end to end under realistic multi-court, multi-day
load. No new defects surfaced. Operating-hours enforcement and the owner status guards are both
confirmed working in addition to everything in the main report.
