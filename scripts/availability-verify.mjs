// Focused live check: does public_availability correctly reflect a pending
// booking (occupied) and its release on reject (free)? Uses row counts for the
// court+date instead of fragile UTC/ICT time-string matching. Run:
//   bun scripts/availability-verify.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const log = (ok, name, detail = "") => {
	console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
	ok ? pass++ : fail++;
};

const { data: courts } = await svc.from("court").select("*").eq("is_active", true).limit(1);
const court = courts[0];
const probeDate = "2026-06-22";

async function anonRowCount() {
	const { data } = await anon
		.from("public_availability")
		.select("time_range")
		.eq("court_id", court.id)
		.eq("slot_date", probeDate);
	return (data ?? []).length;
}

// Clean any leftovers on the probe date first.
{
	const { data: occ } = await svc
		.from("booking_occurrence")
		.select("booking_id")
		.eq("court_id", court.id)
		.eq("slot_date", probeDate);
	const ids = [...new Set((occ ?? []).map((o) => o.booking_id))];
	if (ids.length) await svc.from("booking").delete().in("id", ids);
}

const before = await anonRowCount();
log(before === 0, "baseline: probe date is empty for anon", `rows: ${before}`);

const { data: created, error: cErr } = await svc.rpc("create_pending_booking", {
	p_court_id: court.id,
	p_type: "adhoc",
	p_customer_name: "AVAIL_E2E",
	p_zalo_phone: "0900000000",
	p_group_size: 1,
	p_start_time: "09:00",
	p_block_count: 2,
	p_date: probeDate,
});
if (cErr) throw new Error(cErr.message);
const ref = created[0].reference;
const { data: row } = await svc.from("booking").select("id").eq("reference", ref).single();

const afterCreate = await anonRowCount();
log(
	afterCreate === before + 1,
	"PENDING booking is visible as occupied to anon",
	`rows: ${afterCreate}`,
);

await svc
	.from("booking")
	.update({ status: "rejected", reject_reason: "avail-e2e" })
	.eq("id", row.id);
const afterReject = await anonRowCount();
log(
	afterReject === before,
	"REJECT frees the slot — anon no longer sees it (trigger)",
	`rows: ${afterReject}`,
);

await svc.from("booking").delete().eq("id", row.id);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
