"use client";

import { useMemo } from "react";
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

const ROW_MIN_H = 48; // px — WCAG-comfortable tap target

type CellState = "available" | "selected" | "anchor" | "booked" | "held" | "past";

/**
 * One court's schedule for a single ICT day: a wrap-grid of 30-min slot buttons
 * from the court's open_time to close_time. Border-only = available (quiet),
 * solid amber = your selection (the one focal point), solid grey = booked/held,
 * ghosted = past. Tap a start cell then an end cell (same court) to pick a range.
 */
export function CourtTimeline({
	court,
	date,
	occupied,
	held,
	selection,
	anchor,
	today,
	nowMin,
	onCellClick,
}: {
	court: CourtRow;
	date: string;
	occupied: Set<number>;
	held: Set<number>;
	selection: SlotSelection | null;
	anchor: Anchor | null;
	today: string;
	nowMin: number;
	onCellClick: (court: CourtRow, min: number) => void;
}) {
	const blocks = useMemo(() => {
		const open = timeToMinutes(court.open_time);
		const close = timeToMinutes(court.close_time);
		const out: number[] = [];
		for (let m = open; m + 30 <= close; m += 30) out.push(m);
		return out;
	}, [court.open_time, court.close_time]);

	const sel = selection && selection.courtId === court.id ? selection : null;
	const selStart = sel ? timeToMinutes(sel.startTime) : null;
	const selEnd = sel ? timeToMinutes(sel.startTime) + (sel.blockCount - 1) * 30 : null;

	const freeCount = blocks.filter(
		(m) => !occupied.has(m) && !(date < today || (date === today && m < nowMin)),
	).length;

	function stateOf(min: number): CellState {
		const past = date < today || (date === today && min < nowMin);
		if (selStart !== null && selEnd !== null && min >= selStart && min <= selEnd) return "selected";
		if (!selection && anchor && anchor.courtId === court.id && anchor.min === min) return "anchor";
		if (occupied.has(min)) return held.has(min) ? "held" : "booked";
		if (past) return "past";
		return "available";
	}

	const cls: Record<CellState, string> = {
		available:
			"border border-court-300 bg-paper-raised text-court-800 hover:bg-court-50 hover:border-court-500 cursor-pointer",
		selected:
			"border border-accent-focus bg-accent-focus text-on-accent-focus font-semibold shadow-court cursor-pointer",
		anchor:
			"border-2 border-accent-focus bg-accent-focus-soft text-accent-focus-hover font-semibold ring-2 ring-accent-focus/30 animate-[live-pulse_2s_ease-in-out_infinite] cursor-pointer",
		booked: "net-hatch border border-booked-line bg-booked text-booked-ink cursor-not-allowed",
		held: "net-hatch border border-booked-line bg-booked text-booked-ink cursor-not-allowed",
		past: "border border-dashed border-line bg-transparent text-ink-faint/50 cursor-not-allowed",
	};

	return (
		<section className="rounded-xl bg-card p-4 shadow-court ring-1 ring-foreground/10">
			<div className="mb-3 flex items-center justify-between gap-3">
				<h3 className="font-display text-lg font-semibold tracking-tight text-ink">{court.name}</h3>
				<span className="text-xs font-medium text-ink-faint">
					{freeCount > 0 ? `${freeCount} khung trống` : "Kín lịch"}
				</span>
			</div>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2">
				{blocks.map((min) => {
					const state = stateOf(min);
					const disabled = state === "booked" || state === "held" || state === "past";
					const label = `${court.name} lúc ${minutesToTime(min)} — ${
						state === "held"
							? "đang giữ chỗ"
							: state === "booked"
								? "đã đặt"
								: state === "past"
									? "đã qua"
									: state === "selected"
										? "bạn đang chọn"
										: "còn trống"
					}`;
					return (
						<button
							key={min}
							type="button"
							disabled={disabled}
							aria-label={label}
							aria-pressed={state === "selected"}
							title={label}
							onClick={() => onCellClick(court, min)}
							style={{ minHeight: ROW_MIN_H }}
							className={`flex flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2 font-mono text-[13px] tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus focus-visible:ring-offset-1 ${cls[state]}`}
						>
							<span>{minutesToTime(min)}</span>
							{state === "held" && (
								<span className="text-[10px]" aria-hidden="true">
									⏳
								</span>
							)}
						</button>
					);
				})}
			</div>
		</section>
	);
}
