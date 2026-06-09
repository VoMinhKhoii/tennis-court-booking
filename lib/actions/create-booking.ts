"use server";

import { headers } from "next/headers";
import { checkRateLimit, MAX_ACTIVE_RESERVATIONS } from "@/lib/booking/rate-limit";
import { type BookingInput, bookingInputSchema } from "@/lib/booking/schemas";
import { buildVietQrUrl } from "@/lib/booking/vietqr";
import { createServiceClient } from "@/lib/supabase/service";
import { type ActionResult, fail, ok } from "./types";

export type BookingReceipt = {
	reference: string;
	amountVnd: number;
	occurrences: number;
	/** The court the server assigned to the whole series. */
	courtName: string;
	/** Dynamic VietQR (amount + reference embedded); null when bank not configured. */
	qrUrl: string | null;
	/** Static uploaded QR fallback (used only when qrUrl is null). */
	qrImagePath: string | null;
	bankAccountName: string | null;
	bankAccountNumber: string | null;
	/** Owner Zalo deep-link (https, validated) for the "send proof" step; null when unset. */
	ownerZalo: string | null;
	/** ISO timestamp the soft-hold expires; the payment step counts down to this. */
	holdExpiresAt: string;
};

/** Minutes a slot stays soft-locked while the customer pays (spec §lifecycle). */
const HOLD_MINUTES = 15;

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
async function clientIp(): Promise<string> {
	const h = await headers();
	const xff = h.get("x-forwarded-for");
	if (xff) {
		return xff.split(",")[0]?.trim() || "unknown";
	}
	return h.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Public checkout entry (spec §"Server actions" / lifecycle) — creates a soft-hold.
 *
 * Trust boundary: Zod safeParse -> rate-limit (IP + phone) -> active-reservation
 * cap per phone -> create_pending_booking(p_hold_minutes=15). anon has no EXECUTE
 * on the function, so we call it via the service-role client (server-only).
 * Creating the hold IS the lock (GiST exclusion); the function derives
 * reference / status / source / amount and stamps hold_expires_at.
 */
export async function createHold(input: BookingInput): Promise<ActionResult<BookingReceipt>> {
	const parsed = bookingInputSchema.safeParse(input);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		return fail(first?.message ?? "Invalid booking input", first?.path.join("."));
	}
	const data = parsed.data;

	const ip = await clientIp();
	if (!checkRateLimit(`ip:${ip}`) || !checkRateLimit(`phone:${data.zaloPhone}`)) {
		return fail("Too many requests. Please wait a moment and try again.");
	}

	const supabase = createServiceClient();

	// Authoritative active-reservation cap (held-not-expired + pending) per phone.
	// Caps before any QR so a customer is never rejected after paying.
	const { count, error: countError } = await supabase
		.from("booking")
		.select("id", { count: "exact", head: true })
		.eq("zalo_phone", data.zaloPhone)
		.or(
			`status.eq.pending,and(status.eq.held,hold_expires_at.gt.${new Date().toISOString()})`,
		);
	if (countError) {
		return fail("Could not verify your reservations. Please try again.");
	}
	if ((count ?? 0) >= MAX_ACTIVE_RESERVATIONS) {
		return fail(
			`Bạn đang có ${MAX_ACTIVE_RESERVATIONS} lượt giữ chỗ/chờ xác nhận. Vui lòng hoàn tất hoặc chờ chủ sân.`,
		);
	}

	const { data: rpcRows, error } = await supabase.rpc("create_pending_booking", {
		p_type: data.type,
		p_customer_name: data.customerName,
		p_zalo_phone: data.zaloPhone,
		p_group_size: data.groupSize,
		p_start_time: data.startTime,
		p_block_count: data.blockCount,
		p_month: data.type === "monthly" ? data.month : null,
		p_weekdays: data.type === "monthly" ? data.weekdays : null,
		p_date: data.type === "adhoc" ? data.date : null,
		p_preferred_court_id: data.preferredCourtId ?? null,
		p_force_court: false,
		p_hold_minutes: HOLD_MINUTES,
	});

	if (error) {
		// The exclusion constraint / range checks surface as Postgres errors. Pass
		// the DB message through so a monthly conflict names the specific date.
		return fail(translateRpcError(error.message));
	}

	const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
	if (!row) {
		return fail("Could not hold the slot. Please try again.");
	}

	const amountVnd = Number(row.amount_vnd);

	// Build the payment artifacts server-side (no client-supplied path, §9). Bank
	// fields drive a dynamic VietQR (amount + reference baked in); otherwise we fall
	// back to the static uploaded QR with the reference shown as text.
	const { data: settings } = await supabase
		.from("settings")
		.select("qr_image_path, bank_bin, bank_account_number, bank_account_name, owner_zalo")
		.eq("id", 1)
		.maybeSingle();

	const bankBin = settings?.bank_bin ?? null;
	const bankAccountNumber = settings?.bank_account_number ?? null;
	const bankAccountName = settings?.bank_account_name ?? null;
	const qrUrl =
		bankBin && bankAccountNumber && bankAccountName
			? buildVietQrUrl({
					bankBin,
					accountNumber: bankAccountNumber,
					accountName: bankAccountName,
					amountVnd,
					memo: row.reference,
				})
			: null;

	// hold_expires_at: re-read the booking we just created (authoritative DB value).
	const { data: held } = await supabase
		.from("booking")
		.select("hold_expires_at")
		.eq("reference", row.reference)
		.single();

	return ok({
		reference: row.reference,
		amountVnd,
		occurrences: row.occurrences,
		courtName: row.court_name,
		qrUrl,
		qrImagePath: settings?.qr_image_path ?? null,
		bankAccountName,
		bankAccountNumber,
		ownerZalo: settings?.owner_zalo ?? null,
		holdExpiresAt:
			held?.hold_expires_at ?? new Date(Date.now() + HOLD_MINUTES * 60000).toISOString(),
	});
}

/**
 * @deprecated Phase 2 shim — the public flow now uses createHold + finalizeBooking.
 * Kept so the pre-wizard UI keeps compiling until Phase 3 swaps it out.
 */
export async function createBooking(input: BookingInput): Promise<ActionResult<BookingReceipt>> {
	return createHold(input);
}

/**
 * Finalize the customer's hold (final "Rồi, hoàn tất"): promote held -> pending.
 *
 * Guarded UPDATE (only while the hold is live); idempotent on retry/double-tap
 * (already pending/confirmed → ok). When the hold expired/gone, returns a typed
 * fail("HOLD_EXPIRED") so the UI can show recovery copy instead of restarting.
 */
export async function finalizeBooking(
	reference: string,
): Promise<ActionResult<{ status: "pending" }>> {
	if (!reference || typeof reference !== "string") {
		return fail("Invalid reference");
	}
	const ip = await clientIp();
	if (!checkRateLimit(`finalize:${ip}`)) {
		return fail("Too many requests.");
	}
	const supabase = createServiceClient();

	// Guarded promotion held -> pending (only while the hold is live).
	const { data, error } = await supabase
		.from("booking")
		.update({ status: "pending", hold_expires_at: null })
		.eq("reference", reference)
		.eq("status", "held")
		.gt("hold_expires_at", new Date().toISOString())
		.select("id")
		.maybeSingle();
	if (error) {
		return fail("Could not finalize. Please try again.");
	}
	if (data) {
		return ok({ status: "pending" });
	}

	// Idempotent: already finalized?
	const { data: existing } = await supabase
		.from("booking")
		.select("status")
		.eq("reference", reference)
		.maybeSingle();
	if (existing?.status === "pending" || existing?.status === "confirmed") {
		return ok({ status: "pending" });
	}

	// Expired or gone.
	return fail("HOLD_EXPIRED");
}

/**
 * Resume read for the payment step (refresh / mobile tab eviction). Returns the
 * full receipt for a still-live hold, or fail("HOLD_EXPIRED") when gone/expired.
 */
export async function getHold(reference: string): Promise<ActionResult<BookingReceipt>> {
	const supabase = createServiceClient();
	const { data: b } = await supabase
		.from("booking")
		.select("id, reference, amount_vnd, status, hold_expires_at, court:court_id(name)")
		.eq("reference", reference)
		.maybeSingle();
	if (
		!b ||
		b.status !== "held" ||
		!b.hold_expires_at ||
		new Date(b.hold_expires_at) <= new Date()
	) {
		return fail("HOLD_EXPIRED");
	}

	const { count } = await supabase
		.from("booking_occurrence")
		.select("id", { count: "exact", head: true })
		.eq("booking_id", b.id);

	const amountVnd = Number(b.amount_vnd);
	const { data: settings } = await supabase
		.from("settings")
		.select("qr_image_path, bank_bin, bank_account_number, bank_account_name, owner_zalo")
		.eq("id", 1)
		.maybeSingle();
	const qrUrl =
		settings?.bank_bin && settings?.bank_account_number && settings?.bank_account_name
			? buildVietQrUrl({
					bankBin: settings.bank_bin,
					accountNumber: settings.bank_account_number,
					accountName: settings.bank_account_name,
					amountVnd,
					memo: b.reference,
				})
			: null;

	const court = b.court as { name: string } | { name: string }[] | null;
	const courtName = Array.isArray(court) ? (court[0]?.name ?? "") : (court?.name ?? "");

	return ok({
		reference: b.reference,
		amountVnd,
		occurrences: count ?? 1,
		courtName,
		qrUrl,
		qrImagePath: settings?.qr_image_path ?? null,
		bankAccountName: settings?.bank_account_name ?? null,
		bankAccountNumber: settings?.bank_account_number ?? null,
		ownerZalo: settings?.owner_zalo ?? null,
		holdExpiresAt: b.hold_expires_at,
	});
}

/** Map known DB error messages to friendlier copy; pass others through. */
function translateRpcError(message: string): string {
	if (message.includes("no_court_available")) {
		return "Tất cả các sân đều đã kín cho khung giờ này. Vui lòng chọn giờ khác.";
	}
	if (message.includes("no_overlap") || message.includes("exclusion")) {
		return "One of the requested slots was just taken. Please refresh availability and pick another time.";
	}
	if (message.includes("outside court operating hours")) {
		return "The selected time is outside the court's operating hours.";
	}
	if (message.includes("court is not active")) {
		return "That court is not currently available for booking.";
	}
	// Don't surface raw DB internals for unrecognized errors.
	return "Could not create the booking. Please check your selection and try again.";
}
