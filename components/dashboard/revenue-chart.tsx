"use client";

import { useMemo, useState } from "react";
import { ictToday } from "@/lib/booking/dates";
import { monthLabel, monthStartOf } from "@/lib/booking/grid";
import {
	formatVndCompact,
	type Period,
	revenueSeries,
	type SeriesPoint,
} from "@/lib/dashboard/metrics";
import { useConfirmedBookings } from "@/lib/queries/dashboard";
import { cn } from "@/lib/utils";

const W = 760;
const H = 260;
const PAD = { top: 16, right: 14, bottom: 28, left: 50 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const BASELINE = PAD.top + PLOT_H;

const PERIODS: { key: Period; label: string }[] = [
	{ key: "weekly", label: "Tuần" },
	{ key: "monthly", label: "Tháng" },
	{ key: "yearly", label: "Năm" },
];

/** Round a max value up to a clean axis top (1/2/2.5/5 × 10ⁿ). */
function niceMax(value: number): number {
	if (value <= 0) {
		return 4;
	}
	const pow = 10 ** Math.floor(Math.log10(value));
	const n = value / pow;
	const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
	return step * pow;
}

/** Catmull-Rom → cubic-bezier path through the given points (smooth line). */
function smoothPath(pts: { x: number; y: number }[]): string {
	if (pts.length === 0) {
		return "";
	}
	if (pts.length === 1) {
		return `M ${pts[0].x} ${pts[0].y}`;
	}
	let d = `M ${pts[0].x} ${pts[0].y}`;
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[i - 1] ?? pts[i];
		const p1 = pts[i];
		const p2 = pts[i + 1];
		const p3 = pts[i + 2] ?? p2;
		const c1x = p1.x + (p2.x - p0.x) / 6;
		const c1y = clampY(p1.y + (p2.y - p0.y) / 6);
		const c2x = p2.x - (p3.x - p1.x) / 6;
		const c2y = clampY(p2.y - (p3.y - p1.y) / 6);
		d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
	}
	return d;
}

function clampY(y: number): number {
	return Math.min(BASELINE, Math.max(PAD.top, y));
}

export function RevenueChart() {
	const [period, setPeriod] = useState<Period>("monthly");
	const today = useMemo(() => ictToday(), []);
	const confirmed = useConfirmedBookings({});

	const series: SeriesPoint[] = useMemo(
		() => revenueSeries(confirmed.data ?? [], period, today),
		[confirmed.data, period, today],
	);

	const n = series.length;
	const rawMax = Math.max(0, ...series.map((p) => Math.max(p.current, p.previous ?? 0)));
	const yMax = niceMax(rawMax);
	const hasData = series.some((p) => p.current > 0 || (p.previous ?? 0) > 0);

	const xOf = (i: number) => PAD.left + (n <= 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
	const yOf = (v: number) => PAD.top + PLOT_H - (v / yMax) * PLOT_H;

	const curPts = series.map((p, i) => ({ x: xOf(i), y: yOf(p.current) }));
	const prevPts = series
		.map((p, i) => (p.previous === null ? null : { x: xOf(i), y: yOf(p.previous) }))
		.filter((p): p is { x: number; y: number } => p !== null);

	const curLine = smoothPath(curPts);
	const curArea =
		curPts.length > 0
			? `${curLine} L ${curPts[curPts.length - 1].x} ${BASELINE} L ${curPts[0].x} ${BASELINE} Z`
			: "";
	const prevLine = smoothPath(prevPts);

	// Y grid lines + labels at 0, ¼, ½, ¾, 1 of the axis.
	const gridV = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);
	// X labels: thin out so they never crowd (≈ 8 max), always include the last.
	const step = Math.max(1, Math.ceil(n / 8));
	const xLabelIdx = series.map((_, i) => i).filter((i) => i % step === 0 || i === n - 1);

	return (
		<div className="rounded-2xl border border-line bg-card p-4 shadow-court sm:p-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="font-display text-lg font-medium text-ink">Tăng trưởng doanh thu</h2>
					<p className="text-sm text-ink-soft">
						{period === "yearly" ? "12 tháng gần nhất" : monthLabel(monthStartOf(today))}
					</p>
				</div>
				<div className="inline-flex rounded-lg border border-line bg-paper p-0.5">
					{PERIODS.map((p) => (
						<button
							key={p.key}
							type="button"
							onClick={() => setPeriod(p.key)}
							className={cn(
								"cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors",
								period === p.key
									? "bg-primary text-primary-foreground shadow-sm"
									: "text-ink-soft hover:text-ink",
							)}
						>
							{p.label}
						</button>
					))}
				</div>
			</div>

			<div className="mt-3 flex items-center gap-4 text-xs text-ink-soft">
				<span className="inline-flex items-center gap-1.5">
					<span className="size-2.5 rounded-full bg-court-500" />
					Kỳ này
				</span>
				<span className="inline-flex items-center gap-1.5">
					<span className="size-2.5 rounded-full bg-chalk-ink" />
					Kỳ trước
				</span>
			</div>

			<div className="relative mt-2">
				<svg
					viewBox={`0 0 ${W} ${H}`}
					className="h-auto w-full"
					role="img"
					aria-label="Doanh thu theo thời gian"
				>
					<title>Doanh thu theo thời gian</title>
					<defs>
						<linearGradient id="rev-current" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor="var(--color-court-500)" stopOpacity="0.35" />
							<stop offset="100%" stopColor="var(--color-court-500)" stopOpacity="0.02" />
						</linearGradient>
					</defs>

					{/* horizontal grid + y labels */}
					{gridV.map((v) => {
						const y = yOf(v);
						return (
							<g key={v}>
								<line
									x1={PAD.left}
									y1={y}
									x2={W - PAD.right}
									y2={y}
									stroke="var(--color-line)"
									strokeWidth={1}
								/>
								<text
									x={PAD.left - 8}
									y={y + 3}
									textAnchor="end"
									className="fill-[var(--color-ink-faint)] text-[10px]"
								>
									{formatVndCompact(v)}
								</text>
							</g>
						);
					})}

					{/* x labels */}
					{xLabelIdx.map((i) => (
						<text
							key={i}
							x={xOf(i)}
							y={H - 8}
							textAnchor="middle"
							className="fill-[var(--color-ink-faint)] text-[10px]"
						>
							{series[i].label}
						</text>
					))}

					{hasData && (
						<>
							{prevLine && (
								<path
									d={prevLine}
									fill="none"
									stroke="var(--color-chalk-ink)"
									strokeWidth={1.5}
									strokeDasharray="4 4"
									strokeLinecap="round"
								/>
							)}
							{curArea && <path d={curArea} fill="url(#rev-current)" />}
							{curLine && (
								<path
									d={curLine}
									fill="none"
									stroke="var(--color-court-600)"
									strokeWidth={2.5}
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							)}
						</>
					)}
				</svg>

				{!hasData && !confirmed.isLoading && (
					<div className="absolute inset-0 flex items-center justify-center">
						<p className="rounded-lg bg-paper/80 px-3 py-1.5 text-sm text-ink-faint backdrop-blur">
							Chưa có doanh thu trong kỳ này — xác nhận một lượt đặt để hiển thị ở đây.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
