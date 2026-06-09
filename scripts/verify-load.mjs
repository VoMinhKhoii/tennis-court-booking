// Load & performance verification against the linked cloud Supabase.
// Measures availability read latency, RPC throughput under concurrency,
// same-slot contention cost, auto-court scan cost vs table size, and realtime
// broadcast latency. Run: bun scripts/verify-load.mjs
//
// All data is namespaced (VERIFY_LOAD / far-future dates) and cleaned up.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
	console.error("Missing env");
	process.exit(2);
}
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const section = (t) => console.log(`\n=== ${t} ===`);
const NAME = "VERIFY_LOAD";

function pct(arr, q) {
	if (!arr.length) return 0;
	const s = [...arr].sort((a, b) => a - b);
	return Math.round(s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]);
}
const stat = (ms) =>
	`p50=${pct(ms, 0.5)}ms p95=${pct(ms, 0.95)}ms p99=${pct(ms, 0.99)}ms max=${Math.round(Math.max(...ms))}ms`;

async function timed(fn) {
	const t0 = performance.now();
	const r = await fn();
	return { ms: performance.now() - t0, r };
}

// Unique non-overlapping slot from an index: spread across days, 15 1h slots/day.
function slotFor(i, baseDay = "2027-07-01") {
	const day = new Date(`${baseDay}T00:00:00Z`);
	day.setUTCDate(day.getUTCDate() + Math.floor(i / 15));
	const date = day.toISOString().slice(0, 10);
	const start = `${String(6 + (i % 15)).padStart(2, "0")}:00`;
	return { date, start };
}

async function bookAt(date, start, who = 0) {
	return svc.rpc("create_pending_booking", {
		p_type: "adhoc",
		p_customer_name: `${NAME}_${who}`,
		p_zalo_phone: "0990007000",
		p_group_size: 1,
		p_start_time: start,
		p_block_count: 2,
		p_month: null,
		p_weekdays: null,
		p_date: date,
		p_preferred_court_id: null,
		p_force_court: false,
	});
}
async function cleanup() {
	await svc.from("booking").delete().like("customer_name", `${NAME}%`);
}

// Limited-concurrency map.
async function pool(items, limit, fn) {
	const out = [];
	let idx = 0;
	const workers = Array.from({ length: limit }, async () => {
		while (idx < items.length) {
			const i = idx++;
			out[i] = await fn(items[i], i);
		}
	});
	await Promise.all(workers);
	return out;
}

try {
	await cleanup();
	const { data: court } = await svc
		.from("court")
		.select("id")
		.eq("is_active", true)
		.limit(1)
		.single();

	// ---- 1. Availability read latency (anon, the hot public read) ----
	section("1. Availability read latency (anon public_availability, month window)");
	{
		const read = () =>
			anon
				.from("public_availability")
				.select("*")
				.gte("slot_date", "2027-07-01")
				.lte("slot_date", "2027-07-31");
		// warm
		await read();
		const seq = [];
		for (let i = 0; i < 20; i++) seq.push((await timed(read)).ms);
		console.log(`  sequential (20):  ${stat(seq)}`);
		const conc = (await Promise.all(Array.from({ length: 20 }, () => timed(read)))).map(
			(x) => x.ms,
		);
		console.log(`  concurrent (20):  ${stat(conc)}`);
	}

	// ---- 2. RPC throughput ramp (distinct non-overlapping slots) ----
	section("2. RPC write throughput ramp (distinct slots, no contention)");
	for (const C of [1, 5, 10, 25]) {
		await cleanup();
		const items = Array.from({ length: C }, (_, i) => i);
		const t0 = performance.now();
		const results = await pool(items, C, async (i) => {
			const { date, start } = slotFor(i);
			return timed(() => bookAt(date, start, i));
		});
		const wall = performance.now() - t0;
		const ms = results.map((x) => x.ms);
		const okCount = results.filter((x) => !x.r.error).length;
		const tput = (okCount / (wall / 1000)).toFixed(1);
		console.log(
			`  C=${String(C).padStart(2)}: ${okCount}/${C} ok, wall=${Math.round(wall)}ms, ~${tput} bookings/s, ${stat(ms)}`,
		);
	}

	// ---- 3. Same-slot contention cost (losers must fail fast & clean) ----
	section("3. Same-slot contention cost (25 concurrent, 1 winner)");
	{
		await cleanup();
		const date = "2027-08-01";
		const results = await Promise.all(
			Array.from({ length: 25 }, (_, i) => timed(() => bookAt(date, "06:00", i))),
		);
		const wins = results.filter((x) => !x.r.error).length;
		const winMs = results.filter((x) => !x.r.error).map((x) => x.ms);
		const loseMs = results.filter((x) => x.r.error).map((x) => x.ms);
		console.log(`  winners=${wins} (expect 1)`);
		console.log(`  winner latency:  ${stat(winMs)}`);
		console.log(`  loser  latency:  ${stat(loseMs)}  (should be fast, no deadlock)`);
	}

	// ---- 4. Auto-court scan cost vs table size (index effectiveness) ----
	section("4. Auto-court scan cost vs table size");
	{
		await cleanup();
		// baseline: single booking latency on a near-empty table
		const base = await timed(() => bookAt("2027-09-01", "06:00", 0));
		console.log(`  table≈1:   single-booking latency = ${Math.round(base.ms)}ms`);

		// seed ~120 occurrences across distinct slots/days
		const SEED = 120;
		await pool(
			Array.from({ length: SEED }, (_, i) => i + 10),
			12,
			async (i) => {
				const { date, start } = slotFor(i, "2027-10-01");
				return bookAt(date, start, i);
			},
		);
		const { count } = await svc
			.from("booking_occurrence")
			.select("id", { count: "exact", head: true });
		const after = await timed(() => bookAt("2027-09-02", "06:00", 999));
		console.log(`  table≈${count}: single-booking latency = ${Math.round(after.ms)}ms`);
		const ratio = (after.ms / base.ms).toFixed(2);
		console.log(
			`  latency ratio after/before = ${ratio}x  (flat ≈ index working; large growth = scan problem)`,
		);
	}

	// ---- 5. Realtime broadcast latency ----
	section("5. Realtime broadcast latency (book -> anon receives)");
	{
		await cleanup();
		const topic = `availability:court:${court.id}`;
		const channel = anon.channel(topic, { config: { broadcast: { self: true } } });
		const got = new Promise((resolve) => {
			channel.on("broadcast", { event: "INSERT" }, () => resolve(performance.now()));
		});
		await new Promise((resolve, reject) => {
			channel.subscribe((status) => {
				if (status === "SUBSCRIBED") resolve();
				if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
			});
			setTimeout(() => reject(new Error("subscribe timeout")), 8000);
		}).catch((e) => console.log(`  subscribe failed: ${e.message}`));

		const sentAt = performance.now();
		await bookAt("2027-11-01", "06:00", 0);
		const winner = await Promise.race([got, new Promise((r) => setTimeout(() => r(null), 8000))]);
		if (winner) console.log(`  broadcast received in ${Math.round(winner - sentAt)}ms`);
		else console.log("  broadcast NOT received within 8s (realtime not observed from node client)");
		await anon.removeChannel(channel);
	}
} catch (e) {
	console.log("harness crashed:", e.message);
} finally {
	await cleanup();
	console.log("\ncleanup done.");
	process.exit(0);
}
