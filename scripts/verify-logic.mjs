// Logic-correctness verification: cross-check the TypeScript oracles against the
// DB's authoritative output (pricing, multi-weekday enumeration, ICT/UTC time,
// status-mirror slot freeing, RLS posture). Run: bun scripts/verify-logic.mjs
import { createClient } from "@supabase/supabase-js";
import { enumerateSlotDatesMulti, ictToday } from "../lib/booking/dates.ts";
import { rangeIctBlockStarts, rangeStartIctMinutes, timeToMinutes } from "../lib/booking/grid.ts";
import { computeAmountVnd } from "../lib/booking/pricing.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
	console.error("Missing env");
	process.exit(2);
}
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const log = (ok, name, detail = "") => {
	console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
	ok ? pass++ : fail++;
};
const section = (t) => console.log(`\n=== ${t} ===`);

const NAME = "VERIFY_LOGIC";
const PHONE = "0990009000";

async function book({
	type = "adhoc",
	date = null,
	month = null,
	weekdays = null,
	start = "06:00",
	blocks = 2,
}) {
	const { data, error } = await svc.rpc("create_pending_booking", {
		p_type: type,
		p_customer_name: NAME,
		p_zalo_phone: PHONE,
		p_group_size: 1,
		p_start_time: start,
		p_block_count: blocks,
		p_month: month,
		p_weekdays: weekdays,
		p_date: date,
		p_preferred_court_id: null,
		p_force_court: false,
	});
	return { row: data?.[0], error };
}
async function cleanup() {
	await svc.from("booking").delete().like("customer_name", `${NAME}%`);
}

try {
	await cleanup();
	const { data: settings } = await svc
		.from("settings")
		.select("flat_hourly_rate_vnd")
		.eq("id", 1)
		.single();
	const rate = settings.flat_hourly_rate_vnd;

	// ---- Pricing: TS oracle vs DB amount_vnd ----
	section("Pricing — computeAmountVnd vs DB");
	for (const blocks of [1, 2, 3, 4]) {
		await cleanup();
		const { row, error } = await book({
			type: "adhoc",
			date: "2027-04-01",
			start: "06:00",
			blocks,
		});
		if (error) {
			log(false, `adhoc ${blocks} block(s)`, error.message);
			continue;
		}
		const expected = computeAmountVnd(rate, blocks, 1);
		log(
			Number(row.amount_vnd) === expected,
			`adhoc ${blocks} block(s): DB=${row.amount_vnd} oracle=${expected}`,
		);
	}

	// ---- Multi-weekday enumeration: TS oracle length vs DB occurrences ----
	section("Enumeration — enumerateSlotDatesMulti vs DB occurrences");
	const today = ictToday();
	const enumCases = [
		{ month: "2027-03", weekdays: [1] }, // single weekday, future month
		{ month: "2027-03", weekdays: [6] }, // a different weekday (likely different count)
		{ month: "2027-03", weekdays: [1, 3, 5] }, // T2/T4/T6 union
		{ month: "2026-06", weekdays: [1] }, // CURRENT month -> exercises mid-month flooring at today
	];
	for (const c of enumCases) {
		await cleanup();
		const oracle = enumerateSlotDatesMulti(`${c.month}-01`, c.weekdays, today);
		const { row, error } = await book({
			type: "monthly",
			month: `${c.month}-01`,
			weekdays: c.weekdays,
			start: "06:00",
			blocks: 2,
		});
		if (error) {
			log(false, `${c.month} wd=[${c.weekdays}]`, error.message);
			continue;
		}
		log(
			row.occurrences === oracle.length,
			`${c.month} wd=[${c.weekdays}]: DB occ=${row.occurrences} oracle=${oracle.length}`,
			`(today=${today})`,
		);
		// pricing for the monthly series should also match
		const expectedAmt = computeAmountVnd(rate, 2, oracle.length);
		log(
			Number(row.amount_vnd) === expectedAmt,
			`  └ series amount: DB=${row.amount_vnd} oracle=${expectedAmt}`,
		);
	}

	// ---- Timezone: ICT/UTC round-trip via public_availability view ----
	section("Timezone — ICT start round-trips through storage + view");
	for (const start of ["06:00", "20:00"]) {
		await cleanup();
		const date = "2027-04-05";
		const { error } = await book({ type: "adhoc", date, start, blocks: 2 });
		if (error) {
			log(false, `book ${start}`, error.message);
			continue;
		}
		const { data: rows } = await anon
			.from("public_availability")
			.select("slot_date,time_range,occupied")
			.eq("slot_date", date);
		const row = rows?.[0];
		if (!row) {
			log(false, `view exposes the ${start} occurrence`);
			continue;
		}
		log(
			rangeStartIctMinutes(row.time_range) === timeToMinutes(start),
			`${start}: view ICT start = ${start} (got min ${rangeStartIctMinutes(row.time_range)})`,
		);
		log(
			row.slot_date === date,
			`${start}: slot_date = ${date} (no UTC-midnight drift) (got ${row.slot_date})`,
		);
		log(
			rangeIctBlockStarts(row.time_range).length === 2,
			`${start}: spans 2 blocks (got ${rangeIctBlockStarts(row.time_range).length})`,
		);
		log(row.occupied === true, `${start}: view marks it occupied`);
	}

	// ---- Status mirror + slot freeing ----
	section("Status mirror — confirm locks, reject frees");
	await cleanup();
	{
		const date = "2027-04-10";
		const r1 = await book({ type: "adhoc", date, start: "06:00", blocks: 2 });
		log(!r1.error, "create pending booking", r1.error?.message);
		const ref = r1.row.reference;

		// occupied while pending
		let { data: av } = await anon.from("public_availability").select("*").eq("slot_date", date);
		log((av ?? []).length === 1, "pending booking is occupied in view", `${av?.length} row(s)`);

		// confirm -> occurrences mirror to confirmed, still occupied
		await svc
			.from("booking")
			.update({ status: "confirmed", confirmed_at: new Date().toISOString() })
			.eq("reference", ref);
		const { data: bk } = await svc.from("booking").select("id").eq("reference", ref).single();
		const { data: occ2 } = await svc
			.from("booking_occurrence")
			.select("status")
			.eq("booking_id", bk.id);
		log(
			(occ2 ?? []).every((o) => o.status === "confirmed"),
			"confirm mirrors occurrences -> confirmed",
			occ2?.map((o) => o.status).join(","),
		);
		({ data: av } = await anon.from("public_availability").select("*").eq("slot_date", date));
		log((av ?? []).length === 1, "confirmed booking still occupied in view");

		// a competing booking on the same slot must still be turned away
		const r2 = await book({ type: "adhoc", date, start: "06:00", blocks: 2 });
		log(
			Boolean(r2.error),
			"double-book on confirmed slot rejected",
			r2.error?.code ?? r2.error?.message,
		);

		// reject -> occurrences mirror to rejected, slot freed
		await svc
			.from("booking")
			.update({ status: "rejected", reject_reason: "verify" })
			.eq("reference", ref);
		const { data: occ3 } = await svc
			.from("booking_occurrence")
			.select("status")
			.eq("booking_id", bk.id);
		log(
			(occ3 ?? []).every((o) => o.status === "rejected"),
			"reject mirrors occurrences -> rejected",
			occ3?.map((o) => o.status).join(","),
		);
		({ data: av } = await anon.from("public_availability").select("*").eq("slot_date", date));
		log((av ?? []).length === 0, "rejected booking is freed in view", `${av?.length} row(s)`);

		// slot is reusable now
		const r3 = await book({ type: "adhoc", date, start: "06:00", blocks: 2 });
		log(!r3.error, "freed slot can be re-booked", r3.error?.message);
	}

	// ---- RLS posture (anon) ----
	section("RLS — anon posture");
	{
		const { data: c } = await anon.from("court").select("id").limit(1);
		log((c ?? []).length === 0, "anon cannot read court base table");
		const { data: s } = await anon.from("settings").select("id").limit(1);
		log((s ?? []).length === 0, "anon cannot read settings base table");
		const { error: rpcErr } = await anon.rpc("create_pending_booking", {
			p_type: "adhoc",
			p_customer_name: "x",
			p_zalo_phone: "x",
			p_group_size: 1,
			p_start_time: "06:00",
			p_block_count: 2,
			p_month: null,
			p_weekdays: null,
			p_date: "2027-04-20",
			p_preferred_court_id: null,
			p_force_court: false,
		});
		log(Boolean(rpcErr), "anon cannot execute create_pending_booking", rpcErr?.code);
		const { error: vErr } = await anon.from("public_courts").select("*").limit(1);
		log(!vErr, "anon can read public_courts view");
	}
} catch (e) {
	log(false, "harness crashed", e.message);
} finally {
	await cleanup();
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail > 0 ? 1 : 0);
}
