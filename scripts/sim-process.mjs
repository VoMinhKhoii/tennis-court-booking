// Broader simulation — Phase C/D: owner works the queue, then reconcile.
// Uses an OWNER-AUTHENTICATED session (anon key + login) so it exercises the
// exact RLS path the server actions use (lib/actions/owner.ts). Run after
// sim-week.mjs. Run: bun scripts/sim-process.mjs
import { createClient } from "@supabase/supabase-js";
import { computeAmountVnd } from "../lib/booking/pricing.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const owner = createClient(url, anonKey, { auth: { persistSession: false } });
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });

let pass = 0,
	fail = 0;
const log = (ok, name, detail = "") => {
	console.log(`${ok ? "✅" : "❌"} ${name}${detail ? `  — ${detail}` : ""}`);
	ok ? pass++ : fail++;
};
const section = (t) => console.log(`\n=== ${t} ===`);

// Mirror confirmBooking / rejectBooking exactly (status-guarded update).
async function ownerConfirm(id) {
	return owner
		.from("booking")
		.update({ status: "confirmed", confirmed_at: new Date().toISOString() })
		.eq("id", id)
		.eq("status", "pending")
		.select("id")
		.maybeSingle();
}
async function ownerReject(id, reason) {
	return owner
		.from("booking")
		.update({ status: "rejected", reject_reason: reason ?? null })
		.eq("id", id)
		.eq("status", "pending")
		.select("id")
		.maybeSingle();
}

function durationBlocks(timeRange) {
	const inner = timeRange.replace(/^[[(]/, "").replace(/[\])]$/, "");
	const [lo, hi] = inner.split(",").map(
		(s) =>
			new Date(
				s
					.trim()
					.replace(/^["']|["']$/g, "")
					.replace(" ", "T")
					.replace(/([+-]\d{2})$/, "$1:00"),
			),
	);
	return Math.round((hi - lo) / 60000 / 30);
}

try {
	section("Owner session");
	const { error: authErr } = await owner.auth.signInWithPassword({
		email: "owner@tenniscourt.vn",
		password: "mkhoi.1909",
	});
	log(!authErr, "owner login", authErr?.message);
	const { data: isOwner } = await owner.rpc("is_owner");
	log(isOwner === true, "is_owner() true");

	// ---- Phase C: work the queue (oldest first, like the dashboard) ----
	section("Phase C — process the pending queue");
	const { data: queue } = await owner
		.from("booking")
		.select("id,reference,status")
		.eq("status", "pending")
		.like("customer_name", "SIM_%")
		.order("created_at", { ascending: true });
	log((queue?.length ?? 0) > 0, `queue fetched via owner RLS read`, `${queue?.length} pending`);

	const decided = { confirmed: [], rejected: [], left: [] };
	for (let i = 0; i < queue.length; i++) {
		const b = queue[i];
		const bucket = i % 10;
		if (bucket <= 6) {
			const { data } = await ownerConfirm(b.id);
			if (data) decided.confirmed.push(b);
		} else if (bucket <= 8) {
			const { data } = await ownerReject(b.id, "sim: not paid in time");
			if (data) decided.rejected.push(b);
		} else decided.left.push(b);
	}
	log(
		true,
		`decisions`,
		`confirmed=${decided.confirmed.length} rejected=${decided.rejected.length} left=${decided.left.length}`,
	);

	// ---- Reconciliation ----
	section("Reconciliation");
	// counts via owner reads (dashboard query parity)
	const { count: pendingNow } = await owner
		.from("booking")
		.select("id", { count: "exact", head: true })
		.eq("status", "pending")
		.like("customer_name", "SIM_%");
	const { count: confirmedNow } = await owner
		.from("booking")
		.select("id", { count: "exact", head: true })
		.eq("status", "confirmed")
		.like("customer_name", "SIM_%");
	const { count: rejectedNow } = await owner
		.from("booking")
		.select("id", { count: "exact", head: true })
		.eq("status", "rejected")
		.like("customer_name", "SIM_%");
	log(
		pendingNow === decided.left.length,
		`pending count matches decisions (dashboard parity)`,
		`${pendingNow}`,
	);
	// confirmedNow includes BMM3KA69 + GDPNQTZ9 (manual) from the UI pass; just assert >= decided.confirmed
	log(
		confirmedNow >= decided.confirmed.length,
		`confirmed count >= confirmed decisions`,
		`${confirmedNow}`,
	);
	log(
		rejectedNow >= decided.rejected.length,
		`rejected count >= rejected decisions`,
		`${rejectedNow}`,
	);

	// occurrence mirroring: sample confirmed + rejected
	const sampleC = decided.confirmed[0];
	const sampleR = decided.rejected[0];
	if (sampleC) {
		const { data: occ } = await svc
			.from("booking_occurrence")
			.select("status")
			.eq("booking_id", sampleC.id);
		log(
			occ.length > 0 && occ.every((o) => o.status === "confirmed"),
			`confirmed booking occurrences mirrored -> confirmed`,
			occ.map((o) => o.status).join(","),
		);
	}
	if (sampleR) {
		const { data: occ } = await svc
			.from("booking_occurrence")
			.select("status,court_id,time_range,slot_date")
			.eq("booking_id", sampleR.id);
		log(
			occ.length > 0 && occ.every((o) => o.status === "rejected"),
			`rejected booking occurrences mirrored -> rejected`,
			occ.map((o) => o.status).join(","),
		);
		// freed slot is free + re-bookable
		const s = occ[0];
		const { data: av } = await svc
			.from("public_availability")
			.select("*")
			.eq("court_id", s.court_id)
			.eq("slot_date", s.slot_date);
		const occupied = (av ?? []).some((r) => r.time_range === s.time_range);
		log(!occupied, `rejected slot freed in public_availability`);
	}

	// status guard: confirming an already-rejected booking is a no-op
	if (sampleR) {
		const { data } = await ownerConfirm(sampleR.id);
		log(data === null, `status guard: cannot confirm a rejected booking (no-op)`);
	}
	// status guard: rejecting an already-confirmed booking is a no-op
	if (sampleC) {
		const { data } = await ownerReject(sampleC.id, "x");
		log(data === null, `status guard: cannot reject a confirmed booking (no-op)`);
	}

	// global overlap invariant across ALL courts
	const { data: active } = await svc
		.from("booking_occurrence")
		.select("court_id,time_range,status,booking:booking_id(customer_name)")
		.in("status", ["pending", "confirmed"]);
	const sim = (active ?? []).filter((o) => o.booking?.customer_name?.startsWith("SIM_"));
	const seen = new Set();
	let dup = 0;
	for (const o of sim) {
		const k = `${o.court_id}|${o.time_range}`;
		if (seen.has(k)) dup++;
		seen.add(k);
	}
	log(
		dup === 0,
		`global invariant: no overlapping active occurrences across all courts`,
		`${sim.length} active, ${dup} dups`,
	);

	// pricing spot-check on 5 confirmed bookings
	const { data: rate } = await svc
		.from("settings")
		.select("flat_hourly_rate_vnd")
		.eq("id", 1)
		.single();
	let priceOk = 0,
		priceTot = 0;
	for (const b of decided.confirmed.slice(0, 5)) {
		const { data: full } = await svc
			.from("booking")
			.select("amount_vnd,occ:booking_occurrence(time_range)")
			.eq("id", b.id)
			.single();
		const blocks = durationBlocks(full.occ[0].time_range);
		const expected = computeAmountVnd(rate.flat_hourly_rate_vnd, blocks, full.occ.length);
		priceTot++;
		if (Number(full.amount_vnd) === expected) priceOk++;
	}
	log(
		priceOk === priceTot,
		`pricing spot-check on ${priceTot} confirmed bookings`,
		`${priceOk}/${priceTot} match`,
	);

	// ---- Phase D: settings -> pricing impact (rate change, then restore) ----
	section("Phase D — settings change affects new-booking pricing");
	const original = rate.flat_hourly_rate_vnd;
	const NEW = 250000;
	await owner.from("settings").update({ flat_hourly_rate_vnd: NEW }).eq("id", 1);
	const { data: rb } = await svc.rpc("create_pending_booking", {
		p_type: "adhoc",
		p_customer_name: "SIM_RATE_TEST",
		p_zalo_phone: "0991100000",
		p_group_size: 1,
		p_start_time: "06:00",
		p_block_count: 2,
		p_month: null,
		p_weekdays: null,
		p_date: "2027-12-15",
		p_preferred_court_id: null,
		p_force_court: false,
	});
	const got = Number(rb?.[0]?.amount_vnd);
	log(
		got === computeAmountVnd(NEW, 2, 1),
		`new booking uses updated rate ${NEW}`,
		`amount=${got} (expected ${computeAmountVnd(NEW, 2, 1)})`,
	);
	await svc.from("booking").delete().eq("customer_name", "SIM_RATE_TEST");
	await owner.from("settings").update({ flat_hourly_rate_vnd: original }).eq("id", 1);
	const { data: restored } = await svc
		.from("settings")
		.select("flat_hourly_rate_vnd")
		.eq("id", 1)
		.single();
	log(restored.flat_hourly_rate_vnd === original, `rate restored to ${original}`);
} catch (e) {
	log(false, "harness crashed", e.message);
} finally {
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail > 0 ? 1 : 0);
}
