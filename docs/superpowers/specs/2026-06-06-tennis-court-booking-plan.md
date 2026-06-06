# Tennis Court Booking — v1 Implementation Plan

Derived from `2026-06-06-tennis-court-booking-design.md` (reviewed). Backend: **cloud Supabase**.
Build executes as a **sequential** workflow pipeline — each phase is one focused agent that builds on
the committed output of the previous and verifies before handing off. Live DB push + DB/E2E tests run
once the cloud project is linked.

## Phase 0 — Foundation
- `bun install`. Confirm Next 16 conventions via context7/official docs (the `node_modules/next/dist/docs`
  path does not exist in Next 16).
- Swap tooling: remove `eslint` + `eslint-config-next`; add `@biomejs/biome`; `biome.json`; update
  `lint`/`format` scripts. Add `zod`, `@tanstack/react-query`, `@supabase/supabase-js`, `@supabase/ssr`.
- Supabase clients: browser, server (RSC/actions), middleware (session refresh) per `@supabase/ssr`.
- App shell: root layout, TanStack Query provider, env typing, `.env.local.example`.
- **Verify:** `bun run build`, `tsc --noEmit`, `biome check` all pass.

## Phase 1 — Database (migrations)
- `supabase init`. Migration(s): `btree_gist`; `court`, `booking`, `booking_occurrence` (generated
  `slot_date`, CHECKs), `settings`; `no_overlap` exclusion constraint; triggers (occurrence status
  mirror, court_id consistency); `public_availability` view; `realtime.broadcast_changes` trigger;
  `create_pending_booking` SECURITY DEFINER fn (+ shared date-enumeration + pricing fn); RLS
  (default-deny, anon view-only, owner policies); Storage bucket + policies; seed (owner, settings,
  demo court).
- DB tests (pgTAP or SQL assertions): overlap rejected, adjacency allowed, monthly counts, generated
  slot_date, reject frees slot, invariant, anon denied, create-fn spoof rejection.
- **Verify:** migrations apply cleanly to the linked cloud DB; DB tests pass.

## Phase 2 — Domain & data access
- Zod schemas (booking input, court, settings). Server-side enumeration + pricing module (mirrors the
  SQL fn for the preview). Server actions: `createBooking` (public; Zod + rate-limit + active-pending
  cap → `create_pending_booking`), `confirmBooking`/`rejectBooking`/`createManualBooking`,
  court + settings CRUD. TanStack Query hooks.
- **Verify:** `tsc`, `biome`, unit tests for pricing/enumeration + Zod.

## Phase 3 — Public surfaces
- Availability grid (per-court 30-min, current+next month, Broadcast subscription → query invalidate).
- Booking form (ad-hoc + monthly w/ month+weekday+time picker and per-week free/taken badges), amount
  preview via server pricing, post-submit screen (reference, amount, QR, pay instructions).
- **Verify:** `bun run build`.

## Phase 4 — Owner dashboard
- Auth (login, signups disabled, `getUser` gating at layout + actions). Pending queue (age, confirm
  status-guarded / reject). Confirmed view (filters). Manual booking. Court management. Settings (rate,
  QR upload).
- **Verify:** `bun run build`.

## Phase 5 — Verification & docs
- Full `bun run build` + `tsc` + `biome` + unit + DB tests; E2E smoke (public book → owner confirm →
  grid updates; reject → reopens). README setup (env, link, db push, run).
- **Verify:** DoD §12 items 1–9.

## Out of scope (later slices)
Zalo, AI posts, stock, renewal, auto-expiry, block-out dates, payment tier-2.
