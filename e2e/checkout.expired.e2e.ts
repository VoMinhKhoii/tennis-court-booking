import { expect, test } from "@playwright/test";
import { confirmToPayment, fillInfoAndReview, gotoAdhocCheckout } from "./helpers/checkout";
import { cleanup, E2E_DATE_ALT, e2eName, forceExpire } from "./helpers/db";

test.afterEach(cleanup);

test("expired hold shows the recovery screen on reload", async ({ page }) => {
	await gotoAdhocCheckout(page, { date: E2E_DATE_ALT, start: "08:00", dur: 2 });
	await fillInfoAndReview(page, { name: e2eName("expired"), phone: "0900000333" });
	const ref = await confirmToPayment(page);

	// Force the pay window into the past, then reload — the server re-derives state.
	await forceExpire(ref);
	await page.reload();

	await expect(page.getByText("Hết thời gian giữ chỗ")).toBeVisible();
	await expect(page.getByRole("link", { name: "Đặt lại" })).toBeVisible();
	await expect(page.getByText(ref, { exact: true }).last()).toBeVisible();
});
