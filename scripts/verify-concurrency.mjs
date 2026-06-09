// Concurrency / race-condition verification against the linked cloud Supabase.
// Proves the GiST exclusion constraint + auto-court assignment hold under N
// simultaneous bookings ("10 users booking the same slot at once").
//
// Run: bun scripts/verify-concurrency.mjs
//
// Data hygiene: all test data uses customer_name prefix VERIFY_ and far-future
// dates (2027+). Temp courts are named "VERIFY_Court_*". Everything is removed
// in a finally block even on failure.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
	console.error("Missing env (need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
	process.exit(2);
}
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const log = (ok, name, detail = "") => {
	console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
	ok ? pass++ : fail++;
};
const section = (t) => console.log(`\n=== ${t} ===`);

const NAME = "VERIFY_CONC";
const phone = (i) => `0990001${String(i).padStart(3, "0")}`;

// One booking attempt via the CURRENT RPC signature.
async function book({
	date,
	start,
	blocks = 2,
	preferred = null,
	force = false,
	who = 0,
	type = "adhoc",
	month = null,
	weekdays = null,
}) {
	const t0 = performance.now();
	const { data, error } = await svc.rpc("create_pending_booking", {
		p_type: type,
		p_customer_name: `${NAME}_${who}`,
		p_zalo_phone: phone(who),
		p_group_size: 1,
		p_start_time: start,
		p_block_count: blocks,
		p_month: month,
		p_weekdays: weekdays,
		p_date: type === "adhoc" ? date : null,
		p_preferred_court_id: preferred,
		p_force_court: force,
	});
	const ms = performance.now() - t0;
	return { ok: !error, row: data?.[0], error, ms };
}

// A failure is "clean" if it is the exclusion constraint or an exhausted-courts
// domain error — NOT a deadlock / timeout / unexpected crash.
function isCleanLoss(err) {
	if (!err) return false;
	const code = err.code ?? "";
	const msg = err.message ?? "";
	if (code === "40P01") return false; // deadlock — would be a real defect
	return code === "23P01" || /no_court_available|no_overlap|overlap|exclusion|conflict/i.test(msg);
}

async function activeOccurrences() {
	const { data } = await svc
		.from("booking_occurrence")
		.select("court_id,time_range,status,booking:booking_id(customer_name)")
		.in("status", ["pending", "confirmed"]);
	return (data ?? []).filter((o) => o.booking?.customer_name?.startsWith(NAME));
}

async function orphanBookings() {
	// VERIFY_ bookings that have zero occurrences (would indicate a non-atomic insert).
	const { data } = await svc
		.from("booking")
		.select("id,reference,occ:booking_occurrence(id)")
		.like("customer_name", `${NAME}%`);
	return (data ?? []).filter((b) => (b.occ ?? []).length === 0);
}

async function cleanupBookings() {
	await svc.from("booking").delete().like("customer_name", `${NAME}%`);
}

async function createTempCourt(label) {
	const { data, error } = await svc
		.from("court")
		.insert({
			name: `VERIFY_Court_${label}`,
			open_time: "06:00",
			close_time: "21:00",
			is_active: true,
		})
		.select("id,name")
		.single();
	if (error) throw new Error(`temp court: ${error.message}`);
	return data;
}
async function deleteTempCourts() {
	await svc.from("court").delete().like("name", "VERIFY_Court_%");
}

// Count how many of a given weekday occur in a month (mirror enumerate logic
// loosely just to know the expected series length). weekday: 0=Sun..6=Sat.
function weekdayCountInMonth(year, month1to12, weekday) {
	let n = 0;
	const d = new Date(Date.UTC(year, month1to12 - 1, 1));
	while (d.getUTCMonth() === month1to12 - 1) {
		if (d.getUTCDay() === weekday) n++;
		d.setUTCDate(d.getUTCDate() + 1);
	}
	return n;
}

const summarize = (results) => {
	const wins = results.filter((r) => r.ok);
	const losses = results.filter((r) => !r.ok);
	const cleanLosses = losses.filter((r) => isCleanLoss(r.error));
	const dirty = losses.filter((r) => !isCleanLoss(r.error));
	const ms = results.map((r) => r.ms).sort((a, b) => a - b);
	const p = (q) =>
		ms.length ? Math.round(ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]) : 0;
	return {
		wins,
		losses,
		cleanLosses,
		dirty,
		lat: { p50: p(0.5), p95: p(0.95), max: Math.round(ms[ms.length - 1] ?? 0) },
	};
};

try {
	// Clean any leftovers from previous runs first.
	await cleanupBookings();
	await deleteTempCourts();

	const { data: courts } = await svc
		.from("court")
		.select("*")
		.eq("is_active", true)
		.order("created_at");
	log(
		(courts ?? []).length >= 1,
		"precondition: at least one active court",
		`${courts?.length} active`,
	);

	// ---- Scenario 1: same-slot stampede (the core proof) ----
	for (const N of [10, 25]) {
		section(`Scenario 1 — same-slot stampede, N=${N}`);
		await cleanupBookings();
		const date = "2027-03-01";
		const results = await Promise.all(
			Array.from({ length: N }, (_, i) => book({ date, start: "06:00", blocks: 2, who: i })),
		);
		const s = summarize(results);
		log(
			s.wins.length === 1,
			`exactly 1 winner (got ${s.wins.length})`,
			`latency p50=${s.lat.p50}ms p95=${s.lat.p95}ms max=${s.lat.max}ms`,
		);
		log(
			s.dirty.length === 0,
			`all ${s.losses.length} losers fail cleanly (no deadlock/crash)`,
			s.dirty.length
				? `dirty: ${s.dirty.map((d) => d.error?.code || d.error?.message).join(", ")}`
				: "ok",
		);
		const occ = await activeOccurrences();
		log(occ.length === 1, `DB holds exactly 1 active occupant of the slot (got ${occ.length})`);
		const orph = await orphanBookings();
		log(orph.length === 0, `no orphan booking rows (atomic insert) (got ${orph.length})`);
	}

	// ---- Scenario 2: distinct adjacent slots all succeed ----
	section("Scenario 2 — 10 concurrent DISTINCT adjacent 1h slots");
	await cleanupBookings();
	{
		const date = "2027-03-02";
		const N = 10; // 06:00..15:00 within 06:00-21:00
		const results = await Promise.all(
			Array.from({ length: N }, (_, i) =>
				book({ date, start: `${String(6 + i).padStart(2, "0")}:00`, blocks: 2, who: i }),
			),
		);
		const s = summarize(results);
		log(
			s.wins.length === N,
			`all ${N} adjacent slots booked (got ${s.wins.length})`,
			`p95=${s.lat.p95}ms`,
		);
		log(
			s.dirty.length === 0,
			"no unexpected errors",
			s.dirty.map((d) => d.error?.message).join(", "),
		);
		const occ = await activeOccurrences();
		log(occ.length === N, `DB holds ${N} active occurrences (got ${occ.length})`);
	}

	// ---- Scenario 3: auto-court distribution + capacity exhaustion ----
	section("Scenario 3 — auto-court distribution across 3 courts");
	await cleanupBookings();
	await createTempCourt("A");
	await createTempCourt("B");
	try {
		const { data: active3 } = await svc.from("court").select("id").eq("is_active", true);
		const courtCount = (active3 ?? []).length;
		log(courtCount >= 3, `precondition: ${courtCount} active courts (need >=3)`);
		const date = "2027-03-03";
		const N = 6; // > courtCount, so some must be turned away
		const results = await Promise.all(
			Array.from({ length: N }, (_, i) => book({ date, start: "06:00", blocks: 2, who: i })),
		);
		const s = summarize(results);
		const winnerCourts = new Set(s.wins.map((w) => w.row.court_id));
		log(s.wins.length === courtCount, `winners == court count (${s.wins.length}/${courtCount})`);
		log(
			winnerCourts.size === s.wins.length,
			`each winner got a DISTINCT court (${winnerCourts.size} distinct)`,
		);
		log(
			s.dirty.length === 0,
			`the ${s.losses.length} losers fail cleanly (no_court_available)`,
			s.dirty.map((d) => d.error?.code).join(","),
		);
		const occ = await activeOccurrences();
		log(
			occ.length === courtCount,
			`DB holds ${courtCount} active occurrences, one per court (got ${occ.length})`,
		);

		// ---- Scenario 4: monthly series contention (all-or-nothing) ----
		section("Scenario 4 — concurrent monthly series, atomic all-or-nothing");
		await cleanupBookings();
		const monthDate = "2027-03-01";
		const weekday = 1; // Monday
		const expectedLen = weekdayCountInMonth(2027, 3, weekday);
		const M = courtCount + 1; // one more than courts -> last must be turned away
		const monthlyResults = await Promise.all(
			Array.from({ length: M }, (_, i) =>
				book({
					type: "monthly",
					month: monthDate,
					weekdays: [weekday],
					start: "06:00",
					blocks: 2,
					who: i,
				}),
			),
		);
		const ms = summarize(monthlyResults);
		log(
			ms.wins.length === courtCount,
			`monthly winners == court count (${ms.wins.length}/${courtCount})`,
		);
		const allFullSeries = ms.wins.every((w) => w.row.occurrences === expectedLen);
		log(
			allFullSeries,
			`every winning series is COMPLETE (${expectedLen} occ each)`,
			ms.wins.map((w) => w.row.occurrences).join(","),
		);
		log(
			ms.dirty.length === 0,
			`loser turned away cleanly`,
			ms.dirty.map((d) => d.error?.code).join(","),
		);
		// No partial series: every VERIFY booking has either 0 (rolled back) or expectedLen occurrences.
		const { data: parents } = await svc
			.from("booking")
			.select("reference,occ:booking_occurrence(id)")
			.like("customer_name", `${NAME}%`);
		const partials = (parents ?? []).filter((b) => {
			const c = (b.occ ?? []).length;
			return c !== 0 && c !== expectedLen;
		});
		log(partials.length === 0, `NO partial series persisted (got ${partials.length})`);
		const occ4 = await activeOccurrences();
		log(
			occ4.length === courtCount * expectedLen,
			`DB occurrences == winners*${expectedLen} (got ${occ4.length})`,
		);

		// ---- Scenario 5: global overlap invariant ----
		section("Scenario 5 — global overlap invariant");
		const all = await activeOccurrences();
		const seen = new Map();
		let dup = 0;
		for (const o of all) {
			const key = `${o.court_id}|${o.time_range}`;
			if (seen.has(key)) dup++;
			seen.set(key, true);
		}
		log(dup === 0, `no two active occurrences share (court, exact range) (dups=${dup})`);
	} finally {
		await cleanupBookings();
		await deleteTempCourts();
	}
} catch (e) {
	log(false, "harness crashed", e.message);
} finally {
	await cleanupBookings();
	await deleteTempCourts();
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail > 0 ? 1 : 0);
}
