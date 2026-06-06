"use client";

import { useMemo } from "react";
import { buildDayGrid, datesInMonth, rangeStartIctMinutes } from "@/lib/booking/grid";
import { useAvailability, useAvailabilityRealtime } from "@/lib/queries/availability";
import type { CourtRow } from "@/lib/queries/types";

/**
 * Per-court 30-min availability grid for one calendar month (spec §6.1).
 * Status-only (available / occupied), no PII. Reads public_availability via
 * TanStack Query and live-updates by subscribing to the court's public Broadcast
 * channel (the subscription invalidates the query on each event).
 */
export function CourtGrid({ court, monthStart }: { court: CourtRow; monthStart: string }) {
	useAvailabilityRealtime(court.id);
	const { data, isLoading, isError } = useAvailability(court.id, monthStart);

	// Group occupied start-minutes by ICT slot_date.
	const occupiedByDate = useMemo(() => {
		const map = new Map<string, Set<number>>();
		for (const row of data ?? []) {
			let set = map.get(row.slot_date);
			if (!set) {
				set = new Set<number>();
				map.set(row.slot_date, set);
			}
			set.add(rangeStartIctMinutes(row.time_range));
		}
		return map;
	}, [data]);

	const dates = useMemo(() => datesInMonth(monthStart), [monthStart]);

	if (isLoading) {
		return <p className="px-1 py-6 text-sm text-zinc-500">Loading availability…</p>;
	}
	if (isError) {
		return (
			<p className="px-1 py-6 text-sm text-red-600">
				Could not load availability. Please try again.
			</p>
		);
	}

	return (
		<div className="space-y-3">
			{dates.map((date) => {
				const grid = buildDayGrid(
					court.open_time,
					court.close_time,
					occupiedByDate.get(date) ?? new Set(),
				);
				const dayLabel = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
					weekday: "short",
					day: "numeric",
					month: "short",
					timeZone: "UTC",
				});
				return (
					<div key={date} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
						<div className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
							{dayLabel}
						</div>
						<div className="flex flex-wrap gap-1">
							{grid.map((block) => (
								<span
									key={block.startMinutes}
									className={`rounded px-1.5 py-1 text-xs tabular-nums ${
										block.occupied
											? "bg-zinc-200 text-zinc-400 line-through dark:bg-zinc-800 dark:text-zinc-600"
											: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
									}`}
									title={block.occupied ? "Occupied" : "Available"}
								>
									{block.startTime}
								</span>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
}
