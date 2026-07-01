"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { GridLegend } from "@/components/ui/legend";
import { enumerateSlotDates, ictToday } from "@/lib/booking/dates";
import { formatVnd } from "@/lib/booking/format";
import {
	addDays,
	datesInWeek,
	minutesToTime,
	monthStartOf,
	timeToMinutes,
	weekStartOf,
} from "@/lib/booking/grid";
import { computeAmountVnd } from "@/lib/booking/pricing";
import { usePublicCourts, usePublicSettings } from "@/lib/queries/public";
import { type SlotFilter, SlotGrid, type SlotSelection } from "./slot-grid";

const WEEKS_AHEAD = 8;

const DURATIONS = [
	{ blocks: 1, label: "30p" },
	{ blocks: 2, label: "1 giờ" },
	{ blocks: 3, label: "1,5 giờ" },
	{ blocks: 4, label: "2 giờ" },
] as const;

const BANDS = [
	{ value: "morning", label: "Sáng" },
	{ value: "afternoon", label: "Chiều" },
	{ value: "evening", label: "Tối" },
] as const;

function weekdayOf(date: string): number {
	const [y, m, d] = date.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function shortDM(date: string): string {
	const [, m, d] = date.split("-").map(Number);
	return `${d}/${m}`;
}

/**
 * Public availability surface: scan the live scoreboard grid across ALL courts
 * (each cell shows how many are free), tap a start/end to select a range, and
 * book in a bottom sheet without leaving the page. One-off mode adds a quick
 * "find an opening" filter; monthly applies the pick as a recurring weekday.
 */
export function AvailabilityView() {
	const router = useRouter();
	const { data: courts, isLoading, isError } = usePublicCourts();
	const { data: settings } = usePublicSettings();
	const activeCourts = useMemo(() => (courts ?? []).filter((c) => c.is_active), [courts]);

	const today = useMemo(() => ictToday(), []);
	const thisWeek = useMemo(() => weekStartOf(today), [today]);
	const maxWeek = useMemo(() => addDays(thisWeek, 7 * WEEKS_AHEAD), [thisWeek]);

	const [weekStart, setWeekStart] = useState(thisWeek);
	const [mode, setMode] = useState<"adhoc" | "monthly">("adhoc");
	const [selection, setSelection] = useState<SlotSelection | null>(null);
	const [filter, setFilter] = useState<SlotFilter>({ durationBlocks: null, band: null });

	const weekDates = useMemo(() => datesInWeek(weekStart), [weekStart]);

	function resetPick() {
		setSelection(null);
	}

	const rate = settings?.flat_hourly_rate_vnd ?? 0;
	const sessions = useMemo(() => {
		if (!selection) return 0;
		if (mode === "adhoc") return 1;
		return enumerateSlotDates(
			{ type: "monthly", month: monthStartOf(selection.date), weekday: weekdayOf(selection.date) },
			today,
		).length;
	}, [selection, mode, today]);

	const amount =
		selection && rate > 0 ? computeAmountVnd(rate, selection.blockCount, sessions) : null;

	// Carry the locked slot to the hosted-checkout page via query params (lock=1
	// keeps the time read-only there). Navigating to a real route — not a modal —
	// is what makes the checkout survive a reload.
	function buildBookHref(): string {
		if (!selection) return "/book";
		const p = new URLSearchParams({
			start: selection.startTime,
			dur: String(selection.blockCount),
			lock: "1",
		});
		if (mode === "adhoc") {
			p.set("type", "adhoc");
			p.set("date", selection.date);
		} else {
			p.set("type", "monthly");
			p.set("month", monthStartOf(selection.date));
			p.set("weekdays", String(weekdayOf(selection.date)));
		}
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

	const endTime = selection
		? minutesToTime(timeToMinutes(selection.startTime) + selection.blockCount * 30)
		: null;

	return (
		<div className="space-y-5 pb-28">
			{/* Mode toggle + live badge */}
			<div className="flex items-center gap-3">
				<div className="flex flex-1 gap-1 rounded-lg border border-line bg-paper/70 p-1">
					{(
						[
							{ value: "adhoc", label: "Một buổi", hint: "Đặt lẻ một ngày" },
							{ value: "monthly", label: "Hàng tháng", hint: "Giữ lịch cố định hằng tuần" },
						] as const
					).map((m) => (
						<button
							key={m.value}
							type="button"
							onClick={() => {
								setMode(m.value);
								resetPick();
							}}
							className={`flex-1 cursor-pointer rounded-md px-3 py-2 text-center transition-colors ${
								mode === m.value
									? "bg-primary text-on-dark shadow-court"
									: "text-ink-soft hover:bg-court-50"
							}`}
						>
							<span className="block text-sm font-semibold">{m.label}</span>
							<span
								className={`block text-[11px] ${mode === m.value ? "text-on-dark/80" : "text-ink-faint"}`}
							>
								{m.hint}
							</span>
						</button>
					))}
				</div>
				<span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-ink-soft">
					<span className="h-2 w-2 rounded-full bg-accent-teal animate-[live-pulse_2s_ease-in-out_infinite]" />
					TRỰC TIẾP
				</span>
			</div>

			{/* Week nav */}
			<div className="flex items-center justify-between gap-2">
				<Button
					variant="outline"
					size="icon"
					aria-label="Tuần trước"
					disabled={weekStart <= thisWeek}
					onClick={() => {
						setWeekStart(addDays(weekStart, -7));
						resetPick();
					}}
				>
					<ChevronLeft />
				</Button>
				<div className="text-center">
					<div className="font-display text-sm font-bold text-ink">
						{shortDM(weekDates[0])} – {shortDM(weekDates[6])}
					</div>
					{weekStart > thisWeek && (
						<button
							type="button"
							onClick={() => {
								setWeekStart(thisWeek);
								resetPick();
							}}
							className="cursor-pointer text-xs text-ink hover:underline"
						>
							Về tuần này
						</button>
					)}
				</div>
				<Button
					variant="outline"
					size="icon"
					aria-label="Tuần sau"
					disabled={weekStart >= maxWeek}
					onClick={() => {
						setWeekStart(addDays(weekStart, 7));
						resetPick();
					}}
				>
					<ChevronRight />
				</Button>
			</div>

			{/* Ad-hoc "find an opening" filter */}
			{mode === "adhoc" && (
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-paper/60 px-3 py-2.5">
					<FilterChips
						label="Thời lượng"
						options={DURATIONS.map((d) => ({ value: String(d.blocks), label: d.label }))}
						active={filter.durationBlocks === null ? null : String(filter.durationBlocks)}
						onPick={(v) =>
							setFilter((f) => ({ ...f, durationBlocks: v === null ? null : Number(v) }))
						}
					/>
					<FilterChips
						label="Buổi"
						options={BANDS.map((b) => ({ value: b.value, label: b.label }))}
						active={filter.band}
						onPick={(v) => setFilter((f) => ({ ...f, band: v as SlotFilter["band"] }))}
					/>
				</div>
			)}

			<GridLegend />

			{mode === "monthly" && (
				<p className="rounded-lg bg-court-25 px-3 py-2 text-xs text-court-800">
					Chọn một khung giờ trống — bạn có thể thêm nhiều thứ trong tuần ở bước tiếp theo. Sân sẽ
					được tự động xếp và giữ đến hết tháng.
				</p>
			)}

			<SlotGrid
				courts={activeCourts}
				weekStart={weekStart}
				selection={selection}
				onSelect={setSelection}
				filter={mode === "adhoc" ? filter : undefined}
			/>

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
								{mode === "monthly"
									? `Mỗi ${["CN", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"][weekdayOf(selection.date)]} · ${sessions} buổi`
									: shortDM(selection.date)}
								{amount !== null ? ` · ${formatVnd(amount)}` : ""}
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<Button variant="ghost" size="sm" onClick={resetPick}>
								Bỏ chọn
							</Button>
							<Button size="lg" onClick={() => router.push(buildBookHref())}>
								Tiếp tục đặt
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

/** A labelled row of single-select toggle chips (tap an active chip to clear). */
function FilterChips({
	label,
	options,
	active,
	onPick,
}: {
	label: string;
	options: { value: string; label: string }[];
	active: string | null;
	onPick: (value: string | null) => void;
}) {
	return (
		<div className="flex items-center gap-1.5">
			<span className="text-xs font-medium text-ink-faint">{label}</span>
			{options.map((o) => {
				const on = active === o.value;
				return (
					<button
						key={o.value}
						type="button"
						onClick={() => onPick(on ? null : o.value)}
						className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
							on
								? "bg-primary text-on-dark"
								: "border border-line-strong bg-paper-raised text-ink-soft hover:border-court-400"
						}`}
					>
						{o.label}
					</button>
				);
			})}
		</div>
	);
}
