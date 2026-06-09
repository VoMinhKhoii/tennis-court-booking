/**
 * Warm the dev server before the suite runs. `next dev` (Turbopack) compiles each
 * route on its first request, which can exceed a test's timeout on the unlucky
 * test that hits a cold route. Fetching every checkout route once here makes the
 * per-test timing deterministic.
 */
export default async function globalSetup() {
	const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
	const routes = [
		"/",
		"/availability",
		"/book?type=adhoc&date=2027-12-15&start=06:00&dur=2&lock=1",
		"/book?type=monthly&month=2027-12-01&weekdays=2&start=06:00&dur=2&lock=1",
		"/book/WARMUP00", // compiles the dynamic [reference] route (renders not-found)
	];
	for (const r of routes) {
		try {
			await fetch(base + r, { redirect: "manual" });
		} catch {
			// First hit may still be compiling; the retry below covers it.
		}
		try {
			await fetch(base + r, { redirect: "manual" });
		} catch {
			/* ignore */
		}
	}
}
