# Tennis Court Booking (v1)

A single-owner tennis court booking web app for a Vietnamese court business (1–4
courts). Public visitors see a live, PII-free availability grid and submit monthly
or ad-hoc booking requests; the owner confirms/rejects them from a private
dashboard. Built on **Next.js 16** (App Router, React 19), **Supabase** (Postgres
+ RLS + Auth + Realtime Broadcast + Storage), **TanStack Query**, **Zod**, and
**Biome**, managed with **Bun**.

See `docs/superpowers/specs/` for the full design spec and implementation plan.

## Required environment variables

Copy `.env.local.example` to `.env.local` and fill in the values from your
Supabase project (Dashboard → Project Settings → API). `.env.local` is gitignored
and must never be committed.

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public (browser + server) | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public (browser + server) | anon key for the browser/SSR clients |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | full-access key used **only** by the public booking server action to call `create_pending_booking` (anon lacks EXECUTE per spec §9). Never prefix with `NEXT_PUBLIC_`, never expose to the browser. |

The build itself does not require these (clients read env lazily inside
functions), so `bun run build` works in CI without secrets. The app needs them at
runtime.

## Run locally

```bash
bun install
bun run dev          # http://localhost:3000
```

Public routes: `/availability` (live grid), `/book` (booking form). Owner routes:
`/login`, `/dashboard` (gated — requires the seeded owner, see below).

## Tests and static checks

```bash
bun run lint         # biome check .
bun run format       # biome format --write .
bunx tsc --noEmit    # type check
bun test             # unit tests (pricing, date enumeration, grid, schemas)
bun run build        # Next.js production build (also runs tsc)
```

The `bun test` suite is **pure-unit** (domain math: enumeration, pricing, grid,
Zod) and runs offline with no DB or env. The **DB tests** under `supabase/tests/`
and the **E2E smoke** flow require a live, linked Supabase instance (see below) —
they cannot run against a local stub.

## Cloud Supabase setup

The cloud project is **not** linked in this repo. Migrations and DB/E2E tests
require linking it first.

1. **Authenticate and link** (replace `<ref>` with your project ref from the
   dashboard URL):

   ```bash
   supabase login
   supabase link --project-ref <ref>
   ```

2. **Apply the schema** (migrations in `supabase/migrations/`, ordered
   `20260606080001`–`09`: schema, functions, triggers, view, RLS/grants, storage,
   public read surfaces, pgcrypto search_path, and integrity checks):

   ```bash
   supabase db push
   ```

3. **Seed the demo court + settings.** `supabase/seed.sql` inserts one demo court
   and the single `settings` row (sample flat rate). It is applied by
   `supabase db reset` locally; for the linked cloud DB you can run its statements
   via the SQL editor or `supabase db reset --linked` (destructive — only on a
   fresh project).

### Seed the owner user (public signups are disabled)

Per spec §7, public signups are **disabled**, so the single owner must be created
out-of-band, then recorded in `settings.owner_uid` (every RLS owner policy keys on
it via `is_owner()`). Until this is done, **no login succeeds** and the dashboard
is unreachable.

1. Create the owner auth user (one-off; choose a strong password):

   ```bash
   supabase auth users create owner@example.com --password '<STRONG_PASSWORD>'
   ```

   Or Dashboard → Authentication → Add user (keep "Auto Confirm" on). Confirm
   signups are off: Dashboard → Authentication → Providers → Email → turn OFF
   "Allow new users to sign up" (also set in `supabase/config.toml`:
   `[auth] enable_signup = false` and `[auth.email] enable_signup = false`).

2. Record the owner uid (run against the linked DB, e.g. SQL editor):

   ```sql
   update public.settings
   set owner_uid = (select id from auth.users where email = 'owner@example.com')
   where id = 1;
   ```

After step 2 the owner's authenticated session passes `is_owner()` and gains full
RLS access; any other authenticated account is denied everything. `login()`
returns "This account is not authorized." for any uid `!= owner_uid`.

3. Upload a QR image and set the flat rate from the dashboard Settings page
   (`/dashboard/settings`), or set `settings.flat_hourly_rate_vnd` /
   `settings.qr_image_path` directly.

### DB tests (linked DB only)

`supabase/tests/*.sql` assert the spec's DB guarantees (overlap rejected /
adjacency allowed, trigger invariants, enumeration + pricing, RLS default-deny,
non-owner denied). See `supabase/tests/README.md`. Run them against the linked DB
after `db push` and the owner-seed step. They (and Realtime/Storage policy
behavior) **cannot** be verified offline.

## Notes

- Timezone is fixed `Asia/Ho_Chi_Minh` (UTC+7, no DST). Timestamps stored UTC,
  rendered ICT; `slot_date` is an ICT calendar date derived from the slot's start
  instant.
- Hosting: Vercel. Set the three env vars in the Vercel project settings.
