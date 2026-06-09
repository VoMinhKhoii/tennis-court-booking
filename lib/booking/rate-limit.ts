/**
 * In-memory fixed-window rate limiter for the public booking action (spec §6,
 * §9 — "rate-limit + active-pending caps only" for ≤100 MAU). Keyed by an
 * arbitrary string (we key on both client IP and zalo_phone). Per-process and
 * best-effort; the authoritative abuse control is the active-pending cap, which
 * is enforced against the DB in the server action.
 *
 * Not for distributed/multi-instance correctness — the spec explicitly accepts
 * that sophisticated distributed abuse is out of scope for v1.
 */

type Window = { count: number; resetAt: number };

const WINDOW_MS = 60_000; // 1 minute
const MAX_PER_WINDOW = 5; // requests per key per window
const MAX_KEYS = 10_000; // bound the map to avoid unbounded growth

const buckets = new Map<string, Window>();

/**
 * @returns true if the request is allowed; false if the key is over its limit.
 * Each allowed call consumes one token from the current window.
 */
export function checkRateLimit(key: string, now: number = Date.now()): boolean {
	// Opportunistic cleanup when the map grows large.
	if (buckets.size > MAX_KEYS) {
		for (const [k, w] of buckets) {
			if (w.resetAt <= now) {
				buckets.delete(k);
			}
		}
	}

	const existing = buckets.get(key);
	if (!existing || existing.resetAt <= now) {
		buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
		return true;
	}
	if (existing.count >= MAX_PER_WINDOW) {
		return false;
	}
	existing.count += 1;
	return true;
}

/** Test-only: reset all windows. */
export function __resetRateLimiter() {
	buckets.clear();
}

export const RATE_LIMIT = { WINDOW_MS, MAX_PER_WINDOW } as const;

/** Max simultaneous active (pending) bookings per zalo_phone (spec §6). */
export const MAX_ACTIVE_PENDING = 3;

/** Max simultaneous active reservations (held-not-expired + pending) per phone/IP. */
export const MAX_ACTIVE_RESERVATIONS = 3;
