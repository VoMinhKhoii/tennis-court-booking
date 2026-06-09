"use client";

import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { ICT_OFFSET_MINUTES, MAX_BLOCK_COUNT } from "@/lib/booking/constants";
import { ictToday } from "@/lib/booking/dates";
import {
	datesInWeek,
	minutesToTime,
	monthStartOf,
	rangeIctBlockStarts,
	timeToMinutes,
} from "@/lib/booking/grid";
import { useAvailabilityAllCourts, useAvailabilityAllRealtime } from "@/lib/queries/availability";
import type { CourtRow } from "@/lib/queries/types";

/** A committed slot pick: a contiguous span on one ICT date. */
export type SlotSelection = {
	date: string; // YYYY-MM-DD (ICT)
	startTime: string; // HH:MM
	blockCount: number; // consecutive 30-min blocks
};

/** Ad-hoc "find an opening" filter — duration + time-of-day band. */
export type SlotFilter = {
	durationBlocks: number | null; // 1,2,3,4 … or null (any)
	band: "morning" | "afternoon" | "evening" | null;
};

const DATECOL = 72; // px — sticky date column width
const ROW_H = 46; // px — row height (tap target; columns are fluid)
const HEAD_H = 30; // px

const VI_DOW = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function dayParts(date: string): { dow: string; dm: string } {
	const [y, m, d] = date.split("-").map(Number);
	const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return { dow: VI_DOW[dow], dm: `${d}/${m}` };
}

/** Band of a start minute: morning <12:00, afternoon 12–17, evening ≥17:00. */
function bandOf(min: number): "morning" | "afternoon" | "evening" {
	if (min < 720) return "morning";
	if (min < 1020) return "afternoon";
	return "evening";
}

/** Green intensity by how many courts are free (more free → more inviting). */
function freeClass(free: number, total: number): string {
	const ratio = total > 0 ? free / total : 0;
	if (ratio >= 0.75) return "bg-court-300 hover:bg-court-400 text-court-950";
	if (ratio >= 0.5) return "bg-court-200 hover:bg-court-300 text-court-900";
	if (ratio >= 0.25) return "bg-court-100 hover:bg-court-200 text-court-800";
	return "bg-court-50 hover:bg-court-100 text-court-700";
}

/**
 * Weekly scoreboard grid across ALL courts: dates as rows, 30-min blocks as
 * columns that fill the width (no horizontal scroll). Each cell shows how many
 * courts are free; the server later auto-assigns one. Tap a free start cell then
 * an end cell (same row) to select a contiguous range. Live via every court's
 * public Broadcast channel.
 */
export function SlotGrid({
	courts,
	weekStart,
	selection,
	onSelect,
	filter,
}: {
	courts: CourtRow[];
	weekStart: string;
	selection: SlotSelection | null;
	onSelect: (sel: SlotSelection | null) => void;
	filter?: SlotFilter;
}) {
	const courtIds = useMemo(() => courts.map((c) => c.id), [courts]);
	useAvailabilityAllRealtime(courtIds);

	const dates = useMemo(() => datesInWeek(weekStart), [weekStart]);
	const months = useMemo(() => {
		const a = monthStartOf(dates[0]);
		const b = monthStartOf(dates[6]);
		return a === b ? [a] : [a, b];
	}, [dates]);

	// A week can straddle a month boundary; fetch both (React Query dedupes).
	const a1 = useAvailabilityAllCourts(months[0]);
	const a2 = useAvailabilityAllCourts(months[1] ?? months[0]);

	// date -> (blockMin -> set of occupied court ids); plus a parallel map of the
	// court ids occupied ONLY by a live soft-hold, so a slot blocked solely by holds
	// can render "⏳ đang giữ chỗ" instead of "kín sân".
	const { occByDate, heldByDate } = useMemo(() => {
		const occ = new Map<string, Map<number, Set<string>>>();
		const held = new Map<string, Map<number, Set<string>>>();
		const rows = [...(a1.data ?? []), ...(months[1] ? (a2.data ?? []) : [])];
		for (const row of rows) {
			let byMin = occ.get(row.slot_date);
			if (!byMin) {
				byMin = new Map<number, Set<string>>();
				occ.set(row.slot_date, byMin);
			}
			let heldByMin: Map<number, Set<string>> | undefined;
			if (row.held) {
				heldByMin = held.get(row.slot_date);
				if (!heldByMin) {
					heldByMin = new Map<number, Set<string>>();
					held.set(row.slot_date, heldByMin);
				}
			}
			for (const min of rangeIctBlockStarts(row.time_range)) {
				let set = byMin.get(min);
				if (!set) {
					set = new Set<string>();
					byMin.set(min, set);
				}
				set.add(row.court_id);
				if (heldByMin) {
					let hset = heldByMin.get(min);
					if (!hset) {
						hset = new Set<string>();
						heldByMin.set(min, hset);
					}
					hset.add(row.court_id);
				}
			}
		}
		return { occByDate: occ, heldByDate: held };
	}, [a1.data, a2.data, months]);

	// Union operating window + per-block count of courts that are open.
	const { columns, openCountByMin } = useMemo(() => {
		let open = Number.POSITIVE_INFINITY;
		let close = Number.NEGATIVE_INFINITY;
		for (const c of courts) {
			open = Math.min(open, timeToMinutes(c.open_time));
			close = Math.max(close, timeToMinutes(c.close_time));
		}
		const cols: { min: number; time: string; isHour: boolean }[] = [];
		const counts = new Map<number, number>();
		if (Number.isFinite(open) && Number.isFinite(close)) {
			for (let m = open; m + 30 <= close; m += 30) {
				cols.push({ min: m, time: minutesToTime(m), isHour: m % 60 === 0 });
				let n = 0;
				for (const c of courts) {
					if (timeToMinutes(c.open_time) <= m && timeToMinutes(c.close_time) >= m + 30) n += 1;
				}
				counts.set(m, n);
			}
		}
		return { columns: cols, openCountByMin: counts };
	}, [courts]);

	const total = courts.length;
	const today = useMemo(() => ictToday(), []);
	const nowMin = useMemo(() => {
		const d = new Date();
		const utc = d.getUTCHours() * 60 + d.getUTCMinutes();
		return (((utc + ICT_OFFSET_MINUTES) % 1440) + 1440) % 1440;
	}, []);
	const lastColMin = columns.length ? columns[columns.length - 1].min : 0;

	const [anchor, setAnchor] = useState<{ date: string; min: number } | null>(null);

	const isPast = (date: string, min: number): boolean =>
		date < today || (date === today && min < nowMin);

	const freeAt = (date: string, min: number): number =>
		(openCountByMin.get(min) ?? 0) - (occByDate.get(date)?.get(min)?.size ?? 0);

	// True when every court occupying this block is occupied only by a live hold
	// (no confirmed/pending), so the block reads "⏳ đang giữ chỗ".
	const isHeldOnly = (date: string, min: number): boolean => {
		const occ = occByDate.get(date)?.get(min)?.size ?? 0;
		if (occ === 0) return false;
		return (heldByDate.get(date)?.get(min)?.size ?? 0) >= occ;
	};

	// Ad-hoc filter: does a contiguous free run of `durationBlocks` (within `band`)
	// start at this cell? With no filter set, every free cell "matches".
	const filterActive = Boolean(filter && (filter.durationBlocks || filter.band));
	const isMatch = (date: string, min: number): boolean => {
		if (!filterActive || !filter) return true;
		if (filter.band && bandOf(min) !== filter.band) return false;
		const need = filter.durationBlocks ?? 1;
		for (let k = 0; k < need; k++) {
			const m = min + k * 30;
			if (m > lastColMin || isPast(date, m) || freeAt(date, m) <= 0) return false;
		}
		return true;
	};

	function handleClick(date: string, min: number) {
		if (selection || !anchor || anchor.date !== date) {
			setAnchor({ date, min });
			if (selection) onSelect(null);
			return;
		}
		const lo = Math.min(anchor.min, min);
		const hiTarget = Math.max(anchor.min, min);
		let count = 1;
		for (let m = lo + 30; m <= hiTarget; m += 30) {
			if (m > lastColMin || freeAt(date, m) <= 0 || isPast(date, m) || count >= MAX_BLOCK_COUNT) {
				break;
			}
			count += 1;
		}
		const hi = lo + (count - 1) * 30;
		onSelect({ date, startTime: minutesToTime(lo), blockCount: count });
		setAnchor(null);
		if (hi < hiTarget) {
			toast.warning("Một số khung giờ đã kín — đã chọn đến khung trống cuối.");
		}
	}

	// A week can straddle two months; gate on BOTH queries so the second month's
	// days don't render as falsely free while a2 is still loading/errored.
	const needsSecondMonth = Boolean(months[1]);
	if (a1.isLoading || (needsSecondMonth && a2.isLoading)) {
		return <p className="px-1 py-8 text-sm text-ink-faint">Đang tải lịch…</p>;
	}
	if (a1.isError || (needsSecondMonth && a2.isError)) {
		return (
			<p className="px-1 py-8 text-sm text-signal-red">Không tải được lịch. Vui lòng thử lại.</p>
		);
	}

	return (
		<div className="rounded-xl border border-line bg-paper-raised/90 shadow-court backdrop-blur">
			<div
				className="grid font-mono text-[11px] tabular-nums"
				style={{ gridTemplateColumns: `${DATECOL}px repeat(${columns.length}, minmax(0, 1fr))` }}
			>
				{/* corner */}
				<div
					className="sticky left-0 z-30 rounded-tl-xl border-b border-line bg-paper-raised"
					style={{ height: HEAD_H }}
				/>
				{/* hour headers (label on each :00 column) */}
				{columns.map((c) => (
					<div
						key={`h-${c.min}`}
						className={`flex items-center justify-start overflow-hidden border-b border-line bg-paper-raised pl-0.5 text-ink-faint ${
							c.isHour ? "border-l border-line-strong font-semibold text-ink-soft" : ""
						}`}
						style={{ height: HEAD_H }}
					>
						{c.isHour ? c.time.slice(0, 2) : ""}
					</div>
				))}

				{/* rows */}
				{dates.map((date) => {
					const { dow, dm } = dayParts(date);
					const isToday = date === today;
					const selStart = selection?.date === date ? timeToMinutes(selection.startTime) : null;
					const selEnd =
						selStart !== null ? selStart + ((selection?.blockCount ?? 1) - 1) * 30 : null;
					return (
						<Fragment key={date}>
							<div
								className={`sticky left-0 z-10 flex flex-col justify-center border-b border-line px-2 ${
									isToday ? "bg-court-50" : "bg-paper-raised"
								}`}
								style={{ height: ROW_H }}
							>
								<span
									className={`font-display text-xs font-bold leading-none ${
										isToday ? "text-court-800" : "text-ink"
									}`}
								>
									{dow}
								</span>
								<span className="mt-0.5 text-[10px] leading-none text-ink-faint">{dm}</span>
							</div>
							{columns.map((c) => {
								const open = (openCountByMin.get(c.min) ?? 0) > 0;
								const past = isPast(date, c.min);
								const free = freeAt(date, c.min);
								const selected =
									selStart !== null && selEnd !== null && c.min >= selStart && c.min <= selEnd;
								const isAnchor = !selection && anchor?.date === date && anchor.min === c.min;
								const occupied = open && free <= 0;
								const heldOnly = occupied && isHeldOnly(date, c.min);
								const dimmed =
									filterActive && !selected && free > 0 && !past && !isMatch(date, c.min);
								const disabled = !open || past || occupied;

								let cls =
									"flex items-center justify-center border-b border-line/60 text-[10px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-court-600 focus-visible:ring-inset";
								cls += c.isHour ? " border-l border-line-strong" : " border-l border-line/50";
								if (!open) {
									cls += " bg-paper opacity-30 cursor-not-allowed";
								} else if (past) {
									cls += " bg-paper opacity-40 cursor-not-allowed";
								} else if (heldOnly) {
									cls += " net-hatch bg-signal-amber-soft text-signal-amber cursor-not-allowed";
								} else if (occupied) {
									cls += " net-hatch bg-chalk cursor-not-allowed";
								} else if (selected) {
									cls += " bg-court-600 text-white cursor-pointer";
								} else if (isAnchor) {
									cls +=
										" bg-court-200 ring-2 ring-court-600 ring-inset animate-[live-pulse_2s_ease-in-out_infinite] cursor-pointer";
								} else {
									cls += ` ${freeClass(free, total)} cursor-pointer`;
									if (dimmed) cls += " opacity-35";
								}

								const label = `${dow} ${dm} lúc ${c.time} — ${
									!open
										? "đóng"
										: heldOnly
											? "đang giữ chỗ"
											: occupied
												? "kín sân"
												: past
													? "đã qua"
													: `còn ${free} sân`
								}`;

								return (
									<button
										key={`${date}-${c.min}`}
										type="button"
										disabled={disabled}
										aria-label={label}
										aria-pressed={selected}
										title={label}
										onClick={() => handleClick(date, c.min)}
										className={cls}
										style={{ height: ROW_H }}
									>
										{heldOnly ? (
											<span aria-hidden="true">⏳</span>
										) : !disabled && !selected && total > 1 ? (
											free
										) : (
											""
										)}
									</button>
								);
							})}
						</Fragment>
					);
				})}
			</div>
		</div>
	);
}
