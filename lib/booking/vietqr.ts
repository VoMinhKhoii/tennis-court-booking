/**
 * Dynamic VietQR image URL (img.vietqr.io). Encodes the owner's bank account
 * plus the transfer amount and the booking reference as the memo, so the customer
 * scans once and confirms — a Stripe-like, manually-settled payment.
 *
 * Built server-side (in the booking action) from owner-only settings; the bank
 * details never reach the client except baked into this QR image.
 */

export type VietQrParams = {
	bankBin: string;
	accountNumber: string;
	accountName: string;
	amountVnd: number;
	memo: string;
};

/** `compact2` renders amount + memo beneath the code — best for a payment screen. */
export function buildVietQrUrl(p: VietQrParams): string {
	const base = `https://img.vietqr.io/image/${encodeURIComponent(p.bankBin)}-${encodeURIComponent(
		p.accountNumber,
	)}-compact2.png`;
	const query = new URLSearchParams({
		amount: String(p.amountVnd),
		addInfo: p.memo,
		accountName: p.accountName,
	});
	return `${base}?${query.toString()}`;
}
