import { expect, test } from "@playwright/test";
import { gotoAdhocCheckout } from "./helpers/checkout";
import { cleanup, E2E_DATE, e2eName } from "./helpers/db";

test.afterEach(cleanup);

test("invalid phone is rejected on the info step (no advance to review)", async ({ page }) => {
	await gotoAdhocCheckout(page, { date: E2E_DATE, start: "10:00", dur: 2 });

	await page.getByLabel("Họ và tên").fill(e2eName("valid"));
	await page.getByLabel("Số Zalo").fill("abc"); // not 8–15 digits
	await page.getByRole("button", { name: "Tiếp tục" }).click();

	await expect(page.getByText("Zalo phone must be 8–15 digits")).toBeVisible();
	await expect(page.getByText("Xác nhận đặt sân")).toHaveCount(0);
});
