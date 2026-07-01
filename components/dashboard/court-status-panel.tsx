"use client";

import Link from "next/link";
import { useMemo } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { ictToday } from "@/lib/booking/dates";
import { formatVnd } from "@/lib/dashboard/format";
import { byCourt } from "@/lib/dashboard/metrics";
import { useConfirmedBookings, useCourts } from "@/lib/queries/dashboard";

/** Per-court confirmed activity this month, with a relative utilization bar. */
export function CourtStatusPanel() {
	const today = useMemo(() => ictToday(), []);
	const courts = useCourts();
	const confirmed = useConfirmedBookings({});

	const stats = useMemo(
		() => byCourt(confirmed.data ?? [], courts.data ?? [], today),
		[confirmed.data, courts.data, today],
	);

	return (
		<section className="rounded-2xl border border-line bg-card p-4 shadow-court sm:p-6">
			<div className="mb-4 flex items-center justify-between">
				<h2 className="font-display text-lg font-medium text-ink">Trạng thái sân</h2>
				<Link
					href="/dashboard/courts"
					className="text-xs font-medium text-court-700 hover:underline"
				>
					Quản lý sân →
				</Link>
			</div>

			{stats.length === 0 ? (
				<p className="py-8 text-center text-sm text-ink-faint">
					Chưa có sân nào — thêm trong mục{" "}
					<Link href="/dashboard/courts" className="text-court-700 hover:underline">
						Sân
					</Link>
					.
				</p>
			) : (
				<ul className="space-y-4">
					{stats.map((c) => (
						<li key={c.id} className="space-y-1.5">
							<div className="flex items-center justify-between gap-3">
								<div className="flex items-center gap-2">
									<span className="font-medium text-ink">{c.name}</span>
									<StatusPill tone={c.isActive ? "free" : "taken"}>
										{c.isActive ? "Đang mở" : "Đã đóng"}
									</StatusPill>
								</div>
								<span className="text-sm tabular-nums text-ink-soft">
									{c.bookings} · {formatVnd(c.revenue)}
								</span>
							</div>
							<div className="h-1.5 w-full overflow-hidden rounded-full bg-court-50">
								<div
									className="h-full rounded-full bg-court-500 transition-[width]"
									style={{ width: `${Math.round(c.share * 100)}%` }}
								/>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
