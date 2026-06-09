import { expect, test } from "@playwright/test";
import { confirmToPayment, fillInfoAndReview, gotoAdhocCheckout } from "./helpers/checkout";
import { cleanup, E2E_DATE, e2eName, getBookingByRef } from "./helpers/db";

test.afterEach(cleanup);

test("ad-hoc happy path: info → review → pay → finalize → pending", async ({ page }) => {
	await gotoAdhocCheckout(page, { date: E2E_DATE, start: "06:00", dur: 2 });

	await fillInfoAndReview(page, { name: e2eName("happy"), phone: "0900000111" });
	const ref = await confirmToPayment(page);

	// Payment step: countdown + reference are on screen.
	await expect(page.getByRole("heading", { name: "Thanh toán" })).toBeVisible();
	await expect(page.getByText("Giữ chỗ trong")).toBeVisible();
	await expect(page.getByRole("button", { name: "Sao chép Nội dung CK" })).toContainText(ref);

	// Claim the transfer, then finalize the hold.
	await page.getByRole("button", { name: "Đã chuyển khoản" }).click();
	await page.getByRole("button", { name: "Rồi, hoàn tất" }).click();

	// Done: waiting for the owner.
	await expect(page.getByText("Đang chờ chủ sân xác nhận")).toBeVisible();

	// And the DB reflects held → pending.
	const booking = await getBookingByRef(ref);
	expect(booking?.status).toBe("pending");
});
