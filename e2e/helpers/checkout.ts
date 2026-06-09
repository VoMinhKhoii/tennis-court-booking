import { expect, type Page } from "@playwright/test";

/** References are 8 chars from an ambiguity-free alphabet (no 0/O/1/I/L). */
const REF_IN_URL = /\/book\/([A-HJ-NP-Z2-9]{8})(?:\?|#|$)/;

/** Go straight to the locked checkout for an ad-hoc slot (deterministic entry). */
export async function gotoAdhocCheckout(
	page: Page,
	opts: { date: string; start?: string; dur?: number },
): Promise<void> {
	const p = new URLSearchParams({
		type: "adhoc",
		date: opts.date,
		start: opts.start ?? "06:00",
		dur: String(opts.dur ?? 2),
		lock: "1",
	});
	await page.goto(`/book?${p.toString()}`);
	await expect(page.getByText("Khung giờ đã chọn")).toBeVisible();
}

/** Fill the customer fields on the info step and advance to review. */
export async function fillInfoAndReview(
	page: Page,
	info: { name: string; phone: string },
): Promise<void> {
	await page.getByLabel("Họ và tên").fill(info.name);
	await page.getByLabel("Số Zalo").fill(info.phone);
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await expect(page.getByText("Xác nhận đặt sân")).toBeVisible();
}

/** Confirm on the review step → createHold → redirect to /book/<reference>. */
export async function confirmToPayment(page: Page): Promise<string> {
	await page.getByRole("button", { name: "Tiến hành thanh toán" }).click();
	await page.waitForURL(REF_IN_URL);
	return refFromUrl(page);
}

export function refFromUrl(page: Page): string {
	const m = page.url().match(REF_IN_URL);
	if (!m) throw new Error(`No booking reference in URL: ${page.url()}`);
	return m[1];
}
