import { expect, test } from "@playwright/test";
import { fillInfoAndReview, gotoAdhocCheckout } from "./helpers/checkout";
import { cleanup, E2E_DATE, e2eName, seedAllCourtsConfirmed } from "./helpers/db";

test.afterEach(cleanup);

test("conflict: all courts taken → friendly message, no hold created", async ({ page }) => {
	// Block the slot on every court so the customer cannot be auto-assigned one.
	await seedAllCourtsConfirmed({ date: E2E_DATE, startTime: "09:00", blockCount: 2 });

	await gotoAdhocCheckout(page, { date: E2E_DATE, start: "09:00", dur: 2 });
	await fillInfoAndReview(page, { name: e2eName("conflict"), phone: "0900000444" });
	await page.getByRole("button", { name: "Tiến hành thanh toán" }).click();

	// Stays on /book (no redirect to a reference) and shows the friendly conflict
	// copy. The failing RPC scans every court round-trip to cloud, so allow extra time.
	await expect(
		page.getByText("Tất cả các sân đều đã kín cho khung giờ này. Vui lòng chọn giờ khác."),
	).toBeVisible({ timeout: 30_000 });
	await expect(page).toHaveURL(/\/book\?/);
});
