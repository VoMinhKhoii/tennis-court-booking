"use server";

import {
	type ConfirmInput,
	type CourtInput,
	confirmInputSchema,
	courtInputSchema,
	type ManualBookingInput,
	manualBookingInputSchema,
	type RejectInput,
	rejectInputSchema,
	type SettingsInput,
	settingsInputSchema,
} from "@/lib/booking/schemas";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail, ok } from "./types";

/**
 * Defense-in-depth owner gate (spec §7): every owner server action independently
 * calls getUser() (verified) AND confirms the caller is the seeded owner via the
 * DB's is_owner(). RLS still enforces this at the row level — this is the second,
 * explicit layer. Returns the RLS-scoped owner client on success.
 */
type OwnerGuard =
	| { ok: true; supabase: Awaited<ReturnType<typeof createClient>> }
	| { ok: false; error: string };

async function requireOwner(): Promise<OwnerGuard> {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) {
		return { ok: false, error: "Not authenticated" };
	}
	const { data: isOwner, error } = await supabase.rpc("is_owner");
	if (error || isOwner !== true) {
		return { ok: false, error: "Forbidden" };
	}
	return { ok: true, supabase };
}

/** Confirm a pending booking (status-guarded; locks the slots). Spec §7. */
export async function confirmBooking(input: ConfirmInput): Promise<ActionResult<{ id: string }>> {
	const parsed = confirmInputSchema.safeParse(input);
	if (!parsed.success) {
		return fail("Invalid input");
	}
	const guard = await requireOwner();
	if (!guard.ok) {
		return fail(guard.error);
	}

	// Guarded WHERE status='pending': a confirmed/rejected booking is untouched.
	const { data, error } = await guard.supabase
		.from("booking")
		.update({ status: "confirmed", confirmed_at: new Date().toISOString() })
		.eq("id", parsed.data.bookingId)
		.eq("status", "pending")
		.select("id")
		.maybeSingle();

	if (error) {
		return fail(error.message);
	}
	if (!data) {
		return fail("Booking is no longer pending.");
	}
	return ok({ id: data.id });
}

/** Reject a pending booking (optional reason; trigger frees the slots). Spec §7. */
export async function rejectBooking(input: RejectInput): Promise<ActionResult<{ id: string }>> {
	const parsed = rejectInputSchema.safeParse(input);
	if (!parsed.success) {
		return fail("Invalid input");
	}
	const guard = await requireOwner();
	if (!guard.ok) {
		return fail(guard.error);
	}

	const { data, error } = await guard.supabase
		.from("booking")
		.update({ status: "rejected", reject_reason: parsed.data.reason ?? null })
		.eq("id", parsed.data.bookingId)
		.eq("status", "pending")
		.select("id")
		.maybeSingle();

	if (error) {
		return fail(error.message);
	}
	if (!data) {
		return fail("Booking is no longer pending.");
	}
	return ok({ id: data.id });
}

/**
 * Owner manual booking (spec §7): creates a booking straight to confirmed with
 * source='owner', reusing the same occurrence generation + exclusion constraint.
 *
 * We reuse create_pending_booking (single occurrence-generation path) under the
 * owner's session, then immediately confirm and stamp source. create_pending_booking
 * forces source='public'/status='pending'; the follow-up update — allowed only
 * for the owner by RLS — promotes it. This keeps ONE date/pricing code path.
 */
export async function createManualBooking(
	input: ManualBookingInput,
): Promise<ActionResult<{ reference: string; amountVnd: number; occurrences: number }>> {
	const parsed = manualBookingInputSchema.safeParse(input);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		return fail(first?.message ?? "Invalid booking input", first?.path.join("."));
	}
	const guard = await requireOwner();
	if (!guard.ok) {
		return fail(guard.error);
	}
	const data = parsed.data;

	const { data: rpcRows, error } = await guard.supabase.rpc("create_pending_booking", {
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
		return fail(error.message);
	}
	const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
	if (!row) {
		throw new Error("create_pending_booking returned no row");
	}

	// Promote to confirmed + owner source (owner-only via RLS). The status update
	// fires booking_status_mirror, locking the occurrences as confirmed.
	const { error: promoteError } = await guard.supabase
		.from("booking")
		.update({
			status: "confirmed",
			source: "owner",
			confirmed_at: new Date().toISOString(),
		})
		.eq("reference", row.reference);
	if (promoteError) {
		return fail(promoteError.message);
	}

	return ok({
		reference: row.reference,
		amountVnd: Number(row.amount_vnd),
		occurrences: row.occurrences,
	});
}

/** Create a court (spec §7 court management). */
export async function createCourt(input: CourtInput): Promise<ActionResult<{ id: string }>> {
	const parsed = courtInputSchema.safeParse(input);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		return fail(first?.message ?? "Invalid court", first?.path.join("."));
	}
	const guard = await requireOwner();
	if (!guard.ok) {
		return fail(guard.error);
	}
	const c = parsed.data;
	const { data, error } = await guard.supabase
		.from("court")
		.insert({
			name: c.name,
			open_time: c.openTime,
			close_time: c.closeTime,
			is_active: c.isActive,
		})
		.select("id")
		.single();
	if (error) {
		return fail(error.message);
	}
	return ok({ id: data.id });
}

/** Update a court (spec §7). */
export async function updateCourt(
	id: string,
	input: CourtInput,
): Promise<ActionResult<{ id: string }>> {
	const idParsed = courtInputSchema.safeParse(input);
	if (!idParsed.success) {
		const first = idParsed.error.issues[0];
		return fail(first?.message ?? "Invalid court", first?.path.join("."));
	}
	const guard = await requireOwner();
	if (!guard.ok) {
		return fail(guard.error);
	}
	const c = idParsed.data;
	const { data, error } = await guard.supabase
		.from("court")
		.update({
			name: c.name,
			open_time: c.openTime,
			close_time: c.closeTime,
			is_active: c.isActive,
		})
		.eq("id", id)
		.select("id")
		.maybeSingle();
	if (error) {
		return fail(error.message);
	}
	if (!data) {
		return fail("Court not found.");
	}
	return ok({ id: data.id });
}

/** Update settings: flat hourly rate (spec §7, §8). QR upload is a separate flow. */
export async function updateSettings(input: SettingsInput): Promise<ActionResult<{ id: number }>> {
	const parsed = settingsInputSchema.safeParse(input);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		return fail(first?.message ?? "Invalid settings", first?.path.join("."));
	}
	const guard = await requireOwner();
	if (!guard.ok) {
		return fail(guard.error);
	}
	const { data, error } = await guard.supabase
		.from("settings")
		.update({ flat_hourly_rate_vnd: parsed.data.flatHourlyRateVnd })
		.eq("id", 1)
		.select("id")
		.maybeSingle();
	if (error) {
		return fail(error.message);
	}
	if (!data) {
		return fail("Settings row missing.");
	}
	return ok({ id: data.id });
}

/**
 * Upload the payment QR image to Storage and record its path (spec §7, §9).
 * Owner-only Storage write is enforced by Storage RLS; the path is set on
 * settings.qr_image_path so the public flow reads it server-side (no
 * client-supplied path).
 */
export async function uploadQrImage(formData: FormData): Promise<ActionResult<{ path: string }>> {
	const guard = await requireOwner();
	if (!guard.ok) {
		return fail(guard.error);
	}
	const file = formData.get("file");
	if (!(file instanceof File) || file.size === 0) {
		return fail("No file provided.");
	}
	if (!file.type.startsWith("image/")) {
		return fail("QR must be an image.");
	}

	const ext = file.name.includes(".") ? file.name.split(".").pop() : "png";
	const path = `qr.${ext}`;
	const { error: uploadError } = await guard.supabase.storage
		.from("qr")
		.upload(path, file, { upsert: true, contentType: file.type });
	if (uploadError) {
		return fail(uploadError.message);
	}

	const { error: settingsError } = await guard.supabase
		.from("settings")
		.update({ qr_image_path: path })
		.eq("id", 1);
	if (settingsError) {
		return fail(settingsError.message);
	}
	return ok({ path });
}
