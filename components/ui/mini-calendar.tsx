"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addDays, datesInMonth, monthStartOf } from "@/lib/booking/grid";

const VI_DOW = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]; // Monday-first

function monthTitle(monthStart: string): string {
	const [y, m] = monthStart.split("-").map(Number);
	return `Tháng ${m}, ${y}`;
}

/** Days-since-Monday (0..6) for a YYYY-MM-DD date — for grid leading offset. */
function mondayOffset(date: string): number {
	const [y, m, d] = date.split("-").map(Number);
	return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * A compact month-grid date picker in a click-outside popover. No dependency —
 * built on the app's timezone-pure date helpers. Selectable range is clamped to
 * [min, max] (ICT YYYY-MM-DD). Selecting a day fires onChange and closes.
 */
export function MiniCalendar({
	value,
	min,
	max,
	onChange,
	onClose,
}: {
	value: string;
	min: string;
	max: string;
	onChange: (date: string) => void;
	onClose: () => void;
}) {
	const [view, setView] = useState(() => monthStartOf(value));
	const ref = useRef<HTMLDivElement>(null);

	// Close on outside click / Escape.
	useEffect(() => {
		function onDown(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [onClose]);

	const days = datesInMonth(view);
	const lead = mondayOffset(days[0]);
	const minMonth = monthStartOf(min);
	const maxMonth = monthStartOf(max);

	return (
		<div
			ref={ref}
			className="absolute left-1/2 top-full z-50 mt-2 w-[19rem] -translate-x-1/2 rounded-xl border border-line bg-paper-raised p-3 shadow-court-lg"
			role="dialog"
			aria-label="Chọn ngày"
		>
			<div className="mb-2 flex items-center justify-between">
				<button
					type="button"
					disabled={view <= minMonth}
					onClick={() => setView(monthStartOf(addDays(view, -1)))}
					className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-court-50 disabled:opacity-30 disabled:hover:bg-transparent"
					aria-label="Tháng trước"
				>
					<ChevronLeft className="h-4 w-4" />
				</button>
				<span className="font-display text-sm font-semibold text-ink">{monthTitle(view)}</span>
				<button
					type="button"
					disabled={view >= maxMonth}
					onClick={() => setView(monthStartOf(addDays(datesInMonth(view).at(-1) ?? view, 1)))}
					className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-court-50 disabled:opacity-30 disabled:hover:bg-transparent"
					aria-label="Tháng sau"
				>
					<ChevronRight className="h-4 w-4" />
				</button>
			</div>

			<div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-ink-faint">
				{VI_DOW.map((d) => (
					<span key={d}>{d}</span>
				))}
			</div>

			<div className="grid grid-cols-7 gap-1">
				{Array.from({ length: lead }, (_, i) => (
					<span key={`lead-${addDays(days[0], i - lead)}`} />
				))}
				{days.map((d) => {
					const disabled = d < min || d > max;
					const selected = d === value;
					const dayNum = Number(d.slice(-2));
					return (
						<button
							key={d}
							type="button"
							disabled={disabled}
							aria-pressed={selected}
							onClick={() => {
								onChange(d);
								onClose();
							}}
							className={`flex h-9 items-center justify-center rounded-lg font-mono text-[13px] tabular-nums transition-colors ${
								selected
									? "bg-accent-focus font-semibold text-on-accent-focus"
									: disabled
										? "cursor-not-allowed text-ink-faint/40"
										: "text-ink hover:bg-court-50"
							}`}
						>
							{dayNum}
						</button>
					);
				})}
			</div>
		</div>
	);
}
