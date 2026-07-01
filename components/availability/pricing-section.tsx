"use client";

import { useMemo } from "react";
import { minutesToTime, timeToMinutes } from "@/lib/booking/grid";
import { usePublicCourts, usePublicSettings } from "@/lib/queries/public";

const nf = new Intl.NumberFormat("vi-VN");

/** Format an hours count compactly: 4 → "4", 4.5 → "4,5" (vi decimal). */
function fmtHours(h: number): string {
	return nf.format(h);
}

/**
 * Pricing card that closes the booking page: a plain title over the per-time-band
 * rate table (VND per hour), exactly as the owner has configured it in Settings.
 * Each band runs from its start until the next; the last runs to the latest court
 * close. This mirrors what the booking engine actually charges (see price_span).
 */
export function PricingSection() {
	const { data: settings } = usePublicSettings();
	const { data: courts } = usePublicCourts();

	const rows = useMemo(() => {
		const bands = [...(settings?.price_bands ?? [])].sort(
			(a, b) => timeToMinutes(a.start) - timeToMinutes(b.start),
		);
		if (bands.length === 0) return null;
		// Latest court close bounds the final band; fall back to 22:00 if unknown.
		const closeMin = Math.max(
			...(courts ?? []).map((c) => timeToMinutes(c.close_time)),
			timeToMinutes(bands[bands.length - 1].start) + 60,
		);
		const dayEnd = Number.isFinite(closeMin) ? closeMin : 22 * 60;
		const bandRows = bands.map((b, i) => {
			const startMin = timeToMinutes(b.start);
			const endMin = i + 1 < bands.length ? timeToMinutes(bands[i + 1].start) : dayEnd;
			return {
				time: `${minutesToTime(startMin)} – ${minutesToTime(endMin)}`,
				hours: Math.max(0, endMin - startMin) / 60,
				rate: b.rate,
			};
		});
		const totalHours = Math.max(0, dayEnd - timeToMinutes(bands[0].start)) / 60;
		return { bandRows, totalHours };
	}, [settings, courts]);

	if (!rows) return null;

	return (
		<section className="pt-4 pb-28">
			<div className="overflow-hidden rounded-xl bg-card shadow-court-lg ring-1 ring-foreground/10">
				<h2 className="px-5 pt-5 pb-4 font-display text-xl font-medium text-ink sm:px-10 sm:text-2xl">
					Bảng Giá Theo Giờ
				</h2>

				{/* Rate table — band · hours/day · VND per hour. */}
				<table className="w-full border-collapse text-left">
					<thead>
						<tr className="bg-primary text-on-dark">
							<th className="px-5 py-3 font-semibold text-xs uppercase tracking-wider sm:px-10">
								Khung giờ
							</th>
							<th className="px-3 py-3 text-center font-semibold text-xs uppercase tracking-wider">
								Giờ/ngày
							</th>
							<th className="px-5 py-3 text-right font-semibold text-xs uppercase tracking-wider sm:px-10">
								Giá
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.bandRows.map((b) => (
							<tr key={b.time} className="border-line border-t">
								<td className="px-5 py-4 font-mono text-ink text-sm tabular-nums sm:px-10">
									{b.time}
								</td>
								<td className="px-3 py-4 text-center font-mono text-ink-soft text-sm tabular-nums">
									{fmtHours(b.hours)}
								</td>
								<td className="px-5 py-4 text-right sm:px-10">
									<span className="font-display font-medium text-court-900 text-lg tabular-nums sm:text-xl">
										{nf.format(b.rate)}
									</span>
								</td>
							</tr>
						))}
						<tr className="border-line border-t bg-court-25">
							<td className="px-5 py-4 font-semibold text-ink text-sm sm:px-10">
								Mỗi sân / ngày (mọi khung)
							</td>
							<td className="px-3 py-4 text-center font-mono font-semibold text-ink text-sm tabular-nums">
								{fmtHours(rows.totalHours)}
							</td>
							<td className="px-5 py-4 sm:px-10" />
						</tr>
					</tbody>
				</table>
			</div>
		</section>
	);
}
