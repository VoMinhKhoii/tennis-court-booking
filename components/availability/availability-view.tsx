"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GridLegend } from "@/components/ui/legend";
import { MiniCalendar } from "@/components/ui/mini-calendar";
import { ICT_OFFSET_MINUTES, MAX_BLOCK_COUNT } from "@/lib/booking/constants";
import { ictToday } from "@/lib/booking/dates";
import { formatVnd } from "@/lib/booking/format";
import {
	addDays,
	minutesToTime,
	monthStartOf,
	rangeIctBlockStarts,
	timeToMinutes,
} from "@/lib/booking/grid";
import { computeAmountVnd } from "@/lib/booking/pricing";
import { useAvailabilityAllCourts, useAvailabilityAllRealtime } from "@/lib/queries/availability";
import { usePublicCourts, usePublicSettings } from "@/lib/queries/public";
import type { CourtRow } from "@/lib/queries/types";
import { type Anchor, CourtTimeline, type SlotSelection } from "./court-timeline";

const DAYS_AHEAD = 60;
const VI_DOW_LONG = ["CN", "Th 2", "Th 3", "Th 4", "Th 5", "Th 6", "Th 7"];

function dayLabel(date: string): string {
	const [y, m, d] = date.split("-").map(Number);
	const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return `${VI_DOW_LONG[dow]}, ${d}/${m}`;
}

/**
 * Public booking surface: pick a day (defaults to today, or tomorrow once every
 * court has closed), then read each court's own live schedule as a stacked
 * timeline. Available slots are quiet outlines, a pick is a solid amber span,
 * booked/held are grey — tap a start then end cell on ONE court to select a
 * range, then continue to checkout. One-off bookings only.
 */
export function AvailabilityView() {
	const router = useRouter();
	const { data: courts, isLoading, isError } = usePublicCourts();
	const { data: settings } = usePublicSettings();
	const activeCourts = useMemo(() => (courts ?? []).filter((c) => c.is_active), [courts]);
	const courtIds = useMemo(() => activeCourts.map((c) => c.id), [activeCourts]);

	const today = useMemo(() => ictToday(), []);
	const minDate = today;
	const maxDate = useMemo(() => addDays(today, DAYS_AHEAD), [today]);

	const nowMin = useMemo(() => {
		const d = new Date();
		const utc = d.getUTCHours() * 60 + d.getUTCMinutes();
		return (((utc + ICT_OFFSET_MINUTES) % 1440) + 1440) % 1440;
	}, []);

	const [date, setDate] = useState(today);
	const [selection, setSelection] = useState<SlotSelection | null>(null);
	const [anchor, setAnchor] = useState<Anchor | null>(null);
	const [calOpen, setCalOpen] = useState(false);

	// Once courts load, if it's already past the latest closing time, default the
	// view to tomorrow — today has nothing left to book. Runs once.
	const didInitDate = useRef(false);
	useEffect(() => {
		if (didInitDate.current || activeCourts.length === 0) return;
		didInitDate.current = true;
		const latestClose = Math.max(...activeCourts.map((c) => timeToMinutes(c.close_time)));
		if (nowMin >= latestClose) setDate(addDays(today, 1));
	}, [activeCourts, nowMin, today]);

	useAvailabilityAllRealtime(courtIds);
	const month = useMemo(() => monthStartOf(date), [date]);
	const availability = useAvailabilityAllCourts(month);

	// date -> court -> { occupied (any), held-only } block-start minutes.
	const { occByCourt, heldByCourt } = useMemo(() => {
		const firm = new Map<string, Set<number>>();
		const held = new Map<string, Set<number>>();
		for (const row of availability.data ?? []) {
			if (row.slot_date !== date) continue;
			const target = row.held ? held : firm;
			let set = target.get(row.court_id);
			if (!set) {
				set = new Set<number>();
				target.set(row.court_id, set);
			}
			for (const min of rangeIctBlockStarts(row.time_range)) set.add(min);
		}
		// occupied = firm ∪ held; heldOnly = held minus firm.
		const occ = new Map<string, Set<number>>();
		const heldOnly = new Map<string, Set<number>>();
		for (const id of courtIds) {
			const f = firm.get(id) ?? new Set<number>();
			const h = held.get(id) ?? new Set<number>();
			occ.set(id, new Set([...f, ...h]));
			heldOnly.set(id, new Set([...h].filter((m) => !f.has(m))));
		}
		return { occByCourt: occ, heldByCourt: heldOnly };
	}, [availability.data, date, courtIds]);

	function resetPick() {
		setSelection(null);
		setAnchor(null);
	}

	function changeDate(next: string) {
		setDate(next);
		resetPick();
	}

	const isPast = (min: number): boolean => date < today || (date === today && min < nowMin);

	// Tap 1 (or a tap on another court) seeds a 1-block pick + anchor; tap 2 on the
	// same court extends the span from the anchor, stopping at the first blocked or
	// past block (or the court's close / max length).
	function handleCellClick(court: CourtRow, min: number) {
		if (!anchor || anchor.courtId !== court.id) {
			setAnchor({ courtId: court.id, min });
			setSelection({
				courtId: court.id,
				courtName: court.name,
				date,
				startTime: minutesToTime(min),
				blockCount: 1,
			});
			return;
		}
		const occ = occByCourt.get(court.id) ?? new Set<number>();
		const closeMin = timeToMinutes(court.close_time);
		const lo = Math.min(anchor.min, min);
		const hiTarget = Math.max(anchor.min, min);
		let count = 1;
		for (let m = lo + 30; m <= hiTarget; m += 30) {
			if (m + 30 > closeMin || occ.has(m) || isPast(m) || count >= MAX_BLOCK_COUNT) break;
			count += 1;
		}
		const hi = lo + (count - 1) * 30;
		setSelection({
			courtId: court.id,
			courtName: court.name,
			date,
			startTime: minutesToTime(lo),
			blockCount: count,
		});
		setAnchor(null);
		if (hi < hiTarget) {
			toast.warning("Một số khung giờ đã kín — đã chọn đến khung trống cuối.");
		}
	}

	const rate = settings?.flat_hourly_rate_vnd ?? 0;
	const amount = selection && rate > 0 ? computeAmountVnd(rate, selection.blockCount, 1) : null;
	const endTime = selection
		? minutesToTime(timeToMinutes(selection.startTime) + selection.blockCount * 30)
		: null;

	// Carry the locked slot (incl. the chosen court) to hosted checkout via query
	// params. A real route — not a modal — is what makes checkout survive a reload.
	function buildBookHref(): string {
		if (!selection) return "/book";
		const p = new URLSearchParams({
			type: "adhoc",
			date: selection.date,
			start: selection.startTime,
			dur: String(selection.blockCount),
			court: selection.courtId,
			lock: "1",
		});
		return `/book?${p.toString()}`;
	}

	if (isLoading) {
		return <p className="text-sm text-ink-faint">Đang tải sân…</p>;
	}
	if (isError) {
		return <p className="text-sm text-signal-red">Không tải được danh sách sân.</p>;
	}
	if (activeCourts.length === 0) {
		return <p className="text-sm text-ink-faint">Hiện chưa có sân nào mở đặt.</p>;
	}

	return (
		<div className="space-y-5 pb-28">
			{/* Date bar: prev/next day + calendar + quick chips, with a live badge. */}
			<div className="flex flex-wrap items-center gap-3">
				<div className="flex items-center gap-1">
					<Button
						variant="outline"
						size="icon"
						aria-label="Ngày trước"
						disabled={date <= minDate}
						onClick={() => changeDate(addDays(date, -1))}
					>
						<ChevronLeft />
					</Button>
					<div className="relative">
						<button
							type="button"
							onClick={() => setCalOpen((o) => !o)}
							className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-paper-raised px-3 font-display text-sm font-bold text-ink transition-colors hover:border-court-500"
							aria-haspopup="dialog"
							aria-expanded={calOpen}
						>
							<CalendarDays className="h-4 w-4 text-ink-soft" />
							{dayLabel(date)}
						</button>
						{calOpen && (
							<MiniCalendar
								value={date}
								min={minDate}
								max={maxDate}
								onChange={changeDate}
								onClose={() => setCalOpen(false)}
							/>
						)}
					</div>
					<Button
						variant="outline"
						size="icon"
						aria-label="Ngày sau"
						disabled={date >= maxDate}
						onClick={() => changeDate(addDays(date, 1))}
					>
						<ChevronRight />
					</Button>
				</div>

				<div className="flex items-center gap-1">
					<QuickChip active={date === today} onClick={() => changeDate(today)}>
						Hôm nay
					</QuickChip>
					<QuickChip
						active={date === addDays(today, 1)}
						onClick={() => changeDate(addDays(today, 1))}
					>
						Ngày mai
					</QuickChip>
				</div>

				<span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-ink-soft">
					<span className="h-2 w-2 rounded-full bg-accent-teal animate-[live-pulse_2s_ease-in-out_infinite]" />
					TRỰC TIẾP
				</span>
			</div>

			<GridLegend />

			{availability.isLoading ? (
				<p className="px-1 py-8 text-sm text-ink-faint">Đang tải lịch…</p>
			) : availability.isError ? (
				<p className="px-1 py-8 text-sm text-signal-red">Không tải được lịch. Vui lòng thử lại.</p>
			) : (
				<div className="space-y-4">
					{activeCourts.map((court) => (
						<CourtTimeline
							key={court.id}
							court={court}
							date={date}
							occupied={occByCourt.get(court.id) ?? new Set<number>()}
							held={heldByCourt.get(court.id) ?? new Set<number>()}
							selection={selection}
							anchor={anchor}
							today={today}
							nowMin={nowMin}
							onCellClick={handleCellClick}
						/>
					))}
				</div>
			)}

			{/* Sticky selection summary */}
			{selection && (
				<div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper-raised/95 px-4 py-3 shadow-pop backdrop-blur supports-backdrop-filter:bg-paper-raised/80">
					<div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
						<div className="min-w-0">
							<div className="truncate font-mono text-sm font-bold tabular-nums text-ink">
								{selection.startTime}–{endTime}{" "}
								<span className="font-sans font-normal text-ink-faint">
									({selection.blockCount / 2} giờ)
								</span>
							</div>
							<div className="truncate text-xs text-ink-soft">
								{selection.courtName} · {dayLabel(selection.date)}
								{amount !== null ? ` · ${formatVnd(amount)}` : ""}
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<Button variant="ghost" size="sm" onClick={resetPick}>
								Bỏ chọn
							</Button>
							<Button variant="accent" size="lg" onClick={() => router.push(buildBookHref())}>
								Tiếp tục đặt
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function QuickChip({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
				active
					? "bg-primary text-on-dark"
					: "border border-line-strong bg-paper-raised text-ink-soft hover:border-court-500"
			}`}
		>
			{children}
		</button>
	);
}
