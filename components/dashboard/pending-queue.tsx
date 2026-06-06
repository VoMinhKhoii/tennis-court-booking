"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { confirmBooking, rejectBooking } from "@/lib/actions/owner";
import { formatAge, formatVnd } from "@/lib/dashboard/format";
import { useCourts, usePendingBookings } from "@/lib/queries/dashboard";
import type { BookingRow } from "@/lib/queries/types";

export function PendingQueue() {
	const queryClient = useQueryClient();
	const { data: bookings, isLoading, error } = usePendingBookings();
	const { data: courts } = useCourts();
	const courtName = (id: string) => courts?.find((c) => c.id === id)?.name ?? "—";

	function refresh() {
		queryClient.invalidateQueries({ queryKey: ["bookings"] });
	}

	if (isLoading) {
		return <p className="text-sm text-zinc-500">Loading…</p>;
	}
	if (error) {
		return <p className="text-sm text-red-600">Failed to load pending bookings.</p>;
	}
	if (!bookings || bookings.length === 0) {
		return <p className="text-sm text-zinc-500">No pending bookings.</p>;
	}

	return (
		<ul className="space-y-3">
			{bookings.map((b) => (
				<PendingRow key={b.id} booking={b} courtName={courtName(b.court_id)} onDone={refresh} />
			))}
		</ul>
	);
}

function PendingRow({
	booking,
	courtName,
	onDone,
}: {
	booking: BookingRow;
	courtName: string;
	onDone: () => void;
}) {
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [showReject, setShowReject] = useState(false);
	const [reason, setReason] = useState("");

	function onConfirm() {
		setError(null);
		startTransition(async () => {
			const result = await confirmBooking({ bookingId: booking.id });
			if (result.ok) {
				onDone();
			} else {
				setError(result.error);
			}
		});
	}

	function onReject() {
		setError(null);
		startTransition(async () => {
			const result = await rejectBooking({
				bookingId: booking.id,
				reason: reason.trim() || undefined,
			});
			if (result.ok) {
				onDone();
			} else {
				setError(result.error);
			}
		});
	}

	return (
		<li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="font-medium">{booking.customer_name}</div>
					<div className="text-sm text-zinc-600 dark:text-zinc-400">
						{booking.zalo_phone} · group {booking.group_size}
					</div>
					<div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
						{courtName} · {booking.type === "monthly" ? "Monthly" : "Ad-hoc"} ·{" "}
						<span className="font-mono">{booking.reference}</span>
					</div>
				</div>
				<div className="text-right">
					<div className="font-semibold tabular-nums">{formatVnd(booking.amount_vnd)}</div>
					<div className="text-xs text-zinc-500">age {formatAge(booking.created_at)}</div>
				</div>
			</div>

			{error && <p className="mt-2 text-sm text-red-600">{error}</p>}

			{showReject ? (
				<div className="mt-3 space-y-2">
					<input
						type="text"
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						placeholder="Reason (optional)"
						className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
					/>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={onReject}
							disabled={pending}
							className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
						>
							{pending ? "Rejecting…" : "Confirm reject"}
						</button>
						<button
							type="button"
							onClick={() => setShowReject(false)}
							disabled={pending}
							className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
						>
							Cancel
						</button>
					</div>
				</div>
			) : (
				<div className="mt-3 flex gap-2">
					<button
						type="button"
						onClick={onConfirm}
						disabled={pending}
						className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
					>
						{pending ? "Confirming…" : "Confirm"}
					</button>
					<button
						type="button"
						onClick={() => setShowReject(true)}
						disabled={pending}
						className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
					>
						Reject
					</button>
				</div>
			)}
		</li>
	);
}
