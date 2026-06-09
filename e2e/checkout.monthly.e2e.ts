import { expect, test } from "@playwright/test";
import { confirmToPayment, fillInfoAndReview } from "./helpers/checkout";
import { admin, cleanup, e2eName } from "./helpers/db";

test.afterEach(cleanup);

test("monthly: enumerates sessions and holds a multi-occurrence booking", async ({ page }) => {
	const params = new URLSearchParams({
		type: "monthly",
		month: "2027-12-01",
		weekdays: "2", // every Tuesday
		start: "06:00",
		dur: "2",
		lock: "1",
	});
	await page.goto(`/book?${params.toString()}`);

	await fillInfoAndReview(page, { name: e2eName("monthly"), phone: "0900000555" });

	// Review lists N sessions for the chosen weekday.
	const sessionsText = await page.getByText(/Các buổi \((\d+)\)/).textContent();
	const n = Number(sessionsText?.match(/\((\d+)\)/)?.[1]);
	expect(n).toBeGreaterThan(1);

	const ref = await confirmToPayment(page);

	// The hold spans exactly N occurrences with a positive amount.
	const { data: b } = await admin()
		.from("booking")
		.select("id, amount_vnd, status")
		.eq("reference", ref)
		.single();
	expect(b?.status).toBe("held");
	expect(Number(b?.amount_vnd)).toBeGreaterThan(0);

	const { count } = await admin()
		.from("booking_occurrence")
		.select("id", { count: "exact", head: true })
		.eq("booking_id", b?.id);
	expect(count).toBe(n);
});
