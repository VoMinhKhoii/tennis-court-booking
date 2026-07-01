/**
 * Availability grid helpers (spec §6.1) — pure functions, no React, no DB.
 *
 * The public_availability view returns one row per OCCUPIED occurrence:
 *   { court_id, slot_date (ICT YYYY-MM-DD), time_range (tstzrange UTC text), occupied }
 *
 * The grid is rendered per court as a sequence of 30-min blocks between the
 * court's ICT open_time and close_time. To mark a block occupied we need the
 * occurrence's ICT wall-clock start/end — derived from the UTC instant range and
 * the fixed ICT offset (UTC+7, no DST, §2). Everything here works on minutes
 * since midnight to stay timezone-pure.
 */

import { BLOCK_MINUTES, ICT_OFFSET_MINUTES } from "./constants";

/** Parse "HH:MM" or "HH:MM:SS" into minutes since midnight. */
export function timeToMinutes(time: string): number {
	const [h, m] = time.split(":").map(Number);
	return h * 60 + m;
}

/** Format minutes since midnight back to "HH:MM" (24h). */
export function minutesToTime(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Parse a tstzrange text (e.g. `["2026-06-06 03:00:00+00","2026-06-06 04:00:00+00")`)
 * and return its lower-bound instant as ICT minutes-since-midnight on that day.
 *
 * The lower bound is a UTC instant; adding the fixed ICT offset and taking
 * modulo 1440 yields the ICT wall-clock minute of the block start. We rely on
 * slot_date for the calendar day, so only the time-of-day matters here.
 */
export function rangeStartIctMinutes(timeRange: string): number {
	const lower = timeRange
		.slice(1)
		.split(",")[0]
		?.trim()
		.replace(/^["']|["']$/g, "");
	if (!lower) {
		throw new Error(`unparseable time_range: ${timeRange}`);
	}
	// Postgres emits "YYYY-MM-DD HH:MM:SS+00"; normalize to ISO 8601 so Date
	// parses it reliably (space -> "T", bare "+HH" offset -> "+HH:00").
	const iso = lower.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
	const instant = new Date(iso);
	if (Number.isNaN(instant.getTime())) {
		throw new Error(`unparseable time_range lower bound: ${lower}`);
	}
	const utcMinutes = instant.getUTCHours() * 60 + instant.getUTCMinutes();
	return (((utcMinutes + ICT_OFFSET_MINUTES) % 1440) + 1440) % 1440;
}

/**
 * Expand an occupied occurrence's tstzrange into every 30-min ICT start-minute
 * it covers. The public_availability view returns one row per occurrence (which
 * may span multiple blocks), so marking only the lower bound would leave the
 * interior blocks looking free — this returns the full span.
 */
export function rangeIctBlockStarts(timeRange: string): number[] {
	const inner = timeRange.replace(/^[[(]/, "").replace(/[\])]$/, "");
	const [lowerRaw, upperRaw] = inner.split(",");
	const toInstant = (raw: string | undefined): Date => {
		const s = raw?.trim().replace(/^["']|["']$/g, "");
		if (!s) {
			throw new Error(`unparseable time_range bound: ${timeRange}`);
		}
		const iso = s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
		const instant = new Date(iso);
		if (Number.isNaN(instant.getTime())) {
			throw new Error(`unparseable time_range bound: ${s}`);
		}
		return instant;
	};
	const lower = toInstant(lowerRaw);
	const upper = toInstant(upperRaw);
	const startUtcMin = lower.getUTCHours() * 60 + lower.getUTCMinutes();
	const startIct = (((startUtcMin + ICT_OFFSET_MINUTES) % 1440) + 1440) % 1440;
	const durationMin = Math.round((upper.getTime() - lower.getTime()) / 60000);
	const out: number[] = [];
	for (let m = 0; m < durationMin; m += BLOCK_MINUTES) {
		out.push(startIct + m);
	}
	return out;
}

export type GridBlock = {
	/** "HH:MM" ICT wall-clock start of the 30-min block. */
	startTime: string;
	/** Minutes since ICT midnight. */
	startMinutes: number;
	occupied: boolean;
};

/**
 * Build the 30-min block row for one court on one ICT date.
 *
 * @param openTime court open_time ("HH:MM[:SS]"), 30-min aligned
 * @param closeTime court close_time ("HH:MM[:SS]"), exclusive end
 * @param occupiedStartMinutes ICT start-minute of each occupied block on this date
 *   (derive via rangeStartIctMinutes from the view rows matching this slot_date)
 */
export function buildDayGrid(
	openTime: string,
	closeTime: string,
	occupiedStartMinutes: ReadonlySet<number>,
): GridBlock[] {
	const open = timeToMinutes(openTime);
	const close = timeToMinutes(closeTime);
	const blocks: GridBlock[] = [];
	for (let m = open; m + BLOCK_MINUTES <= close; m += BLOCK_MINUTES) {
		blocks.push({
			startTime: minutesToTime(m),
			startMinutes: m,
			occupied: occupiedStartMinutes.has(m),
		});
	}
	return blocks;
}

/** Inclusive list of ICT dates in [first, last] as YYYY-MM-DD. */
export function datesInMonth(monthStart: string): string[] {
	const [y, m] = monthStart.split("-").map(Number);
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
	const out: string[] = [];
	for (let d = 1; d <= last; d++) {
		out.push(`${monthStart.slice(0, 7)}-${String(d).padStart(2, "0")}`);
	}
	return out;
}

/** Add `n` days (may be negative) to a YYYY-MM-DD ICT date, returning YYYY-MM-DD. */
export function addDays(isoDate: string, n: number): string {
	const [y, m, d] = isoDate.split("-").map(Number);
	const next = new Date(Date.UTC(y, m - 1, d + n));
	return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(
		next.getUTCDate(),
	).padStart(2, "0")}`;
}

/** Monday (ICT) of the week containing the given date, as YYYY-MM-DD. */
export function weekStartOf(isoDate: string): string {
	const [y, m, d] = isoDate.split("-").map(Number);
	const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
	const offset = (dow + 6) % 7; // days since Monday
	return addDays(isoDate, -offset);
}

/** The 7 ICT dates (Mon→Sun) of the week starting at `weekStart`. */
export function datesInWeek(weekStart: string): string[] {
	return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** First-of-month YYYY-MM-DD for the month containing the given ICT date. */
export function monthStartOf(isoDate: string): string {
	return `${isoDate.slice(0, 7)}-01`;
}

/** First-of-month for the month after the given month-start (current+next nav). */
export function nextMonthStart(monthStart: string): string {
	const [y, m] = monthStart.split("-").map(Number);
	const next = new Date(Date.UTC(y, m, 1));
	return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Month label like "tháng 6, 2026" for display. */
export function monthLabel(monthStart: string): string {
	const [y, m] = monthStart.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("vi-VN", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
}
