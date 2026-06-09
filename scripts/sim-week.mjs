// Broader simulation — Phase A: provision courts + generate a realistic week of
// public demand against the linked cloud Supabase. Leaves bookings PENDING for
// the owner dashboard pass + bulk processing. Run: bun scripts/sim-week.mjs
//
// Faithful to production: public bookings go through create_pending_booking via
// the service-role client (the exact path lib/actions/create-booking.ts uses).
// Owner court creation uses an owner-authenticated session (RLS path).
// All data namespaced SIM_ and on 2027 dates; cleaned up by sim-cleanup.mjs.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
const owner = createClient(url, anonKey, { auth: { persistSession: false } });

const log = (...a) => console.log(...a);
const SIM = "SIM_"; // customer_name + court name prefix

// ---- deterministic PRNG (no Math.random; reproducible) ----
let seed = 1337;
const rnd = () => {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff;
	return seed / 0x7fffffff;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;

const FIRST = [
	"An",
	"Bình",
	"Cường",
	"Dũng",
	"Hà",
	"Hương",
	"Khoa",
	"Linh",
	"Minh",
	"Nam",
	"Oanh",
	"Phúc",
	"Quân",
	"Sơn",
	"Trang",
	"Tú",
	"Vy",
	"Yến",
];
const LAST = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Vũ", "Đặng", "Bùi", "Đỗ"];
let phoneSeq = 0;
const nextPhone = () => `09911${String(1000 + phoneSeq++).padStart(5, "0")}`.slice(0, 10);
const custName = (i) => `${SIM}${pick(LAST)} ${pick(FIRST)} #${i}`;

// The simulated "week": Mon..Sun in 2027-06.
const WEEK = [
	"2027-06-07",
	"2027-06-08",
	"2027-06-09",
	"2027-06-10",
	"2027-06-11",
	"2027-06-12",
	"2027-06-13",
];
const EVENING = ["17:00", "18:00", "19:00", "20:00"]; // popular
const DAYTIME = ["06:00", "07:00", "09:00", "10:00", "14:00", "15:00", "16:00"];

async function bookPublic({
	type,
	name,
	phone,
	date = null,
	month = null,
	weekdays = null,
	start,
	blocks,
}) {
	const t0 = performance.now();
	const { data, error } = await svc.rpc("create_pending_booking", {
		p_type: type,
		p_customer_name: name,
		p_zalo_phone: phone,
		p_group_size: 1 + Math.floor(rnd() * 4),
		p_start_time: start,
		p_block_count: blocks,
		p_month: month,
		p_weekdays: weekdays,
		p_date: date,
		p_preferred_court_id: null,
		p_force_court: false,
	});
	return { ok: !error, row: data?.[0], error, ms: performance.now() - t0 };
}

async function cleanup() {
	await svc.from("booking").delete().like("customer_name", `${SIM}%`);
	await svc.from("court").delete().like("name", `${SIM}%`);
}

try {
	log("=== Phase A: setup + week of demand ===\n");
	await cleanup();

	// --- Owner login + provision 2 temp courts (RLS owner path) ---
	const { error: authErr } = await owner.auth.signInWithPassword({
		email: "owner@tenniscourt.vn",
		password: "mkhoi.1909",
	});
	log(authErr ? `owner login FAILED: ${authErr.message}` : "owner logged in");
	const { data: isOwner } = await owner.rpc("is_owner");
	log(`is_owner() => ${isOwner}`);

	for (const [name, open_time, close_time] of [
		[`${SIM}Court B`, "06:00", "22:00"],
		[`${SIM}Court C`, "08:00", "20:00"],
	]) {
		const { error } = await owner
			.from("court")
			.insert({ name, open_time, close_time, is_active: true })
			.select("id")
			.single();
		log(
			error
				? `create court ${name} FAILED: ${error.message}`
				: `owner created court: ${name} (${open_time}-${close_time})`,
		);
	}
	const { data: courts } = await svc
		.from("court")
		.select("id,name,open_time,close_time")
		.eq("is_active", true)
		.order("created_at");
	log(`active courts now: ${courts.map((c) => c.name).join(", ")}\n`);

	// --- Generate demand ---
	const outcomes = {
		adhocOk: 0,
		adhocConflict: 0,
		monthlyOk: 0,
		monthlyConflict: 0,
		occTotal: 0,
		byCourt: {},
	};
	const bump = (court) => {
		outcomes.byCourt[court] = (outcomes.byCourt[court] ?? 0) + 1;
	};
	let cust = 0;

	// 1) Popular evening slots: rush of concurrent requests (contention).
	log("-- evening rush (concurrent contention) --");
	for (const date of WEEK.slice(0, 5)) {
		// weekdays
		const start = pick(EVENING);
		const N = 4 + Math.floor(rnd() * 2); // 4-5 racers for the same slot
		const reqs = Array.from({ length: N }, () =>
			bookPublic({
				type: "adhoc",
				name: custName(cust++),
				phone: nextPhone(),
				date,
				start,
				blocks: 2,
			}),
		);
		const res = await Promise.all(reqs);
		const wins = res.filter((r) => r.ok);
		wins.forEach((w) => {
			bump(w.row.court_name);
		});
		outcomes.adhocOk += wins.length;
		outcomes.adhocConflict += res.length - wins.length;
		outcomes.occTotal += wins.reduce((s, w) => s + w.row.occurrences, 0);
		log(
			`  ${date} ${start}: ${wins.length} booked / ${res.length} tried (courts: ${wins.map((w) => w.row.court_name.replace(SIM, "")).join(",") || "-"})`,
		);
	}

	// 2) Scattered ad-hoc daytime demand (mostly non-conflicting).
	log("\n-- scattered daytime ad-hoc --");
	for (let i = 0; i < 24; i++) {
		const date = pick(WEEK);
		const start = pick(DAYTIME);
		const blocks = pick([2, 2, 3, 4]); // 1h, 1h, 1.5h, 2h
		const r = await bookPublic({
			type: "adhoc",
			name: custName(cust++),
			phone: nextPhone(),
			date,
			start,
			blocks,
		});
		if (r.ok) {
			outcomes.adhocOk++;
			bump(r.row.court_name);
			outcomes.occTotal += r.row.occurrences;
		} else outcomes.adhocConflict++;
	}
	log(`  ad-hoc so far: ${outcomes.adhocOk} ok, ${outcomes.adhocConflict} turned away`);

	// 3) Monthly regulars (recurring weekly series) for July 2027.
	log("\n-- monthly regulars (July 2027) --");
	for (let i = 0; i < 10; i++) {
		const weekday = 1 + Math.floor(rnd() * 6); // Mon..Sat
		const start = chance(0.5) ? pick(EVENING) : pick(DAYTIME);
		const blocks = pick([2, 3]);
		const r = await bookPublic({
			type: "monthly",
			name: custName(cust++),
			phone: nextPhone(),
			month: "2027-07-01",
			weekdays: [weekday],
			start,
			blocks,
		});
		if (r.ok) {
			outcomes.monthlyOk++;
			bump(r.row.court_name);
			outcomes.occTotal += r.row.occurrences;
			log(
				`  ${r.row.court_name.replace(SIM, "")}: wd=${weekday} ${start} -> ${r.row.occurrences} sessions, ${r.row.amount_vnd}₫`,
			);
		} else outcomes.monthlyConflict++;
	}

	// --- Summary ---
	const { count: pending } = await svc
		.from("booking")
		.select("id", { count: "exact", head: true })
		.eq("status", "pending")
		.like("customer_name", `${SIM}%`);
	const { count: occ } = await svc
		.from("booking_occurrence")
		.select("id", { count: "exact", head: true });
	log("\n=== Demand generated ===");
	log(
		`ad-hoc:   ${outcomes.adhocOk} booked, ${outcomes.adhocConflict} turned away (no court free)`,
	);
	log(`monthly:  ${outcomes.monthlyOk} booked, ${outcomes.monthlyConflict} turned away`);
	log(`bookings pending in queue: ${pending}`);
	log(`total occurrences in DB:   ${occ}`);
	log(`distribution by court:`, JSON.stringify(outcomes.byCourt));
	log("\nLeft PENDING for dashboard pass + bulk processing. Run sim-process.mjs next.");
} catch (e) {
	log("sim-week crashed:", e.message);
	process.exit(1);
}
