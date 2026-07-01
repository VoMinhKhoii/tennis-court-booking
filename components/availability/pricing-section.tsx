const nf = new Intl.NumberFormat("vi-VN");

/** Time-band pricing (VND/hour). Rate varies by band across the 16h court day. */
const BANDS = [
	{ time: "06:00 – 11:00", hours: 5, rate: 350_000 },
	{ time: "11:00 – 15:00", hours: 4, rate: 300_000 },
	{ time: "15:00 – 17:00", hours: 2, rate: 350_000 },
	{ time: "17:00 – 22:00", hours: 5, rate: 450_000 },
] as const;
const TOTAL_HOURS = 16;

/**
 * Pricing card that closes the booking page: a plain title over the per-time-band
 * rate table (VND per hour), as the venue prices it. Display-only — the booking
 * engine still charges the flat settings rate, so band-aware totals are a
 * separate follow-up.
 */
export function PricingSection() {
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
						{BANDS.map((b) => (
							<tr key={b.time} className="border-line border-t">
								<td className="px-5 py-4 font-mono text-ink text-sm tabular-nums sm:px-10">
									{b.time}
								</td>
								<td className="px-3 py-4 text-center font-mono text-ink-soft text-sm tabular-nums">
									{b.hours}
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
								{TOTAL_HOURS}
							</td>
							<td className="px-5 py-4 sm:px-10" />
						</tr>
					</tbody>
				</table>
			</div>
		</section>
	);
}
