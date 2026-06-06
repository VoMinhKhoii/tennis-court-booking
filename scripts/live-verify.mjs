// Live verification against the linked cloud Supabase project.
// Run: bun scripts/live-verify.mjs   (bun auto-loads .env.local)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
	console.error("Missing env (need NEXT_PUBLIC_SUPABASE_URL/ANON_KEY + SUPABASE_SERVICE_ROLE_KEY)");
	process.exit(2);
}
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const log = (ok, name, detail = "") => {
	console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
	ok ? pass++ : fail++;
};

// --- Seed state ---
const { data: courts } = await svc.from("court").select("*").order("created_at");
const active = (courts ?? []).filter((c) => c.is_active);
log(
	active.length > 0,
	"seed: at least one active court",
	`${(courts ?? []).length} court(s), ${active.length} active`,
);
const { data: settingsRows } = await svc.from("settings").select("*");
const settings = settingsRows?.[0];
log(Boolean(settings), "seed: settings row exists");
log(
	Boolean(settings?.owner_uid),
	"seed: settings.owner_uid set (dashboard login needs this)",
	settings?.owner_uid ? "set" : "NULL — login will fail",
);
log(
	Boolean(settings?.flat_hourly_rate_vnd),
	"seed: flat_hourly_rate_vnd set",
	String(settings?.flat_hourly_rate_vnd ?? "NULL"),
);

const court = active[0];
if (!court) {
	console.log("\nNo active court — cannot run booking probes. Stopping.");
	process.exit(fail > 0 ? 1 : 0);
}

// --- anon read posture ---
{
	const { data, error } = await anon.from("court").select("id").limit(1);
	log(
		(data ?? []).length === 0 || Boolean(error),
		"anon CANNOT read court base table",
		error ? `err: ${error.code}` : `rows: ${(data ?? []).length}`,
	);
}
{
	const { data, error } = await anon.from("settings").select("flat_hourly_rate_vnd").limit(1);
	log(
		(data ?? []).length === 0 || Boolean(error),
		"anon CANNOT read settings base table",
		error ? `err: ${error.code}` : `rows: ${(data ?? []).length}`,
	);
}
{
	const { data, error } = await anon.from("public_availability").select("*").limit(1);
	log(
		!error,
		"anon CAN read public_availability view",
		error ? `err: ${error.message}` : `ok (${(data ?? []).length} rows)`,
	);
}
// The public surfaces NEED these — do they exist for anon yet?
{
	const { data, error } = await anon.from("public_courts").select("*").limit(1);
	log(
		!error,
		"anon CAN read public_courts (NEW — public pages need it)",
		error ? `MISSING: ${error.message}` : `ok (${(data ?? []).length} rows)`,
	);
}
{
	const { data, error } = await anon.from("public_settings").select("*").limit(1);
	log(
		!error,
		"anon CAN read public_settings (NEW — form price preview needs it)",
		error ? `MISSING: ${error.message}` : `ok (${(data ?? []).length} rows)`,
	);
}
// anon must NOT be able to call the create function directly
{
	const { error } = await anon.rpc("create_pending_booking", {
		p_court_id: court.id,
		p_type: "adhoc",
		p_customer_name: "x",
		p_zalo_phone: "0900000000",
		p_group_size: 1,
		p_start_time: court.open_time,
		p_block_count: 2,
		p_date: "2026-06-20",
	});
	log(
		Boolean(error),
		"anon CANNOT execute create_pending_booking",
		error ? `denied: ${error.code ?? error.message}` : "EXECUTED (bad!)",
	);
}

// --- service write path: double-booking + adjacency on the real DB ---
const probeDate = "2026-06-20";
const openMin = Number(court.open_time.slice(0, 2)) * 60 + Number(court.open_time.slice(3, 5));
const hhmm = (m) =>
	`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const slotA = hhmm(openMin); // [open, open+1h)
const slotB = hhmm(openMin + 60); // [open+1h, open+2h)  adjacent to A

const createdRefs = [];
async function book(start) {
	const { data, error } = await svc.rpc("create_pending_booking", {
		p_court_id: court.id,
		p_type: "adhoc",
		p_customer_name: "VERIFY_SMOKE",
		p_zalo_phone: "0900000000",
		p_group_size: 1,
		p_start_time: start,
		p_block_count: 2,
		p_date: probeDate,
	});
	if (!error && data?.[0]?.reference) createdRefs.push(data[0].reference);
	return { data: data?.[0], error };
}
{
	const r1 = await book(slotA);
	log(
		!r1.error && Boolean(r1.data?.reference),
		"service create_pending_booking succeeds (adhoc)",
		r1.error
			? r1.error.message
			: `ref ${r1.data?.reference}, amount ${r1.data?.amount_vnd}, occ ${r1.data?.occurrences}`,
	);
	const r2 = await book(slotA);
	log(
		Boolean(r2.error),
		"DOUBLE-BOOK rejected on same slot (exclusion constraint)",
		r2.error ? `blocked: ${r2.error.code ?? r2.error.message}` : "SECOND BOOKING SUCCEEDED (bad!)",
	);
	const r3 = await book(slotB);
	log(
		!r3.error && Boolean(r3.data?.reference),
		"ADJACENT slot [+1h) succeeds (half-open ranges)",
		r3.error ? r3.error.message : `ref ${r3.data?.reference}`,
	);
}

// --- cleanup ---
if (createdRefs.length) {
	const { error } = await svc.from("booking").delete().in("reference", createdRefs);
	log(
		!error,
		`cleanup: removed ${createdRefs.length} smoke booking(s)`,
		error ? error.message : "ok (occurrences cascade)",
	);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
