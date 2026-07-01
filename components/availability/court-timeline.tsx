"use client";

import { Fragment, useMemo } from "react";
import { minutesToTime, timeToMinutes } from "@/lib/booking/grid";
import type { CourtRow } from "@/lib/queries/types";

/** A committed slot pick: a contiguous span on ONE court, on one ICT date. */
export type SlotSelection = {
	courtId: string;
	courtName: string;
	date: string; // YYYY-MM-DD (ICT)
	startTime: string; // HH:MM
	blockCount: number; // consecutive 30-min blocks
};

/** Live anchor for range-select: the first cell tapped, scoped to a court. */
export type Anchor = { courtId: string; min: number };

/** "Find an opening" filter — duration + time-of-day band. */
export type SlotFilter = {
	durationBlocks: number | null; // 1,2,3,4 … or null (any)
	band: "morning" | "afternoon" | "evening" | null;
};

const ROW_H = 72; // px — court row height (big, tappable; only a few courts)
const HEAD_H = 32; // px — hour header

/** Time-of-day band of a start minute: sáng <11:00, trưa 11–17, tối ≥17:00. */
function bandOf(min: number): "morning" | "afternoon" | "evening" {
	if (min < 660) return "morning";
	if (min < 1020) return "afternoon";
	return "evening";
}

/**
 * Single-day schedule across all courts: one shared hour axis on top, then one
 * fluid row of 30-min blocks per court (courts as rows). Blocks carry no text —
 * the header supplies the time, colour supplies the state: green = free, solid
 * grey = booked/held, amber = your pick. Tap a start block then an end block on
 * the SAME court to select a contiguous range.
 */
export function CourtSchedule({
	courts,
	date,
	occByCourt,
	heldByCourt,
	selection,
	anchor,
	filter,
	today,
	nowMin,
	onCellClick,
}: {
	courts: CourtRow[];
	date: string;
	occByCourt: Map<string, Set<number>>;
	heldByCourt: Map<string, Set<number>>;
	selection: SlotSelection | null;
	anchor: Anchor | null;
	filter?: SlotFilter;
	today: string;
	nowMin: number;
	onCellClick: (court: CourtRow, min: number) => void;
}) {
	// Union operating window across courts → the shared column axis.
	const columns = useMemo(() => {
		let open = Number.POSITIVE_INFINITY;
		let close = Number.NEGATIVE_INFINITY;
		for (const c of courts) {
			open = Math.min(open, timeToMinutes(c.open_time));
			close = Math.max(close, timeToMinutes(c.close_time));
		}
		const cols: { min: number; time: string; isHour: boolean }[] = [];
		if (Number.isFinite(open) && Number.isFinite(close)) {
			for (let m = open; m + 30 <= close; m += 30) {
				cols.push({ min: m, time: minutesToTime(m), isHour: m % 60 === 0 });
			}
		}
		return cols;
	}, [courts]);

	const isPast = (min: number): boolean => date < today || (date === today && min < nowMin);
	const empty = useMemo(() => new Set<number>(), []);
	const lastMin = columns.length ? columns[columns.length - 1].min : 0;

	const filterActive = Boolean(filter && (filter.durationBlocks || filter.band));
	// A free cell "matches" when a contiguous free run of `durationBlocks` (within
	// the chosen band) starts here on this court. No filter → everything matches.
	const isMatch = (occ: Set<number>, cClose: number, min: number): boolean => {
		if (!filterActive || !filter) return true;
		if (filter.band && bandOf(min) !== filter.band) return false;
		const need = filter.durationBlocks ?? 1;
		for (let k = 0; k < need; k++) {
			const m = min + k * 30;
			if (m + 30 > cClose || m > lastMin || isPast(m) || occ.has(m)) return false;
		}
		return true;
	};

	return (
		<div className="flex overflow-hidden rounded-xl bg-card shadow-court-lg ring-1 ring-foreground/10">
			{/* Frozen court-name column — sits OUTSIDE the scroll area, so it never
			    moves however far the time grid is scrolled. */}
			<div
				className="court-grid shrink-0 border-line-strong border-r"
				style={{ width: "var(--namecol, 96px)" }}
			>
				<div className="border-line border-b" style={{ height: HEAD_H }} />
				{courts.map((court) => (
					<div
						key={court.id}
						className="flex items-center justify-center border-line border-b px-1 text-center font-display font-medium text-ink text-sm leading-none"
						style={{ height: ROW_H }}
					>
						{court.name}
					</div>
				))}
			</div>

			{/* Scrollable time grid — headers + one row of blocks per court. */}
			<div className="no-scrollbar flex-1 overflow-x-auto">
				<div
					className="court-grid grid text-[10px]"
					style={{ gridTemplateColumns: `repeat(${columns.length}, var(--cell-w, 48px))` }}
				>
					{/* hour headers (label each :00 column) */}
					{columns.map((c) => (
						<div
							key={`h-${c.min}`}
							className={`flex items-center justify-start overflow-hidden border-line border-b pl-0.5 font-mono text-ink-faint tabular-nums ${
								c.isHour ? "border-line-strong border-l font-semibold text-ink-soft" : ""
							}`}
							style={{ height: HEAD_H }}
						>
							{c.isHour ? c.time.slice(0, 2) : ""}
						</div>
					))}

					{/* one row per court */}
					{courts.map((court) => {
						const occ = occByCourt.get(court.id) ?? empty;
						const held = heldByCourt.get(court.id) ?? empty;
						const cOpen = timeToMinutes(court.open_time);
						const cClose = timeToMinutes(court.close_time);
						const sel = selection && selection.courtId === court.id ? selection : null;
						const selStart = sel ? timeToMinutes(sel.startTime) : null;
						const selEnd = sel && selStart !== null ? selStart + (sel.blockCount - 1) * 30 : null;
						return (
							<Fragment key={court.id}>
								{columns.map((c) => {
									const open = cOpen <= c.min && cClose >= c.min + 30;
									const past = isPast(c.min);
									const occupied = open && occ.has(c.min);
									const isHeld = occupied && held.has(c.min);
									const selected =
										selStart !== null && selEnd !== null && c.min >= selStart && c.min <= selEnd;
									const isAnchor = !sel && anchor?.courtId === court.id && anchor.min === c.min;
									const disabled = !open || past || occupied;

									let cls =
										"flex items-center justify-center border-line/60 border-b transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus focus-visible:ring-inset";
									cls += c.isHour ? " border-line-strong border-l" : " border-line/50 border-l";
									if (!open) {
										cls += " bg-paper opacity-30 cursor-not-allowed";
									} else if (past) {
										cls += " bg-paper opacity-40 cursor-not-allowed";
									} else if (selected) {
										cls += " bg-accent-focus cursor-pointer";
									} else if (isAnchor) {
										cls +=
											" bg-accent-focus-soft ring-2 ring-accent-focus ring-inset cursor-pointer animate-[live-pulse_2s_ease-in-out_infinite]";
									} else if (occupied) {
										cls += " bg-booked cursor-not-allowed";
									} else {
										cls += " bg-court-200 hover:bg-court-300 cursor-pointer";
										if (filterActive && !isMatch(occ, cClose, c.min)) cls += " opacity-30";
									}

									const label = `${court.name} ${c.time} — ${
										!open
											? "đóng"
											: isHeld
												? "đang giữ chỗ"
												: occupied
													? "đã đặt"
													: past
														? "đã qua"
														: selected
															? "bạn chọn"
															: "còn trống"
									}`;

									return (
										<button
											key={`${court.id}-${c.min}`}
											type="button"
											disabled={disabled}
											aria-label={label}
											aria-pressed={selected}
											title={label}
											onClick={() => onCellClick(court, c.min)}
											style={{ height: ROW_H }}
											className={cls}
										>
											{isHeld ? (
												<span className="text-[9px] text-booked-ink" aria-hidden="true">
													⏳
												</span>
											) : null}
										</button>
									);
								})}
							</Fragment>
						);
					})}
				</div>
			</div>
		</div>
	);
}
