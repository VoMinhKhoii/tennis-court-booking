/**
 * Dashboard analytics — pure aggregation over the existing booking query rows.
 * No React, no DB: everything here is derived client-side from `BookingRow[]`
 * (all confirmed rows) + `CourtRow[]`, so the numbers always match the lists.
 *
 * Time is fixed to ICT (UTC+7, no DST, spec §2): a booking is bucketed by the
 * ICT calendar date of its `confirmed_at` (falling back to `created_at`).
 */

import { addDays, datesInMonth, monthStartOf } from "@/lib/booking/grid";
import type { BookingRow, CourtRow } from "@/lib/queries/types";

export type Period = "weekly" | "monthly" | "yearly";

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

/** ICT calendar date (YYYY-MM-DD) of a UTC ISO timestamp. */
function ictDateOf(iso: string): string {
	return new Date(new Date(iso).getTime() + ICT_OFFSET_MS).toISOString().slice(0, 10);
}

/** The timestamp a confirmed booking counts against (confirm time, else create). */
function bookingInstant(b: BookingRow): string {
	return b.confirmed_at ?? b.created_at;
}

/** First-of-month YYYY-MM-DD `n` months from `monthStart` (n may be negative). */
function addMonths(monthStart: string, n: number): string {
	const [y, m] = monthStart.split("-").map(Number);
	const d = new Date(Date.UTC(y, m - 1 + n, 1));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function monthShort(monthKey: string): string {
	const [y, m] = monthKey.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("vi-VN", {
		month: "short",
		timeZone: "UTC",
	});
}

function weekdayShort(isoDate: string): string {
	const [y, m, d] = isoDate.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("vi-VN", {
		weekday: "short",
		timeZone: "UTC",
	});
}

export type SeriesPoint = { label: string; current: number; previous: number | null };

/**
 * A window is a pair of aligned bucket-key lists (current vs the immediately
 * preceding equivalent span) plus the x-axis labels. Keys are ICT dates for
 * day-granularity periods and YYYY-MM for the yearly (month-granularity) period.
 */
function windowFor(
	period: Period,
	today: string,
): { current: string[]; previous: string[]; labels: string[]; granularity: "day" | "month" } {
	if (period === "weekly") {
		const current = Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i));
		const previous = Array.from({ length: 7 }, (_, i) => addDays(today, -13 + i));
		return { current, previous, labels: current.map(weekdayShort), granularity: "day" };
	}
	if (period === "yearly") {
		const month = monthStartOf(today);
		const current = Array.from({ length: 12 }, (_, i) => addMonths(month, -11 + i).slice(0, 7));
		const previous = Array.from({ length: 12 }, (_, i) => addMonths(month, -23 + i).slice(0, 7));
		return { current, previous, labels: current.map(monthShort), granularity: "month" };
	}
	// monthly (default): current calendar month by day vs previous month by day.
	const month = monthStartOf(today);
	const curDates = datesInMonth(month);
	const prevDates = datesInMonth(addMonths(month, -1));
	return {
		current: curDates,
		previous: prevDates,
		labels: curDates.map((d) => String(Number(d.slice(8, 10)))),
		granularity: "day",
	};
}

/** Sum of confirmed revenue keyed by ICT date (or YYYY-MM month). */
function revenueByKey(rows: BookingRow[], granularity: "day" | "month"): Map<string, number> {
	const map = new Map<string, number>();
	for (const b of rows) {
		const date = ictDateOf(bookingInstant(b));
		const key = granularity === "month" ? date.slice(0, 7) : date;
		map.set(key, (map.get(key) ?? 0) + b.amount_vnd);
	}
	return map;
}

/**
 * Revenue time-series for the chart: one point per bucket, with the current
 * span and the aligned previous span overlaid. `previous` is null where no
 * aligned prior bucket exists (e.g. a 31-day month over a 30-day one).
 */
export function revenueSeries(rows: BookingRow[], period: Period, today: string): SeriesPoint[] {
	const { current, previous, labels, granularity } = windowFor(period, today);
	const byKey = revenueByKey(rows, granularity);
	return current.map((key, i) => ({
		label: labels[i],
		current: byKey.get(key) ?? 0,
		previous: i < previous.length ? (byKey.get(previous[i]) ?? 0) : null,
	}));
}

export type Totals = { revenue: number; bookings: number; avgValue: number };

function totalsOver(rows: BookingRow[], keys: Set<string>, granularity: "day" | "month"): Totals {
	let revenue = 0;
	let bookings = 0;
	for (const b of rows) {
		const date = ictDateOf(bookingInstant(b));
		const key = granularity === "month" ? date.slice(0, 7) : date;
		if (keys.has(key)) {
			revenue += b.amount_vnd;
			bookings += 1;
		}
	}
	return { revenue, bookings, avgValue: bookings ? Math.round(revenue / bookings) : 0 };
}

/** Current-vs-previous totals for the stat cards (defaults to month-over-month). */
export function periodTotals(
	rows: BookingRow[],
	today: string,
	period: Period = "monthly",
): { current: Totals; previous: Totals } {
	const { current, previous, granularity } = windowFor(period, today);
	return {
		current: totalsOver(rows, new Set(current), granularity),
		previous: totalsOver(rows, new Set(previous), granularity),
	};
}

/** Signed percentage change; null when there is no prior baseline to compare. */
export function pctDelta(current: number, previous: number): number | null {
	if (previous <= 0) {
		return null;
	}
	return Math.round(((current - previous) / previous) * 100);
}

export type CourtStat = {
	id: string;
	name: string;
	isActive: boolean;
	bookings: number;
	revenue: number;
	/** 0–1 share of the busiest court's booking count (for the bar width). */
	share: number;
};

/** Per-court confirmed bookings + revenue for the current ICT month. */
export function byCourt(rows: BookingRow[], courts: CourtRow[], today: string): CourtStat[] {
	const monthKey = today.slice(0, 7);
	const counts = new Map<string, { bookings: number; revenue: number }>();
	for (const b of rows) {
		if (ictDateOf(bookingInstant(b)).slice(0, 7) !== monthKey) {
			continue;
		}
		const c = counts.get(b.court_id) ?? { bookings: 0, revenue: 0 };
		c.bookings += 1;
		c.revenue += b.amount_vnd;
		counts.set(b.court_id, c);
	}
	const max = Math.max(1, ...courts.map((c) => counts.get(c.id)?.bookings ?? 0));
	return courts.map((c) => {
		const stat = counts.get(c.id) ?? { bookings: 0, revenue: 0 };
		return {
			id: c.id,
			name: c.name,
			isActive: c.is_active,
			bookings: stat.bookings,
			revenue: stat.revenue,
			share: stat.bookings / max,
		};
	});
}

export type ActivityKind = "confirmed" | "pending" | "held";
export type ActivityItem = {
	id: string;
	kind: ActivityKind;
	title: string;
	court: string | null;
	at: string;
};

/** Merge the live queues into one recent-activity feed (newest first, top N). */
export function recentActivity(
	pending: BookingRow[],
	held: BookingRow[],
	confirmed: BookingRow[],
	courtNameById: Map<string, string>,
	limit = 6,
): ActivityItem[] {
	const items: ActivityItem[] = [
		...confirmed.map(
			(b): ActivityItem => ({
				id: `c-${b.id}`,
				kind: "confirmed",
				title: `Đã xác nhận · ${b.customer_name}`,
				court: courtNameById.get(b.court_id) ?? null,
				at: b.confirmed_at ?? b.created_at,
			}),
		),
		...pending.map(
			(b): ActivityItem => ({
				id: `p-${b.id}`,
				kind: "pending",
				title: `Yêu cầu mới · ${b.customer_name}`,
				court: courtNameById.get(b.court_id) ?? null,
				at: b.created_at,
			}),
		),
		...held.map(
			(b): ActivityItem => ({
				id: `h-${b.id}`,
				kind: "held",
				title: `Đang giữ chỗ · ${b.customer_name}`,
				court: courtNameById.get(b.court_id) ?? null,
				at: b.created_at,
			}),
		),
	];
	return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Compact VND for chart axes: 1.2tr (million), 800k (thousand), else the number. */
export function formatVndCompact(v: number): string {
	if (v >= 1_000_000) {
		const m = v / 1_000_000;
		return `${m % 1 ? m.toFixed(1) : m.toFixed(0)}tr`;
	}
	if (v >= 1_000) {
		return `${Math.round(v / 1_000)}k`;
	}
	return String(Math.round(v));
}
