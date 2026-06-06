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
	courtId,
	customerName,
	zaloPhone,
	groupSize,
	startTime: alignedTime,
	blockCount,
};

/**
 * Public booking input. The form builds this; the server action safeParses it
 * before calling create_pending_booking. Discriminated on `type`.
 */
export const bookingInputSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("adhoc"),
		date: isoDate,
		...baseBookingFields,
	}),
	z.object({
		type: z.literal("monthly"),
		// Any date within the target calendar month.
		month: isoDate,
		weekday,
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

/** Owner settings update (flat rate; QR path is set via the upload flow). */
export const settingsInputSchema = z.object({
	flatHourlyRateVnd: z.number().int("rate must be an integer").positive("rate must be > 0"),
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;

/** Owner manual booking (straight to confirmed, source='owner'). Same shape as public. */
export const manualBookingInputSchema = bookingInputSchema;
export type ManualBookingInput = BookingInput;

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
