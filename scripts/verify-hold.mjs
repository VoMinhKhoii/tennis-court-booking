// Live verification of the TTL-hold lifecycle + concurrency against the linked
// cloud Supabase. Namespaced (VERIFY_HOLD), far-future 2027 dates, self-cleaning.
// Run: bun scripts/verify-hold.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const log = (ok, n, d = "") => { console.log(`${ok ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); ok ? pass++ : fail++; };
const NAME = "VERIFY_HOLD";

const hold = (date, start, who) => svc.rpc("create_pending_booking", {
  p_type: "adhoc", p_customer_name: `${NAME}_${who}`, p_zalo_phone: `09900${String(60000 + who).slice(-5)}`,
  p_group_size: 1, p_start_time: start, p_block_count: 2, p_month: null, p_weekdays: null,
  p_date: date, p_preferred_court_id: null, p_force_court: false, p_hold_minutes: 15,
});
const clean = () => svc.from("booking").delete().like("customer_name", `${NAME}%`);
const activeOcc = async () => {
  const { data } = await svc.from("booking_occurrence")
    .select("court_id,time_range,status,booking:booking_id(customer_name)").in("status", ["held", "pending", "confirmed"]);
  return (data ?? []).filter((o) => o.booking?.customer_name?.startsWith(NAME));
};

try {
  await clean();
  const { data: courts } = await svc.from("court").select("id").eq("is_active", true);
  const courtCount = courts.length;

  // 1. Concurrency: N simultaneous holds on the SAME slot -> exactly #courts win.
  const N = 12;
  const date = "2027-11-10";
  const res = await Promise.all(Array.from({ length: N }, (_, i) => hold(date, "06:00", i)));
  const wins = res.filter((r) => !r.error);
  const losers = res.filter((r) => r.error);
  log(wins.length === courtCount, `same-slot stampede: winners == court count (${wins.length}/${courtCount})`);
  log(losers.every((r) => /no_court_available|exclusion|overlap|23P01/i.test(r.error.message || r.error.code || "")),
    `all ${losers.length} losers fail cleanly`, losers[0]?.error?.message);
  log(new Set(wins.map((w) => w.data[0].court_id)).size === wins.length, "each winner on a distinct court");
  const occ1 = await activeOcc();
  log(occ1.length === courtCount && occ1.every((o) => o.status === "held"), `DB holds ${courtCount} held occurrences`);

  // 2. Finalize one winner -> pending; slot stays occupied.
  const ref = wins[0].data[0].reference;
  await svc.from("booking").update({ status: "pending", hold_expires_at: null }).eq("reference", ref);
  const { data: bk } = await svc.from("booking").select("id,status").eq("reference", ref).single();
  const { data: occ2 } = await svc.from("booking_occurrence").select("status").eq("booking_id", bk.id);
  log(bk.status === "pending" && occ2.every((o) => o.status === "pending"), "finalize: held -> pending (mirrored)");

  // 3. A dedicated hold on another slot: expire it + sweep -> frees; re-holdable.
  const date2 = "2027-11-11";
  const eRef = (await hold(date2, "07:00", 99)).data[0].reference;
  await svc.from("booking").update({ hold_expires_at: new Date(Date.now() - 60000).toISOString() }).eq("reference", eRef);
  const { data: avPre } = await anon.from("public_availability").select("*").eq("slot_date", date2);
  log((avPre ?? []).length === 0, "expired hold hidden by view immediately (now() filter)");
  await svc.rpc("expire_stale_holds");
  const { data: eb } = await svc.from("booking").select("status").eq("reference", eRef).single();
  log(eb.status === "expired", "sweeper flips stale held -> expired", eb.status);
  const rehold = await hold(date2, "07:00", 100);
  log(!rehold.error, "freed slot can be re-held after sweep", rehold.error?.message);

  // 4. Global invariant: no two active occurrences share (court, range).
  const all = await activeOcc();
  const seen = new Set(); let dup = 0;
  for (const o of all) { const k = `${o.court_id}|${o.time_range}`; if (seen.has(k)) dup++; seen.add(k); }
  log(dup === 0, `no overlapping active occurrences (${all.length} active, ${dup} dups)`);
} catch (e) {
  log(false, "harness crashed", e.message);
} finally {
  await clean();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
