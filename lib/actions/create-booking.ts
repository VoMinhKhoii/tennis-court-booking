"use server";

import { headers } from "next/headers";
import { checkRateLimit, MAX_ACTIVE_PENDING } from "@/lib/booking/rate-limit";
import { type BookingInput, bookingInputSchema } from "@/lib/booking/schemas";
import { createServiceClient } from "@/lib/supabase/service";
import { type ActionResult, fail, ok } from "./types";

export type BookingReceipt = {
	reference: string;
	amountVnd: number;
	occurrences: number;
	qrImagePath: string | null;
};

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
 * Public booking creation (spec §6) — the sole public write path.
 *
 * Trust boundary: Zod safeParse -> rate-limit (IP + phone) -> active-pending cap
 * per phone -> create_pending_booking. anon has no EXECUTE on the function, so
 * we call it via the service-role client (server-only). The function derives
 * reference / status / source / amount; this action never sets them.
 */
export async function createBooking(input: BookingInput): Promise<ActionResult<BookingReceipt>> {
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

	// Active-pending cap per phone (authoritative DB count).
	const { count, error: countError } = await supabase
		.from("booking")
		.select("id", { count: "exact", head: true })
		.eq("zalo_phone", data.zaloPhone)
		.eq("status", "pending");
	if (countError) {
		throw countError;
	}
	if ((count ?? 0) >= MAX_ACTIVE_PENDING) {
		return fail(
			`You already have ${MAX_ACTIVE_PENDING} pending bookings. Please wait for the owner to confirm them.`,
		);
	}

	const { data: rpcRows, error } = await supabase.rpc("create_pending_booking", {
		p_court_id: data.courtId,
		p_type: data.type,
		p_customer_name: data.customerName,
		p_zalo_phone: data.zaloPhone,
		p_group_size: data.groupSize,
		p_start_time: data.startTime,
		p_block_count: data.blockCount,
		p_month: data.type === "monthly" ? data.month : null,
		p_weekday: data.type === "monthly" ? data.weekday : null,
		p_date: data.type === "adhoc" ? data.date : null,
	});

	if (error) {
		// The exclusion constraint / range checks surface as Postgres errors. Pass
		// the DB message through so a monthly conflict names the specific date.
		return fail(translateRpcError(error.message));
	}

	const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
	if (!row) {
		throw new Error("create_pending_booking returned no row");
	}

	// Fetch the QR path for the post-submit screen (no client-supplied path, §9).
	const { data: settings } = await supabase
		.from("settings")
		.select("qr_image_path")
		.eq("id", 1)
		.maybeSingle();

	return ok({
		reference: row.reference,
		amountVnd: Number(row.amount_vnd),
		occurrences: row.occurrences,
		qrImagePath: settings?.qr_image_path ?? null,
	});
}

/** Map known DB error messages to friendlier copy; pass others through. */
function translateRpcError(message: string): string {
	if (message.includes("no_overlap") || message.includes("exclusion")) {
		return "One of the requested slots was just taken. Please refresh availability and pick another time.";
	}
	if (message.includes("outside court operating hours")) {
		return "The selected time is outside the court's operating hours.";
	}
	if (message.includes("court is not active")) {
		return "That court is not currently available for booking.";
	}
	return message;
}
