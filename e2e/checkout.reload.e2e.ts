import { expect, test } from "@playwright/test";
import { confirmToPayment, fillInfoAndReview, gotoAdhocCheckout } from "./helpers/checkout";
import { cleanup, E2E_DATE, e2eName } from "./helpers/db";

test.afterEach(cleanup);

// The regression this whole change fixes: a reload mid-payment must NOT strand
// the customer (previously the bottom-sheet unmounted and orphaned the hold).
test("reload mid-payment keeps the customer on the same live hold", async ({ page }) => {
	await gotoAdhocCheckout(page, { date: E2E_DATE, start: "07:00", dur: 2 });
	await fillInfoAndReview(page, { name: e2eName("reload"), phone: "0900000222" });
	const ref = await confirmToPayment(page);

	await expect(page.getByText("Giữ chỗ trong")).toBeVisible();

	await page.reload();

	// Still the payment step, same reference, countdown running.
	await expect(page).toHaveURL(new RegExp(`/book/${ref}$`));
	await expect(page.getByRole("heading", { name: "Thanh toán" })).toBeVisible();
	await expect(page.getByText("Giữ chỗ trong")).toBeVisible();
	await expect(page.getByRole("button", { name: "Sao chép Nội dung CK" })).toContainText(ref);
});
