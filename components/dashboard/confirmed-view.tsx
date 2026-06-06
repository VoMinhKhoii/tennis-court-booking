"use client";

import { useState } from "react";
import { formatIctDateTime, formatVnd } from "@/lib/dashboard/format";
import { useConfirmedBookings, useCourts } from "@/lib/queries/dashboard";

const inputClass =
	"w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

export function ConfirmedView() {
	const { data: courts } = useCourts();
	const [courtId, setCourtId] = useState("");
	const [month, setMonth] = useState(""); // YYYY-MM from <input type="month">
	const [name, setName] = useState("");

	const {
		data: bookings,
		isLoading,
		error,
	} = useConfirmedBookings({
		courtId: courtId || undefined,
		// The hook slices to YYYY-MM; append a day so it is a valid date string.
		month: month ? `${month}-01` : undefined,
		name: name.trim() || undefined,
	});

	const courtName = (id: string) => courts?.find((c) => c.id === id)?.name ?? "—";

	return (
		<div>
			<div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
				<label className="block space-y-1">
					<span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Court</span>
					<select
						value={courtId}
						onChange={(e) => setCourtId(e.target.value)}
						className={inputClass}
					>
						<option value="">All courts</option>
						{(courts ?? []).map((c) => (
							<option key={c.id} value={c.id}>
								{c.name}
							</option>
						))}
					</select>
				</label>
				<label className="block space-y-1">
					<span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Month</span>
					<input
						type="month"
						value={month}
						onChange={(e) => setMonth(e.target.value)}
						className={inputClass}
					/>
				</label>
				<label className="block space-y-1">
					<span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Customer</span>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Name"
						className={inputClass}
					/>
				</label>
			</div>

			{isLoading ? (
				<p className="text-sm text-zinc-500">Loading…</p>
			) : error ? (
				<p className="text-sm text-red-600">Failed to load confirmed bookings.</p>
			) : !bookings || bookings.length === 0 ? (
				<p className="text-sm text-zinc-500">No confirmed bookings match.</p>
			) : (
				<ul className="space-y-3">
					{bookings.map((b) => (
						<li
							key={b.id}
							className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
						>
							<div>
								<div className="font-medium">{b.customer_name}</div>
								<div className="text-sm text-zinc-600 dark:text-zinc-400">
									{b.zalo_phone} · {courtName(b.court_id)} ·{" "}
									{b.type === "monthly" ? "Monthly" : "Ad-hoc"}
								</div>
								<div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
									<span className="font-mono">{b.reference}</span> ·{" "}
									{b.source === "owner" ? "manual" : "public"}
									{b.confirmed_at ? ` · ${formatIctDateTime(b.confirmed_at)}` : ""}
								</div>
							</div>
							<div className="font-semibold tabular-nums">{formatVnd(b.amount_vnd)}</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
