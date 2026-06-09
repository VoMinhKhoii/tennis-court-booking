/**
 * Zod schemas — the single trust boundary for every server action (spec §2).
 * Server actions begin with safeParse; client-side use is UX-only and never
 * trusted. Discriminated on session type (monthly | adhoc).
 *
 * These validate the SHAPE and basic ranges of input. Deeper business rules
 * (court active, range within open/close, double-booking) are enforced by the
 * SQL function / exclusion constraint, which is the authoritative backstop.
 */

import { z } from "zod";
import { MAX_BLOCK_COUNT } from "./constants";
import { normalizeOwnerZalo } from "./zalo";

/** YYYY-MM-DD ICT calendar date. */
const isoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
	.refine((s) => {
		const [y, m, d] = s.split("-").map(Number);
		const dt = new Date(Date.UTC(y, m - 1, d));
		return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
	}, "date is not a real calendar date");

/** HH:MM 24h, must be 30-min aligned (minutes 00 or 30). */
const alignedTime = z
	.string()
	.regex(/^([01]\d|2[0-3]):(00|30)$/, "time must be HH:MM, 30-min aligned");

const blockCount = z
	.number()
	.int("block_count must be an integer")
	.min(1, "block_count must be >= 1")
	.max(MAX_BLOCK_COUNT, `block_count must be <= ${MAX_BLOCK_COUNT}`);

const groupSize = z.number().int().min(1, "group_size must be >= 1");

const customerName = z.string().trim().min(1, "name is required").max(120);

// Vietnamese phone numbers: digits, optional leading +, 8–15 long. Kept lenient
// (existing-relationship customers); the DB only requires non-empty.
const zaloPhone = z
	.string()
	.trim()
	.min(1, "Zalo phone is required")
	.regex(/^\+?\d{8,15}$/, "Zalo phone must be 8–15 digits");

const courtId = z.uuid("invalid court id");

/** weekday 0=Sunday..6=Saturday (matches Postgres dow). */
const weekday = z.number().int().min(0).max(6);

const baseBookingFields = {
	customerName,
	zaloPhone,
	groupSize,
	startTime: alignedTime,
	blockCount,
};

/**
 * Public booking input. The form builds this; the server action safeParses it
 * before calling create_pending_booking. Discriminated on `type`.
 *
 * No court is chosen by the customer — the server auto-assigns a court (balanced
 * across courts), honoring an optional `preferredCourtId` when it is free for the
 * whole series. Monthly bookings can target multiple weekdays in one go.
 */
export const bookingInputSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("adhoc"),
		date: isoDate,
		preferredCourtId: courtId.optional(),
		...baseBookingFields,
	}),
	z.object({
		type: z.literal("monthly"),
		// Any date within the target calendar month.
		month: isoDate,
		weekdays: z.array(weekday).min(1, "pick at least one weekday").max(7),
		preferredCourtId: courtId.optional(),
		...baseBookingFields,
	}),
]);

export type BookingInput = z.infer<typeof bookingInputSchema>;

/** Owner court create/update (spec §7 court management). */
export const courtInputSchema = z
	.object({
		name: z.string().trim().min(1, "name is required").max(80),
		openTime: alignedTime,
		closeTime: alignedTime,
		isActive: z.boolean(),
	})
	.refine((c) => c.openTime < c.closeTime, {
		message: "open_time must be before close_time",
		path: ["closeTime"],
	});

export type CourtInput = z.infer<typeof courtInputSchema>;

/**
 * Owner settings update (flat rate + bank details for dynamic VietQR). QR image
 * path is set via the separate upload flow. Bank fields are optional — when set
 * they drive the VietQR (amount + reference embedded); when blank the flow falls
 * back to the static uploaded QR.
 */
export const settingsInputSchema = z.object({
	flatHourlyRateVnd: z.number().int("rate must be an integer").positive("rate must be > 0"),
	bankBin: z.string().trim().max(20).optional(),
	bankAccountNumber: z.string().trim().max(40).optional(),
	bankAccountName: z.string().trim().max(120).optional(),
	ownerZalo: z
		.string()
		.trim()
		.max(200)
		.optional()
		.refine((v) => v === undefined || v === "" || normalizeOwnerZalo(v) !== null, {
			message: "Zalo phải là số điện thoại hoặc link zalo.me",
		}),
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;

/**
 * Owner manual booking (straight to confirmed, source='owner'). The owner picks
 * an explicit court (authoritative — no rebalancing) and a single weekday.
 */
export const manualBookingInputSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("adhoc"),
		date: isoDate,
		courtId,
		...baseBookingFields,
	}),
	z.object({
		type: z.literal("monthly"),
		month: isoDate,
		weekday,
		courtId,
		...baseBookingFields,
	}),
]);
export type ManualBookingInput = z.infer<typeof manualBookingInputSchema>;

/** Reject action input. */
export const rejectInputSchema = z.object({
	bookingId: z.uuid(),
	reason: z.string().trim().max(500).optional(),
});

export type RejectInput = z.infer<typeof rejectInputSchema>;

/** Confirm action input. */
export const confirmInputSchema = z.object({
	bookingId: z.uuid(),
});

export type ConfirmInput = z.infer<typeof confirmInputSchema>;
