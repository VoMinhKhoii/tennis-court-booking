import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The test process loads .env.local via playwright.config; load defensively too
// so the helper works when imported standalone.
try {
	process.loadEnvFile(".env.local");
} catch {
	/* already loaded / injected */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** All e2e rows carry this name prefix so cleanup is reliable and never touches real data. */
export const E2E_PREFIX = "E2E_";
/** Far-future date — well clear of any real booking. */
export const E2E_DATE = "2027-12-15";
/** A second far-future date for tests that need an independent slot. */
export const E2E_DATE_ALT = "2027-12-16";

/** Service-role client (server-side power) for seeding + teardown. */
export function admin(): SupabaseClient {
	if (!url || !serviceKey) {
		throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
	}
	return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** A unique E2E_ customer name (cleanup target). */
export function e2eName(tag = ""): string {
	return `${E2E_PREFIX}${tag}_${Date.now().toString(36)}`;
}

/** Delete every e2e booking (occurrences cascade). Run in afterEach/afterAll. */
export async function cleanup(): Promise<void> {
	await admin().from("booking").delete().like("customer_name", `${E2E_PREFIX}%`);
}

export async function getBookingByRef(reference: string) {
	const { data } = await admin()
		.from("booking")
		.select("status, hold_expires_at, customer_name")
		.eq("reference", reference)
		.maybeSingle();
	return data;
}

/** Push a hold's expiry into the past so the next read treats it as expired. */
export async function forceExpire(reference: string): Promise<void> {
	await admin()
		.from("booking")
		.update({ hold_expires_at: new Date(Date.now() - 60_000).toISOString() })
		.eq("reference", reference);
}

async function activeCourtIds(): Promise<string[]> {
	const { data } = await admin().from("court").select("id").eq("is_active", true);
	return (data ?? []).map((c) => c.id as string);
}

/**
 * Block a slot on EVERY active court (confirmed) so a customer booking that exact
 * slot hits `no_court_available` — the conflict path at checkout.
 */
export async function seedAllCourtsConfirmed(args: {
	date: string;
	startTime: string;
	blockCount: number;
}): Promise<void> {
	const a = admin();
	for (const courtId of await activeCourtIds()) {
		const { data, error } = await a.rpc("create_pending_booking", {
			p_type: "adhoc",
			p_customer_name: e2eName("seed"),
			p_zalo_phone: "0990000000",
			p_group_size: 1,
			p_start_time: args.startTime,
			p_block_count: args.blockCount,
			p_month: null,
			p_weekdays: null,
			p_date: args.date,
			p_preferred_court_id: courtId,
			p_force_court: true,
			p_hold_minutes: null,
		});
		if (error) throw error;
		const row = Array.isArray(data) ? data[0] : data;
		await a.from("booking").update({ status: "confirmed" }).eq("reference", row.reference);
	}
}
