"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ictToday } from "@/lib/booking/dates";
import { monthLabel, monthStartOf, nextMonthStart } from "@/lib/booking/grid";
import { usePublicCourts } from "@/lib/queries/public";
import { CourtGrid } from "./court-grid";

/**
 * Public availability surface (spec §6.1): pick a court and a month (current or
 * next), see a live PII-free 30-min grid. Mobile-first, no auth.
 */
export function AvailabilityView() {
	const { data: courts, isLoading, isError } = usePublicCourts();
	const activeCourts = useMemo(() => (courts ?? []).filter((c) => c.is_active), [courts]);

	const months = useMemo(() => {
		const current = monthStartOf(ictToday());
		return [current, nextMonthStart(current)] as const;
	}, []);

	const [courtId, setCourtId] = useState<string | null>(null);
	const [monthStart, setMonthStart] = useState(months[0]);

	// Prefer the user's choice only if it still exists in the active list; else
	// fall back to the first active court so the grid never blanks out.
	const selectedCourtId =
		(courtId && activeCourts.some((c) => c.id === courtId) ? courtId : null) ??
		activeCourts[0]?.id ??
		null;
	const selectedCourt = activeCourts.find((c) => c.id === selectedCourtId) ?? null;

	if (isLoading) {
		return <p className="text-sm text-zinc-500">Loading courts…</p>;
	}
	if (isError) {
		return <p className="text-sm text-red-600">Could not load courts. Please try again.</p>;
	}
	if (activeCourts.length === 0) {
		return <p className="text-sm text-zinc-500">No courts are open for booking yet.</p>;
	}

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap gap-2">
				{activeCourts.map((court) => (
					<button
						key={court.id}
						type="button"
						onClick={() => setCourtId(court.id)}
						className={`rounded-full px-4 py-1.5 text-sm font-medium ${
							court.id === selectedCourtId
								? "bg-emerald-600 text-white"
								: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
						}`}
					>
						{court.name}
					</button>
				))}
			</div>

			<div className="flex flex-wrap gap-2">
				{months.map((m) => (
					<button
						key={m}
						type="button"
						onClick={() => setMonthStart(m)}
						className={`rounded-md px-3 py-1.5 text-sm ${
							m === monthStart
								? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
								: "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
						}`}
					>
						{monthLabel(m)}
					</button>
				))}
			</div>

			<div className="flex items-center gap-2 text-xs text-zinc-500">
				<span className="inline-flex items-center gap-1">
					<span className="inline-block h-3 w-3 rounded bg-emerald-50 dark:bg-emerald-950" />{" "}
					available
				</span>
				<span className="inline-flex items-center gap-1">
					<span className="inline-block h-3 w-3 rounded bg-zinc-200 dark:bg-zinc-800" /> occupied
				</span>
			</div>

			{selectedCourt && <CourtGrid court={selectedCourt} monthStart={monthStart} />}

			<div className="pt-2">
				<Link
					href="/book"
					className="inline-block rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white"
				>
					Book a slot
				</Link>
			</div>
		</div>
	);
}
