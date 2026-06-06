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

/** Month label like "June 2026" for display. */
export function monthLabel(monthStart: string): string {
	const [y, m] = monthStart.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
}
