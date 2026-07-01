"use client";

import { useMemo } from "react";
import { ictToday } from "@/lib/booking/dates";
import { monthLabel, monthStartOf } from "@/lib/booking/grid";
import { formatVnd } from "@/lib/dashboard/format";
import { pctDelta, periodTotals } from "@/lib/dashboard/metrics";
import { useConfirmedBookings } from "@/lib/queries/dashboard";
import { StatCard } from "./stat-card";

/**
 * Overview KPI rail: revenue, bookings and average value for the current ICT
 * month, each with a month-over-month trend chip. All derived from the single
 * confirmed-bookings query so the numbers match the chart and lists below.
 */
export function DashboardStats() {
	const today = useMemo(() => ictToday(), []);
	const confirmed = useConfirmedBookings({});
	const loading = confirmed.isLoading;

	const { current, previous } = useMemo(
		() => periodTotals(confirmed.data ?? [], today),
		[confirmed.data, today],
	);

	const monthHint = monthLabel(monthStartOf(today));
	const tiles = [
		{
			label: "Doanh thu",
			value: formatVnd(current.revenue),
			delta: pctDelta(current.revenue, previous.revenue),
			hint: monthHint,
		},
		{
			label: "Lượt đặt",
			value: String(current.bookings),
			delta: pctDelta(current.bookings, previous.bookings),
			hint: `Đã xác nhận · ${monthHint}`,
		},
		{
			label: "TB mỗi lượt",
			value: current.bookings ? formatVnd(current.avgValue) : "—",
			delta: pctDelta(current.avgValue, previous.avgValue),
			hint: "Mỗi lượt đã xác nhận",
		},
	];

	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
			{tiles.map((t) => (
				<StatCard
					key={t.label}
					label={t.label}
					value={t.value}
					delta={t.delta}
					hint={t.hint}
					loading={loading}
				/>
			))}
		</div>
	);
}
