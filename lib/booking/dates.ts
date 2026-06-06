/**
 * Date enumeration — the TypeScript mirror of public.enumerate_slot_dates
 * (supabase/migrations/...02_functions.sql). It MUST produce the identical set
 * of dates so the form's amount preview cannot diverge from the server insert
 * (spec §6, §8). The DB function remains the source of truth; this is preview-only.
 *
 * Date convention throughout: an "ISO date string" YYYY-MM-DD representing an
 * ICT calendar date. We never rely on the host machine's local timezone — all
 * arithmetic is done on UTC-midnight Date objects, which behave as a pure
 * proleptic Gregorian calendar.
 *
 * Weekday convention: 0 = Sunday .. 6 = Saturday, matching Postgres
 * extract(dow ...) and JavaScript Date.getUTCDay().
 */

import { ICT_OFFSET_MINUTES } from "./constants";

const MS_PER_DAY = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a YYYY-MM-DD ICT calendar date into a UTC-midnight Date. */
function parseISODate(s: string): Date {
	if (!ISO_DATE_RE.test(s)) {
		throw new Error(`invalid ISO date: ${s}`);
	}
	const [y, m, d] = s.split("-").map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	// Reject impossible dates (e.g. 2026-02-30 rolls over).
	if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
		throw new Error(`invalid ISO date: ${s}`);
	}
	return date;
}

/** Format a UTC-midnight Date back to YYYY-MM-DD. */
function formatISODate(date: Date): string {
	const y = String(date.getUTCFullYear()).padStart(4, "0");
	const m = String(date.getUTCMonth() + 1).padStart(2, "0");
	const d = String(date.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * Today's ICT calendar date as YYYY-MM-DD. Mirrors
 * (now() at time zone 'Asia/Ho_Chi_Minh')::date.
 * @param now override for testing; defaults to the real current instant.
 */
export function ictToday(now: Date = new Date()): string {
	const ict = new Date(now.getTime() + ICT_OFFSET_MINUTES * 60_000);
	const y = String(ict.getUTCFullYear()).padStart(4, "0");
	const m = String(ict.getUTCMonth() + 1).padStart(2, "0");
	const d = String(ict.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function firstOfMonth(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function lastOfMonth(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

/**
 * Enumerate the concrete slot dates for a booking, mirroring the SQL function.
 *
 * - adhoc: returns exactly [date].
 * - monthly: every matching weekday-date from
 *     start = first matching weekday on/after max(today_ict, first-of-month)
 *   through the last day of that month, ascending.
 *
 * @param today the ICT today (YYYY-MM-DD); pass ictToday() at the call site so
 *   callers can keep it stable across preview and submit. The SQL floors monthly
 *   enumeration at greatest(first-of-month, today_ict).
 */
export function enumerateSlotDates(
	input: { type: "adhoc"; date: string } | { type: "monthly"; month: string; weekday: number },
	today: string,
): string[] {
	if (input.type === "adhoc") {
		// Validate but pass through the single supplied date.
		parseISODate(input.date);
		return [input.date];
	}

	if (input.weekday < 0 || input.weekday > 6) {
		throw new Error("weekday must be 0..6 (Sunday..Saturday)");
	}

	const monthAnchor = parseISODate(input.month);
	const todayDate = parseISODate(today);
	const first = firstOfMonth(monthAnchor);
	const last = lastOfMonth(monthAnchor);

	// Begin no earlier than today (mid-month locks only remaining dates).
	const start = todayDate.getTime() > first.getTime() ? todayDate : first;

	// Advance to the first matching weekday on/after start.
	const offset = (input.weekday - start.getUTCDay() + 7) % 7;
	const dates: string[] = [];
	for (let d = addDays(start, offset); d.getTime() <= last.getTime(); d = addDays(d, 7)) {
		dates.push(formatISODate(d));
	}
	return dates;
}
