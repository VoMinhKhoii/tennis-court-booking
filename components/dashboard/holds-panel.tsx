"use client";

import { formatIctDateTime, formatVnd } from "@/lib/dashboard/format";
import { useCourts, useExpiredHolds, useHeldBookings } from "@/lib/queries/dashboard";
import type { BookingRow } from "@/lib/queries/types";

/**
 * Owner-only read surfaces for the soft-hold lifecycle (spec §"Owner visibility"
 * + §"Reconciliation surface"): which slots are currently held but unpaid, and
 * recently expired holds that may still carry a payment claim to reconcile.
 * These are intentionally OUT of the actionable pending queue.
 */
export function HoldsPanel() {
	const { data: courts } = useCourts();
	const courtName = (id: string) => courts?.find((c) => c.id === id)?.name ?? "—";

	const held = useHeldBookings();
	const expired = useExpiredHolds();

	const heldRows = held.data ?? [];
	const expiredRows = expired.data ?? [];

	return (
		<div className="space-y-6">
			<section>
				<h3 className="mb-1 text-sm font-semibold">Đang giữ chỗ (chưa thanh toán)</h3>
				<p className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">
					Khách đang trong bước thanh toán. Tự hết hạn nếu không hoàn tất.
				</p>
				{held.isLoading ? (
					<p className="text-sm text-zinc-500">Loading…</p>
				) : heldRows.length === 0 ? (
					<p className="text-sm text-zinc-500">Không có lượt giữ chỗ nào.</p>
				) : (
					<ul className="space-y-2">
						{heldRows.map((b) => (
							<HoldRow
								key={b.id}
								booking={b}
								courtName={courtName(b.court_id)}
								trailing={
									b.hold_expires_at ? `hết hạn ${formatIctDateTime(b.hold_expires_at)}` : undefined
								}
							/>
						))}
					</ul>
				)}
			</section>

			<section>
				<h3 className="mb-1 text-sm font-semibold">Giữ chỗ đã hết hạn (gần đây)</h3>
				<p className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">
					Nếu khách đã chuyển khoản nhưng giữ chỗ hết hạn, đối chiếu theo mã để hoàn tiền hoặc đặt
					lại.
				</p>
				{expired.isLoading ? (
					<p className="text-sm text-zinc-500">Loading…</p>
				) : expiredRows.length === 0 ? (
					<p className="text-sm text-zinc-500">Không có lượt giữ chỗ hết hạn gần đây.</p>
				) : (
					<ul className="space-y-2">
						{expiredRows.map((b) => (
							<HoldRow
								key={b.id}
								booking={b}
								courtName={courtName(b.court_id)}
								trailing={formatIctDateTime(b.created_at)}
							/>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

function HoldRow({
	booking,
	courtName,
	trailing,
}: {
	booking: BookingRow;
	courtName: string;
	trailing?: string;
}) {
	return (
		<li className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
			<div>
				<div className="text-sm font-medium">{booking.customer_name}</div>
				<div className="text-xs text-zinc-600 dark:text-zinc-400">
					{booking.zalo_phone} · {courtName} · {booking.type === "monthly" ? "Monthly" : "Ad-hoc"}
				</div>
				<div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
					<span className="font-mono">{booking.reference}</span>
					{trailing ? ` · ${trailing}` : ""}
				</div>
			</div>
			<div className="font-semibold tabular-nums">{formatVnd(booking.amount_vnd)}</div>
		</li>
	);
}
