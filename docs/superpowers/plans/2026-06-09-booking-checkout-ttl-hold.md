# Booking Checkout TTL-Hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline form→review→receipt booking flow with a guided wizard backed by a 3-state timed reservation (`held` → `pending` → `confirmed`), so a slot is briefly soft-locked while a customer pays, auto-releases if abandoned, and is shown to others as "⏳ đang giữ chỗ".

**Architecture:** A new `held` status (TTL on `booking.hold_expires_at`) joins the existing GiST exclusion constraint and `public_availability` view so a hold atomically blocks a slot. `create_pending_booking` gains a hold mode; a `pg_cron` sweeper expires stale holds; `finalizeBooking` promotes `held → pending`. The customer UI becomes a stepper with a countdown + Zalo proof step; the owner gets hold-visibility, a reconciliation surface, and a confirm audit log.

**Tech Stack:** Next.js 16 (App Router, RSC + server actions), Supabase/Postgres (RLS, GiST exclusion, pg_cron), TanStack Query, Zod, Bun test, Biome.

**Spec:** `docs/superpowers/specs/2026-06-09-booking-checkout-soft-hold-design.md`

**Conventions in this codebase (read before starting):**
- Server actions return `ActionResult<T>` via `ok()` / `fail()` from `lib/actions/types.ts`.
- Public writes use the service-role client (`lib/supabase/service.ts`); the function is `SECURITY DEFINER` and anon has no EXECUTE.
- Migrations live in `supabase/migrations/` named `YYYYMMDDHHMMSS_*.sql`; SQL assertion tests in `supabase/tests/*.sql`; live JS checks in `scripts/*.mjs` (run with `bun`).
- Run checks: `bun test` (unit), `bunx tsc --noEmit`, `bun run lint`, `bun run build`.
- Reference generator, court auto-assign, pricing, and enumeration already live in `supabase/migrations/20260606080010_auto_court_and_multiweekday.sql` (`create_pending_booking`).

---

## File Structure

**Database (new migration `supabase/migrations/<TS>_ttl_hold.sql`):**
- status CHECK widening (`booking`, `booking_occurrence`), `booking.hold_expires_at`, `no_overlap` predicate, `public_availability` rewrite (+`held` boolean), `broadcast_availability_change` update, `settings.owner_zalo`, `public_settings` rewrite.
- `create_pending_booking` gains `p_hold_minutes`.
- `pg_cron` sweeper + `booking_audit` table.

**Domain/actions:**
- `lib/booking/zalo.ts` (new) — validate/normalize a Zalo contact to an https URL.
- `lib/booking/schemas.ts` — add `ownerZalo` to `settingsInputSchema`.
- `lib/booking/rate-limit.ts` — add `MAX_ACTIVE_RESERVATIONS`.
- `lib/actions/create-booking.ts` — `createHold`, `finalizeBooking`, `getHold` (replaces single `createBooking`).
- `lib/actions/owner.ts` — `updateSettings` persists `owner_zalo`; `confirmBooking` writes audit row.
- `lib/queries/public.ts`, `lib/queries/availability.ts`, `lib/queries/types.ts` — surface `owner_zalo` + `held`.

**UI:**
- `components/booking/booking-form.tsx` — wizard state machine + stepper.
- `components/booking/booking-receipt.tsx` — payment step (countdown, claim, Zalo, finalize) + done/recovery.
- `components/booking/checkout-storage.ts` (new) — localStorage resume helpers.
- `components/availability/slot-grid.tsx` — "⏳ đang giữ chỗ" rendering.
- `components/dashboard/settings-panel.tsx` — owner Zalo input.
- dashboard owner views — held visibility + reconciliation.

**Verification:**
- `scripts/verify-hold.mjs` (new), extend `scripts/verify-concurrency.mjs`.

---

## Phase 1 — Database

### Task 1: Migration — statuses, hold column, constraint, views, broadcast, owner_zalo, audit

**Files:**
- Create: `supabase/migrations/20260610000000_ttl_hold.sql`
- Test: `supabase/tests/06_hold_lifecycle.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260610000000_ttl_hold.sql`:

```sql
-- TTL hold: 'held'/'expired' statuses, hold_expires_at, widened exclusion + view,
-- broadcast fix, owner_zalo, confirm audit. See spec 2026-06-09.

begin;

-- 1. Status CHECKs (drop both, recreate with held + expired)
alter table public.booking drop constraint if exists booking_status_check;
alter table public.booking
  add constraint booking_status_check
  check (status in ('held','pending','confirmed','rejected','expired'));

alter table public.booking_occurrence drop constraint if exists booking_occurrence_status_check;
alter table public.booking_occurrence
  add constraint booking_occurrence_status_check
  check (status in ('held','pending','confirmed','rejected','expired'));

-- 2. Expiry column (single source of truth; nullable, no backfill)
alter table public.booking add column if not exists hold_expires_at timestamptz;

-- 3. Widen the exclusion constraint to include 'held'
set local lock_timeout = '4s';
alter table public.booking_occurrence drop constraint if exists no_overlap;
alter table public.booking_occurrence
  add constraint no_overlap
  exclude using gist (court_id with =, time_range with &&)
  where (status in ('held','pending','confirmed'));

-- 4. public_availability: include held-not-expired, expose non-PII 'held' flag
drop view if exists public.public_availability;
create view public.public_availability
  with (security_invoker = off)
as
select
  o.court_id,
  o.slot_date,
  o.time_range,
  true as occupied,
  (o.status = 'held') as held
from public.booking_occurrence o
join public.booking b on b.id = o.booking_id
where o.status in ('pending','confirmed')
   or (o.status = 'held' and b.hold_expires_at > now());
grant select on public.public_availability to anon, authenticated;

-- 5. Broadcast: treat held as occupied (was pending/confirmed only)
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
  v_occupied   boolean;
begin
  if tg_op = 'DELETE' then
    v_court_id := old.court_id; v_time_range := old.time_range; v_slot_date := old.slot_date;
    v_occupied := false;
  else
    v_court_id := new.court_id; v_time_range := new.time_range; v_slot_date := new.slot_date;
    v_occupied := new.status in ('held','pending','confirmed');
  end if;
  perform realtime.send(
    jsonb_build_object('court_id', v_court_id, 'slot_date', v_slot_date,
                       'time_range', v_time_range, 'occupied', v_occupied),
    tg_op, 'availability:court:' || v_court_id::text, false);
  return null;
end;
$$;

-- 6. owner_zalo + public_settings (drop+create re-grants)
alter table public.settings add column if not exists owner_zalo text;
drop view if exists public.public_settings;
create view public.public_settings
  with (security_invoker = off)
as
select id, flat_hourly_rate_vnd, qr_image_path, owner_zalo
from public.settings;
grant select on public.public_settings to anon, authenticated;

-- 7. Confirm/reject audit log (owner-only)
create table if not exists public.booking_audit (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.booking(id) on delete set null,
  reference text,
  action text not null check (action in ('confirm','reject')),
  actor_uid uuid,
  created_at timestamptz not null default now()
);
alter table public.booking_audit enable row level security;
create policy booking_audit_owner_all on public.booking_audit
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

commit;
```

- [ ] **Step 2: Write the SQL assertion test**

Create `supabase/tests/06_hold_lifecycle.sql` (run with `psql -v ON_ERROR_STOP=1 -f`):

```sql
\set ON_ERROR_STOP on
begin;
-- a held occurrence is accepted by the new CHECK and blocks the slot
do $$
declare c uuid; b uuid;
begin
  select id into c from public.court where is_active limit 1;
  insert into public.booking(court_id,type,customer_name,zalo_phone,status,reference,amount_vnd,hold_expires_at,source)
    values (c,'adhoc','TST_HOLD','0900000000','held','TSTHOLD1',100000, now()+interval '15 min','public') returning id into b;
  insert into public.booking_occurrence(booking_id,court_id,time_range,status)
    values (b,c,tstzrange('2031-01-01 00:00+00','2031-01-01 01:00+00','[)'),'held');
  -- second held on same slot must violate no_overlap
  begin
    insert into public.booking(court_id,type,customer_name,zalo_phone,status,reference,amount_vnd,hold_expires_at,source)
      values (c,'adhoc','TST_HOLD2','0900000001','held','TSTHOLD2',100000, now()+interval '15 min','public') returning id into b;
    insert into public.booking_occurrence(booking_id,court_id,time_range,status)
      values (b,c,tstzrange('2031-01-01 00:00+00','2031-01-01 01:00+00','[)'),'held');
    raise exception 'expected exclusion_violation';
  exception when exclusion_violation then null; end;
end $$;
rollback;
```

- [ ] **Step 3: Apply + verify locally**

Run: `supabase db reset` (re-applies all migrations + seed) OR `supabase db push` against the linked project.
Expected: applies with no error. Then `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/06_hold_lifecycle.sql` → no error (assertion passes).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260610000000_ttl_hold.sql supabase/tests/06_hold_lifecycle.sql
git commit -m "feat(db): held/expired statuses, hold_expires_at, widened exclusion+view, broadcast fix, owner_zalo, audit"
```

---

### Task 2: `create_pending_booking` gains hold mode

**Files:**
- Modify: append a new `create or replace function public.create_pending_booking(...)` to `supabase/migrations/20260610000000_ttl_hold.sql` (or a follow-on migration `20260610000100_create_hold_mode.sql`).

- [ ] **Step 1: Copy the current function and add the hold parameter**

Read the authoritative body in `supabase/migrations/20260606080010_auto_court_and_multiweekday.sql`. Create `supabase/migrations/20260610000100_create_hold_mode.sql` that `create or replace`s it **verbatim** plus these changes:

1. Add a trailing parameter: `p_hold_minutes int default null`.
2. Declare `v_status text := case when p_hold_minutes is null then 'pending' else 'held' end;` and `v_expires timestamptz := case when p_hold_minutes is null then null else now() + (p_hold_minutes || ' minutes')::interval end;`.
3. In the parent `insert into public.booking(...)`, set `status = v_status` (was hardcoded `'pending'`) and `hold_expires_at = v_expires`.
4. In the per-date `insert into public.booking_occurrence(...)`, set `status = v_status` (was `'pending'`).
5. In the candidate-court load-balance count subquery, change the status filter from `('pending','confirmed')` to `('held','pending','confirmed')` so holds count toward balancing.

Leave reference generation, court loop, exclusion handling, amount math, and the return shape unchanged.

```sql
-- 20260610000100_create_hold_mode.sql (skeleton — fill body from 080010)
create or replace function public.create_pending_booking(
  p_type text, p_customer_name text, p_zalo_phone text, p_group_size int,
  p_start_time time, p_block_count int, p_month date, p_weekdays int[], p_date date,
  p_preferred_court_id uuid, p_force_court boolean,
  p_hold_minutes int default null  -- NEW
) returns table(reference text, amount_vnd bigint, occurrences int, court_id uuid, court_name text)
language plpgsql security definer set search_path = '' as $$
declare
  -- ... existing declarations ...
  v_status text := case when p_hold_minutes is null then 'pending' else 'held' end;          -- NEW
  v_expires timestamptz := case when p_hold_minutes is null then null
                                else now() + (p_hold_minutes || ' minutes')::interval end;     -- NEW
begin
  -- ... existing validation + enumeration + court loop ...
  --   parent insert: status = v_status, hold_expires_at = v_expires
  --   occurrence insert: status = v_status
  --   balance count: where status in ('held','pending','confirmed')
end $$;
revoke all on function public.create_pending_booking(text,text,text,int,time,int,date,int[],date,uuid,boolean,int) from anon;
```

> Note: the signature changes (extra param) — re-issue the `revoke ... from anon` for the new signature, and update any DB tests that call the function positionally.

- [ ] **Step 2: Assertion test — hold mode creates a held booking**

Append to `supabase/tests/06_hold_lifecycle.sql` a block calling the function with `p_hold_minutes => 15` and asserting the returned reference exists with `status='held'` and `hold_expires_at > now()`, then `rollback`.

- [ ] **Step 3: Apply + run tests**

Run: `supabase db reset` then the SQL test. Expected: hold-mode call returns a row; `status='held'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260610000100_create_hold_mode.sql supabase/tests/06_hold_lifecycle.sql
git commit -m "feat(db): create_pending_booking hold mode (p_hold_minutes)"
```

---

### Task 3: Sweeper (expire stale holds)

**Files:**
- Create: `supabase/migrations/20260610000200_hold_sweeper.sql`

- [ ] **Step 1: Write the sweeper**

```sql
-- Expire holds whose pay window elapsed. booking_status_mirror cascades to
-- occurrences (drops them out of no_overlap) and broadcasts occupied=false.
create or replace function public.expire_stale_holds()
returns void language sql security definer set search_path = '' as $$
  update public.booking set status = 'expired'
  where status = 'held' and hold_expires_at < now();
$$;

create extension if not exists pg_cron;
-- every minute
select cron.schedule('expire-stale-holds', '* * * * *', $$select public.expire_stale_holds();$$);
```

> If `pg_cron` is unavailable on the plan, the view already hides expired holds; document that re-bookability of a just-expired slot then waits for the next conflicting insert. Prefer enabling pg_cron in the Supabase dashboard (Database → Extensions).

- [ ] **Step 2: Verify the function runs**

Run (psql): `select public.expire_stale_holds();` Expected: no error. `select * from cron.job where jobname='expire-stale-holds';` Expected: one row.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260610000200_hold_sweeper.sql
git commit -m "feat(db): pg_cron sweeper to expire stale holds"
```

---

## Phase 2 — Domain & server actions

### Task 4: Zalo validation helper + schema

**Files:**
- Create: `lib/booking/zalo.ts`
- Create: `lib/booking/zalo.test.ts`
- Modify: `lib/booking/schemas.ts` (add `ownerZalo` to `settingsInputSchema`)

- [ ] **Step 1: Write the failing test**

Create `lib/booking/zalo.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { normalizeOwnerZalo, safeZaloHref } from "./zalo";

describe("normalizeOwnerZalo", () => {
  test("bare phone -> zalo.me url", () => {
    expect(normalizeOwnerZalo("0901234567")).toBe("https://zalo.me/0901234567");
    expect(normalizeOwnerZalo("+84901234567")).toBe("https://zalo.me/+84901234567");
  });
  test("accepts https zalo.me urls", () => {
    expect(normalizeOwnerZalo("https://zalo.me/abc")).toBe("https://zalo.me/abc");
    expect(normalizeOwnerZalo("https://chat.zalo.me/x")).toBe("https://chat.zalo.me/x");
  });
  test("rejects other hosts / schemes", () => {
    expect(normalizeOwnerZalo("javascript:alert(1)")).toBeNull();
    expect(normalizeOwnerZalo("https://evil.com")).toBeNull();
    expect(normalizeOwnerZalo("data:text/html,x")).toBeNull();
    expect(normalizeOwnerZalo("")).toBeNull();
  });
});

describe("safeZaloHref", () => {
  test("passes only https", () => {
    expect(safeZaloHref("https://zalo.me/x")).toBe("https://zalo.me/x");
    expect(safeZaloHref("javascript:alert(1)")).toBeNull();
    expect(safeZaloHref(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `bun test lib/booking/zalo.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `lib/booking/zalo.ts`:

```ts
const ZALO_HOSTS = new Set(["zalo.me", "chat.zalo.me"]);
function isZaloHost(h: string): boolean {
  return ZALO_HOSTS.has(h) || h.endsWith(".zalo.me");
}

/** Validate/normalize an owner-entered Zalo contact to a safe https URL, or null. */
export function normalizeOwnerZalo(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\+?\d{6,15}$/.test(v)) return `https://zalo.me/${v}`;
  try {
    const u = new URL(v);
    if (u.protocol === "https:" && isZaloHost(u.hostname)) return v;
  } catch {}
  return null;
}

/** Render-time guard: only emit https hrefs. */
export function safeZaloHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test lib/booking/zalo.test.ts` → PASS.

- [ ] **Step 5: Wire into settings schema**

In `lib/booking/schemas.ts`, add to `settingsInputSchema` an optional field:

```ts
ownerZalo: z
  .string()
  .trim()
  .max(200)
  .optional()
  .refine((v) => v === undefined || v === "" || normalizeOwnerZalo(v) !== null, {
    message: "Zalo phải là số điện thoại hoặc link zalo.me",
  }),
```

(Import `normalizeOwnerZalo` at the top.) Run `bunx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add lib/booking/zalo.ts lib/booking/zalo.test.ts lib/booking/schemas.ts
git commit -m "feat(booking): owner Zalo validation/normalization"
```

---

### Task 5: `createHold` server action + reservation cap

**Files:**
- Modify: `lib/booking/rate-limit.ts` (add `MAX_ACTIVE_RESERVATIONS`)
- Modify: `lib/actions/create-booking.ts`

- [ ] **Step 1: Add the cap constant**

In `lib/booking/rate-limit.ts` add:

```ts
/** Max simultaneous active reservations (held-not-expired + pending) per phone/IP. */
export const MAX_ACTIVE_RESERVATIONS = 3;
```

- [ ] **Step 2: Implement `createHold`**

In `lib/actions/create-booking.ts`, rename the receipt type to add `holdExpiresAt`, and replace the body of `createBooking` with a `createHold` that creates a hold. Keep `clientIp`, `translateRpcError`, and the QR/settings build. Add the reservation cap (authoritative DB count, per phone AND per ip — store the latest IP on... we have no ip column, so the IP cap is best-effort via the in-memory limiter; the DB cap is per-phone). Concretely:

```ts
export type BookingReceipt = {
  reference: string; amountVnd: number; occurrences: number; courtName: string;
  qrUrl: string | null; qrImagePath: string | null;
  bankAccountName: string | null; bankAccountNumber: string | null;
  ownerZalo: string | null;            // NEW
  holdExpiresAt: string;               // NEW (ISO)
};

const HOLD_MINUTES = 15;

export async function createHold(input: BookingInput): Promise<ActionResult<BookingReceipt>> {
  const parsed = bookingInputSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(first?.message ?? "Invalid booking input", first?.path.join("."));
  }
  const data = parsed.data;
  const ip = await clientIp();
  if (!checkRateLimit(`ip:${ip}`) || !checkRateLimit(`phone:${data.zaloPhone}`)) {
    return fail("Too many requests. Please wait a moment and try again.");
  }
  const supabase = createServiceClient();

  // Authoritative active-reservation cap (held-not-expired + pending) per phone.
  const { count, error: countError } = await supabase
    .from("booking")
    .select("id", { count: "exact", head: true })
    .eq("zalo_phone", data.zaloPhone)
    .or(`status.eq.pending,and(status.eq.held,hold_expires_at.gt.${new Date().toISOString()})`);
  if (countError) return fail("Could not verify your reservations. Please try again.");
  if ((count ?? 0) >= MAX_ACTIVE_RESERVATIONS) {
    return fail(`Bạn đang có ${MAX_ACTIVE_RESERVATIONS} lượt giữ chỗ/chờ xác nhận. Vui lòng hoàn tất hoặc chờ chủ sân.`);
  }

  const { data: rpcRows, error } = await supabase.rpc("create_pending_booking", {
    p_type: data.type, p_customer_name: data.customerName, p_zalo_phone: data.zaloPhone,
    p_group_size: data.groupSize, p_start_time: data.startTime, p_block_count: data.blockCount,
    p_month: data.type === "monthly" ? data.month : null,
    p_weekdays: data.type === "monthly" ? data.weekdays : null,
    p_date: data.type === "adhoc" ? data.date : null,
    p_preferred_court_id: data.preferredCourtId ?? null,
    p_force_court: false,
    p_hold_minutes: HOLD_MINUTES,        // NEW
  });
  if (error) return fail(translateRpcError(error.message));
  const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  if (!row) return fail("Could not hold the slot. Please try again.");

  const amountVnd = Number(row.amount_vnd);
  const { data: settings } = await supabase
    .from("settings")
    .select("qr_image_path, bank_bin, bank_account_number, bank_account_name, owner_zalo")
    .eq("id", 1).maybeSingle();
  const bankBin = settings?.bank_bin ?? null;
  const bankAccountNumber = settings?.bank_account_number ?? null;
  const bankAccountName = settings?.bank_account_name ?? null;
  const qrUrl = bankBin && bankAccountNumber && bankAccountName
    ? buildVietQrUrl({ bankBin, accountNumber: bankAccountNumber, accountName: bankAccountName, amountVnd, memo: row.reference })
    : null;

  // hold_expires_at: re-read the booking we just created.
  const { data: held } = await supabase.from("booking").select("hold_expires_at").eq("reference", row.reference).single();

  return ok({
    reference: row.reference, amountVnd, occurrences: row.occurrences, courtName: row.court_name,
    qrUrl, qrImagePath: settings?.qr_image_path ?? null,
    bankAccountName, bankAccountNumber, ownerZalo: settings?.owner_zalo ?? null,
    holdExpiresAt: held?.hold_expires_at ?? new Date(Date.now() + HOLD_MINUTES * 60000).toISOString(),
  });
}
```

- [ ] **Step 3: Verify types**

Run: `bunx tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add lib/booking/rate-limit.ts lib/actions/create-booking.ts
git commit -m "feat(actions): createHold with active-reservation cap"
```

---

### Task 6: `finalizeBooking` + `getHold`

**Files:**
- Modify: `lib/actions/create-booking.ts`

- [ ] **Step 1: Implement `finalizeBooking`**

```ts
export async function finalizeBooking(reference: string): Promise<ActionResult<{ status: "pending" }>> {
  if (!reference || typeof reference !== "string") return fail("Invalid reference");
  const ip = await clientIp();
  if (!checkRateLimit(`finalize:${ip}`)) return fail("Too many requests.");
  const supabase = createServiceClient();

  // Guarded promotion held -> pending (only while the hold is live).
  const { data, error } = await supabase
    .from("booking")
    .update({ status: "pending", hold_expires_at: null })
    .eq("reference", reference).eq("status", "held").gt("hold_expires_at", new Date().toISOString())
    .select("id").maybeSingle();
  if (error) return fail("Could not finalize. Please try again.");
  if (data) return ok({ status: "pending" });

  // Idempotent: already finalized?
  const { data: existing } = await supabase
    .from("booking").select("status").eq("reference", reference).maybeSingle();
  if (existing?.status === "pending" || existing?.status === "confirmed") return ok({ status: "pending" });

  // Expired or gone.
  return fail("HOLD_EXPIRED");
}

export async function getHold(reference: string): Promise<ActionResult<BookingReceipt>> {
  const supabase = createServiceClient();
  const { data: b } = await supabase
    .from("booking")
    .select("reference, amount_vnd, status, hold_expires_at, court:court_id(name)")
    .eq("reference", reference).maybeSingle();
  if (!b || b.status !== "held" || !b.hold_expires_at || new Date(b.hold_expires_at) <= new Date()) {
    return fail("HOLD_EXPIRED");
  }
  const { count } = await supabase.from("booking_occurrence").select("id", { count: "exact", head: true })
    .eq("booking_id", (await supabase.from("booking").select("id").eq("reference", reference).single()).data!.id);
  const amountVnd = Number(b.amount_vnd);
  const { data: settings } = await supabase.from("settings")
    .select("qr_image_path, bank_bin, bank_account_number, bank_account_name, owner_zalo").eq("id", 1).maybeSingle();
  const qrUrl = settings?.bank_bin && settings?.bank_account_number && settings?.bank_account_name
    ? buildVietQrUrl({ bankBin: settings.bank_bin, accountNumber: settings.bank_account_number, accountName: settings.bank_account_name, amountVnd, memo: b.reference })
    : null;
  return ok({
    reference: b.reference, amountVnd, occurrences: count ?? 1,
    courtName: (b.court as { name: string } | null)?.name ?? "",
    qrUrl, qrImagePath: settings?.qr_image_path ?? null,
    bankAccountName: settings?.bank_account_name ?? null, bankAccountNumber: settings?.bank_account_number ?? null,
    ownerZalo: settings?.owner_zalo ?? null, holdExpiresAt: b.hold_expires_at,
  });
}
```

- [ ] **Step 2: Verify types & lint**

Run: `bunx tsc --noEmit` and `bun run lint` → clean.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/create-booking.ts
git commit -m "feat(actions): finalizeBooking (held->pending, idempotent) + getHold resume read"
```

---

### Task 7: Owner settings persist `owner_zalo` + audit on confirm/reject

**Files:**
- Modify: `lib/actions/owner.ts`

- [ ] **Step 1: Persist owner_zalo in `updateSettings`**

In `updateSettings`, add to the `.update({...})` object: `owner_zalo: blankToNull(s.ownerZalo)` (reuse the existing `blankToNull` helper; `s.ownerZalo` comes from the extended schema). Store the normalized form:

```ts
import { normalizeOwnerZalo } from "@/lib/booking/zalo";
// ...
owner_zalo: s.ownerZalo ? normalizeOwnerZalo(s.ownerZalo) : null,
```

- [ ] **Step 2: Write an audit row in `confirmBooking` and `rejectBooking`**

After a successful guarded update (when `data` is non-null), insert an audit row using the owner client:

```ts
await guard.supabase.from("booking_audit").insert({
  booking_id: data.id, action: "confirm", actor_uid: (await guard.supabase.auth.getUser()).data.user?.id ?? null,
});
```

(Mirror with `action: "reject"` in `rejectBooking`. Best-effort: ignore audit insert errors.)

- [ ] **Step 3: Verify**

Run: `bunx tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/owner.ts
git commit -m "feat(owner): persist owner_zalo; audit confirm/reject"
```

---

### Task 8: Query/type plumbing for `owner_zalo` + `held`

**Files:**
- Modify: `lib/queries/public.ts`, `lib/queries/types.ts`, `lib/queries/availability.ts`

- [ ] **Step 1: Extend types + selects**

- In `lib/queries/types.ts`: add `owner_zalo: string | null` to the public settings row type, and `held: boolean` to the availability row type.
- In `lib/queries/public.ts` (`usePublicSettings`): add `owner_zalo` to the `.select(...)`.
- In `lib/queries/availability.ts` (both hooks): add `held` to the `.select("court_id, slot_date, time_range, occupied, held")`.

- [ ] **Step 2: Verify**

Run: `bunx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add lib/queries/public.ts lib/queries/types.ts lib/queries/availability.ts
git commit -m "feat(queries): surface owner_zalo + held flag"
```

---

## Phase 3 — UI

### Task 9: localStorage resume helpers

**Files:**
- Create: `components/booking/checkout-storage.ts`
- Create: `components/booking/checkout-storage.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { saveCheckout, loadCheckout, clearCheckout } from "./checkout-storage";

describe("checkout-storage", () => {
  beforeEach(() => clearCheckout());
  test("round-trips a live hold", () => {
    const future = new Date(Date.now() + 60000).toISOString();
    saveCheckout({ reference: "ABC12345", holdExpiresAt: future });
    expect(loadCheckout()?.reference).toBe("ABC12345");
  });
  test("drops an expired hold", () => {
    saveCheckout({ reference: "OLD", holdExpiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(loadCheckout()).toBeNull();
  });
});
```

> Bun test provides a DOM-less env; guard `localStorage` access. Provide a tiny in-memory shim in the module when `globalThis.localStorage` is undefined, OR run this test with a localStorage polyfill. Keep the module SSR-safe (`typeof window === "undefined"` → no-op).

- [ ] **Step 2: Implement**

```ts
const KEY = "tcb.checkout";
type Saved = { reference: string; holdExpiresAt: string };

function ls(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}
export function saveCheckout(v: Saved) { ls()?.setItem(KEY, JSON.stringify(v)); }
export function clearCheckout() { ls()?.removeItem(KEY); }
export function loadCheckout(): Saved | null {
  const raw = ls()?.getItem(KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Saved;
    if (!v.reference || new Date(v.holdExpiresAt) <= new Date()) { clearCheckout(); return null; }
    return v;
  } catch { clearCheckout(); return null; }
}
```

- [ ] **Step 3: Run tests** → `bun test components/booking/checkout-storage.test.ts` PASS.

- [ ] **Step 4: Commit**

```bash
git add components/booking/checkout-storage.ts components/booking/checkout-storage.test.ts
git commit -m "feat(booking): localStorage checkout resume helpers"
```

---

### Task 10: Wizard state machine (booking-form)

**Files:**
- Modify: `components/booking/booking-form.tsx`

- [ ] **Step 1: Replace the stage model**

Change `stage` from `"form" | "review"` to `"form" | "review" | "payment" | "done"`. Replace `createBooking` import with `createHold, finalizeBooking`. Keep all existing form rendering (Task leaves the form + review JSX intact). Changes:

- `onConfirm` now calls `createHold` (not the old create). On success: store the receipt, `saveCheckout({reference, holdExpiresAt})`, set `stage="payment"`. On failure: surface `error`, return to `form`.
- Add a top **stepper** component above the content showing Thông tin / Xác nhận / Thanh toán / Hoàn tất with the active step highlighted (derive from `stage`).
- On mount (`useEffect`), call `loadCheckout()`; if a live reference exists, call `getHold(reference)` and, if ok, jump straight to `stage="payment"` with that receipt (resume). If `getHold` fails, `clearCheckout()`.

```tsx
import { createHold, finalizeBooking, getHold } from "@/lib/actions/create-booking";
import { saveCheckout, loadCheckout, clearCheckout } from "./checkout-storage";
// stage state:
const [stage, setStage] = useState<"form" | "review" | "payment" | "done">("form");
const [receipt, setReceipt] = useState<BookingReceipt | null>(null);
const [finalizeState, setFinalizeState] = useState<"idle" | "expired">("idle");

useEffect(() => {
  const saved = loadCheckout();
  if (!saved) return;
  getHold(saved.reference).then((r) => {
    if (r.ok) { setReceipt(r.data); setStage("payment"); } else clearCheckout();
  });
}, []);

function onConfirm() {
  setError(null);
  const parsed = bookingInputSchema.safeParse(buildInput());
  if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "..."); setStage("form"); return; }
  startTransition(async () => {
    const result = await createHold(parsed.data);
    if (result.ok) { setReceipt(result.data); saveCheckout({ reference: result.data.reference, holdExpiresAt: result.data.holdExpiresAt }); setStage("payment"); }
    else { setError(result.error); setStage("form"); }
  });
}
```

- [ ] **Step 2: Render payment/done stages**

Replace the old `if (receipt?.ok) return <BookingReceiptScreen .../>` with stage-driven rendering that delegates to the new payment component (Task 11):

```tsx
if (stage === "payment" && receipt) {
  return <PaymentStep receipt={receipt} onExpired={() => { clearCheckout(); setStage("form"); setError("Hết thời gian giữ chỗ. Vui lòng đặt lại."); }}
    onDone={() => { clearCheckout(); setStage("done"); }} finalizeState={finalizeState} setFinalizeState={setFinalizeState} />;
}
if (stage === "done" && receipt) return <BookingDoneScreen receipt={receipt} />;
```

- [ ] **Step 3: Verify** → `bunx tsc --noEmit` clean (PaymentStep/BookingDoneScreen come from Task 11; create them first or stub).

- [ ] **Step 4: Commit**

```bash
git add components/booking/booking-form.tsx
git commit -m "feat(booking): 4-step wizard state machine + hold resume"
```

---

### Task 11: Payment step — countdown, claim, Zalo, finalize; done/recovery

**Files:**
- Modify: `components/booking/booking-receipt.tsx` (export `PaymentStep`, `BookingDoneScreen`)

- [ ] **Step 1: Build `PaymentStep`**

Reuse the existing receipt JSX (amount, court, QR, pay-by-hand DetailRows). Add:
- A **countdown** from `receipt.holdExpiresAt` (a `useEffect` interval computing `remaining = expires - now`); when `remaining <= 0`, call `onExpired()`. Render `mm:ss`; apply a red class only when `< 60s`. Copy: "Giữ chỗ trong {mm:ss} · Hết giờ chỉ cần đặt lại, bạn không mất tiền."
- A primary button **"Đã chuyển khoản"** that reveals the Zalo block (`useState revealed`).
- Zalo block: a deep-link button using `safeZaloHref(receipt.ownerZalo)` (from `lib/booking/zalo.ts`) — render `<a href target=_blank rel="noopener noreferrer">Gửi ảnh qua Zalo</a>` only if non-null; else instruction text. Then the final button **"Rồi, hoàn tất"**.
- Final button → `startTransition(() => finalizeBooking(receipt.reference))`. On ok → `onDone()`. On `HOLD_EXPIRED` → show recovery copy: "Khung giờ đã hết giữ chỗ. Nếu bạn đã chuyển khoản, gửi ảnh + mã {reference} qua Zalo — chủ sân sẽ xử lý." Guard double-submit via the transition `pending`.

```tsx
import { useEffect, useState, useTransition } from "react";
import { finalizeBooking } from "@/lib/actions/create-booking";
import { safeZaloHref } from "@/lib/booking/zalo";

export function PaymentStep({ receipt, onExpired, onDone }: {
  receipt: BookingReceipt; onExpired: () => void; onDone: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [pending, start] = useTransition();
  const [expired, setExpired] = useState(false);
  const [left, setLeft] = useState(() => Math.max(0, +new Date(receipt.holdExpiresAt) - Date.now()));
  useEffect(() => {
    const t = setInterval(() => {
      const ms = Math.max(0, +new Date(receipt.holdExpiresAt) - Date.now());
      setLeft(ms);
      if (ms <= 0) { clearInterval(t); onExpired(); }
    }, 1000);
    return () => clearInterval(t);
  }, [receipt.holdExpiresAt, onExpired]);
  const mm = String(Math.floor(left / 60000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  const zalo = safeZaloHref(receipt.ownerZalo);
  // ... existing amount/court/QR/detail JSX ...
  function finalize() {
    start(async () => {
      const r = await finalizeBooking(receipt.reference);
      if (r.ok) onDone(); else setExpired(true);
    });
  }
  // render countdown, "Đã chuyển khoản" -> reveal -> zalo link + "Rồi, hoàn tất" (disabled while pending),
  // and the expired recovery block when `expired`.
}
```

- [ ] **Step 2: Build `BookingDoneScreen`**

A confirmation: "Đang chờ chủ sân xác nhận", showing court, reference, amount, a `Chờ xác nhận` pill, and a "Về lịch trống" link (reuse existing styles from the old receipt header/amount card).

- [ ] **Step 3: Verify + lint** → `bunx tsc --noEmit`, `bun run lint` clean.

- [ ] **Step 4: Commit**

```bash
git add components/booking/booking-receipt.tsx
git commit -m "feat(booking): payment step (countdown, claim, Zalo, finalize) + done/recovery"
```

---

### Task 12: Slot grid — "⏳ đang giữ chỗ"

**Files:**
- Modify: `components/availability/slot-grid.tsx`

- [ ] **Step 1: Thread the `held` flag**

The grid builds occupancy from availability rows (see `occByDateCourt` pattern in `booking-form.tsx:144` and the grid in `slot-grid.tsx:92`). Track, per occupied block, whether ALL covering rows are `held` (vs any confirmed/pending). Where the cell currently renders `occupied ? "kín sân"` (`slot-grid.tsx:280`), render `held ? "⏳ đang giữ chỗ" : "kín sân"`. Keep the cell disabled either way.

- [ ] **Step 2: Verify visually**

Run `bun run dev`; create a hold via the wizard; confirm the slot shows "⏳ đang giữ chỗ" in another tab, and flips to free after expiry (≤1 min sweeper).

- [ ] **Step 3: Commit**

```bash
git add components/availability/slot-grid.tsx
git commit -m "feat(availability): show held slots as đang giữ chỗ"
```

---

### Task 13: Owner — settings input, held visibility, reconciliation

**Files:**
- Modify: `components/dashboard/settings-panel.tsx`
- Modify: owner availability/calendar component + confirmed/queue views as needed

- [ ] **Step 1: Owner Zalo input**

Add an "Owner Zalo" text input to `settings-panel.tsx` bound to the settings form; submit through `updateSettings` (schema already accepts `ownerZalo`). Show the validation error inline on failure.

- [ ] **Step 2: Held visibility for the owner**

Wherever the owner views the grid/calendar, label held slots "đang giữ chỗ (chưa thanh toán)" (the owner reads the same `public_availability.held` or, with owner RLS, the base table `status`). Keep holds OUT of the pending queue (`usePendingBookings` already filters `status='pending'` — no change).

- [ ] **Step 3: Reconciliation surface**

Add a small "Giữ chỗ đã hết hạn" section (owner read of `booking` where `status='expired'` within the last N days) so the owner can spot a customer who paid during an expired hold and refund/re-book. Read-only list: customer, phone, reference, slot.

- [ ] **Step 4: Verify + commit**

Run: `bunx tsc --noEmit`, `bun run lint`, `bun run build` → clean.

```bash
git add components/dashboard/ app/
git commit -m "feat(owner): Zalo setting, held visibility, expired-hold reconciliation"
```

---

## Phase 4 — Verification

### Task 14: Concurrency + lifecycle harness

**Files:**
- Create: `scripts/verify-hold.mjs`

- [ ] **Step 1: Write the harness**

Model it on `scripts/verify-concurrency.mjs` (service-role client, `VERIFY_` namespacing, far-future 2027 dates, `try/finally` cleanup). Cover:
1. N concurrent `create_pending_booking(..., p_hold_minutes => 15)` on one slot → exactly #courts hold-wins, rest turned away; DB shows one active occupant per court.
2. Finalize a winner (update held→pending) → occurrence mirrors to pending; slot still occupied.
3. Force-expire a hold (`update booking set hold_expires_at = now() - interval '1 min'`), run `select public.expire_stale_holds();` → status becomes `expired`, slot frees in `public_availability`, and a fresh hold on that slot now succeeds.
4. Assert no overlap across held/pending/confirmed.

- [ ] **Step 2: Run it**

Run: `bun scripts/verify-hold.mjs` → all checks pass, exit 0. Cleanup leaves the DB as found.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-hold.mjs
git commit -m "test(live): hold lifecycle + concurrency verification"
```

---

### Task 15: Full static + browser pass

- [ ] **Step 1: Static gates**

Run: `bun test` (all unit incl. zalo + checkout-storage), `bunx tsc --noEmit`, `bun run lint`, `bun run build`. Expected: all green.

- [ ] **Step 2: Browser E2E (manual or /browse)**

Drive `bun run dev`:
1. Ad-hoc: form → review → "Tiến hành thanh toán" (hold created, slot shows ⏳ in another tab) → countdown visible → "Đã chuyển khoản" → Zalo link present (set an owner Zalo first) → "Rồi, hoàn tất" → "Đang chờ xác nhận" with court + reference.
2. Expiry: reach payment, wait/force expiry → "Đặt lại" path; slot frees.
3. Refresh on payment step → resumes same reference/QR.
4. Owner: held slot labeled "đang giữ chỗ"; after finalize it appears in the pending queue; confirm → audit row written; confirmed grid locked.

- [ ] **Step 3: Commit any fixes; done.**

---

## Self-Review (completed)

- **Spec coverage:** 3-state lifecycle (Tasks 1,2,5,6), exclusion+view+broadcast (Task 1), sweeper (Task 3), reservation cap/DoS (Task 5), finalize idempotency + recovery (Tasks 6,11), owner_zalo validation write+render (Tasks 4,7,11,13), localStorage resume (Tasks 9,10), slot-grid ⏳ (Task 12), owner held-visibility + reconciliation + audit (Tasks 7,13), verification (Tasks 14,15). All spec sections map to a task.
- **Placeholder scan:** backend tasks carry full SQL/TS; UI tasks give concrete state code + reuse existing JSX by file:line. No "TBD"/"add error handling" left.
- **Type consistency:** `BookingReceipt` extended once (Task 5) with `ownerZalo`/`holdExpiresAt` and reused in Tasks 6,10,11; `createHold`/`finalizeBooking`/`getHold` names consistent across Tasks 5,6,10,11; `held` flag consistent across Tasks 1,8,12.
- **Open risk to watch during execution:** `create_pending_booking` body must be copied verbatim from `...080010` (Task 2) — do not paraphrase the court loop / amount math.
```
