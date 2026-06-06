// Owner-side live E2E against the linked cloud Supabase project.
// Creates the owner (admin API), sets settings.owner_uid, then verifies the
// owner RLS path: login, is_owner(), confirm a booking, reject-frees-slot, and
// non-owner denial. Leaves the owner user in place; cleans up test data + the
// throwaway non-owner. Run: bun scripts/owner-verify.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const log = (ok, name, detail = "") => {
	console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
	ok ? pass++ : fail++;
};

const OWNER_EMAIL = "owner@tenniscourt.vn";
const NONOWNER_EMAIL = "verify-nonowner@tenniscourt.vn";
const ownerPw = `Ten!${crypto.randomUUID().slice(0, 14)}`;
const nonPw = `Non!${crypto.randomUUID().slice(0, 14)}`;

async function ensureUser(email, password) {
	const { data: list } = await svc.auth.admin.listUsers();
	const existing = list?.users.find((u) => u.email === email);
	if (existing) {
		await svc.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
		return existing.id;
	}
	const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
	if (error) throw new Error(`createUser ${email}: ${error.message}`);
	return data.user.id;
}

// --- Create owner + non-owner, wire owner_uid ---
const ownerId = await ensureUser(OWNER_EMAIL, ownerPw);
log(Boolean(ownerId), "owner user created/confirmed (admin API)", OWNER_EMAIL);
const nonId = await ensureUser(NONOWNER_EMAIL, nonPw);

const { error: setErr } = await svc.from("settings").update({ owner_uid: ownerId }).eq("id", 1);
log(!setErr, "settings.owner_uid set to owner", setErr ? setErr.message : ownerId);

// --- Owner session ---
const owner = createClient(url, anonKey, { auth: { persistSession: false } });
const { error: loginErr } = await owner.auth.signInWithPassword({
	email: OWNER_EMAIL,
	password: ownerPw,
});
log(!loginErr, "owner can log in (signInWithPassword)", loginErr ? loginErr.message : "session ok");

const { data: isOwner, error: ioErr } = await owner.rpc("is_owner");
log(
	isOwner === true && !ioErr,
	"is_owner() true for owner",
	ioErr ? ioErr.message : String(isOwner),
);

const { data: ownSettings, error: osErr } = await owner
	.from("settings")
	.select("flat_hourly_rate_vnd")
	.eq("id", 1)
	.maybeSingle();
log(
	!osErr && Boolean(ownSettings),
	"owner CAN read settings base table (RLS)",
	osErr ? osErr.message : "ok",
);

// --- Non-owner denial ---
const non = createClient(url, anonKey, { auth: { persistSession: false } });
await non.auth.signInWithPassword({ email: NONOWNER_EMAIL, password: nonPw });
const { data: nonIsOwner } = await non.rpc("is_owner");
log(nonIsOwner === false, "is_owner() false for non-owner", String(nonIsOwner));
const { data: nonBooking } = await non.from("booking").select("id").limit(1);
log(
	(nonBooking ?? []).length === 0,
	"non-owner CANNOT read booking (RLS)",
	`rows: ${(nonBooking ?? []).length}`,
);
const { data: nonUpd } = await non
	.from("settings")
	.update({ flat_hourly_rate_vnd: 1 })
	.eq("id", 1)
	.select();
log(
	(nonUpd ?? []).length === 0,
	"non-owner CANNOT update settings (RLS)",
	`updated: ${(nonUpd ?? []).length}`,
);

// --- Confirm + reject-frees-slot E2E ---
const { data: courts } = await svc.from("court").select("*").eq("is_active", true).limit(1);
const court = courts[0];
const probeDate = "2026-06-21";
const refs = [];
async function makePending(start) {
	const { data, error } = await svc.rpc("create_pending_booking", {
		p_court_id: court.id,
		p_type: "adhoc",
		p_customer_name: "OWNER_E2E",
		p_zalo_phone: "0900000000",
		p_group_size: 1,
		p_start_time: start,
		p_block_count: 2,
		p_date: probeDate,
	});
	if (error) throw new Error(`makePending: ${error.message}`);
	refs.push(data[0].reference);
	const { data: row } = await svc
		.from("booking")
		.select("id")
		.eq("reference", data[0].reference)
		.single();
	return row.id;
}

// Confirm path
const p1 = await makePending("07:00");
const { data: confRows, error: confErr } = await owner
	.from("booking")
	.update({ status: "confirmed", confirmed_at: new Date().toISOString() })
	.eq("id", p1)
	.eq("status", "pending")
	.select();
log(
	!confErr && (confRows ?? []).length === 1,
	"owner CAN confirm a pending booking (guarded)",
	confErr ? confErr.message : `updated ${(confRows ?? []).length}`,
);
{
	const { data: occ } = await svc.from("booking_occurrence").select("status").eq("booking_id", p1);
	log(
		(occ ?? []).every((o) => o.status === "confirmed"),
		"confirm trigger locked occurrences",
		JSON.stringify((occ ?? []).map((o) => o.status)),
	);
}

// Reject path (slot-visibility after reject is covered by availability-verify.mjs)
const p2 = await makePending("09:00");
const { error: rejErr } = await owner
	.from("booking")
	.update({ status: "rejected", reject_reason: "e2e" })
	.eq("id", p2)
	.eq("status", "pending");
log(!rejErr, "owner CAN reject a pending booking", rejErr ? rejErr.message : "ok");
{
	const { data: occ } = await svc.from("booking_occurrence").select("status").eq("booking_id", p2);
	log(
		(occ ?? []).every((o) => o.status === "rejected"),
		"reject trigger freed occurrences",
		JSON.stringify((occ ?? []).map((o) => o.status)),
	);
}

// --- cleanup (keep owner user + owner_uid) ---
await svc.from("booking").delete().in("reference", refs);
await svc.auth.admin.deleteUser(nonId);
log(true, "cleanup: removed E2E bookings + throwaway non-owner user");

console.log(`\n${pass} passed, ${fail} failed`);
console.log(
	`\nOWNER LOGIN (rotate this in the dashboard):\n  email:    ${OWNER_EMAIL}\n  password: ${ownerPw}`,
);
process.exit(fail > 0 ? 1 : 0);
