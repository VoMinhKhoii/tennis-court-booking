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
		<div className="grid gap-4 lg:grid-cols-2">
			<HoldsCard
				title="Đang giữ chỗ (chưa thanh toán)"
				caption="Khách đang trong bước thanh toán. Tự hết hạn nếu không hoàn tất."
				loading={held.isLoading}
				emptyLabel="Không có lượt giữ chỗ nào."
			>
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
			</HoldsCard>

			<HoldsCard
				title="Giữ chỗ đã hết hạn (gần đây)"
				caption="Nếu khách đã chuyển khoản nhưng giữ chỗ hết hạn, đối chiếu theo mã để hoàn tiền hoặc đặt lại."
				loading={expired.isLoading}
				emptyLabel="Không có lượt giữ chỗ hết hạn gần đây."
			>
				{expiredRows.map((b) => (
					<HoldRow
						key={b.id}
						booking={b}
						courtName={courtName(b.court_id)}
						trailing={formatIctDateTime(b.created_at)}
					/>
				))}
			</HoldsCard>
		</div>
	);
}

function HoldsCard({
	title,
	caption,
	loading,
	emptyLabel,
	children,
}: {
	title: string;
	caption: string;
	loading: boolean;
	emptyLabel: string;
	children: React.ReactNode[];
}) {
	return (
		<section className="rounded-xl border border-line bg-card shadow-court">
			<div className="border-b border-line px-4 py-3">
				<h3 className="text-sm font-semibold text-ink">{title}</h3>
				<p className="mt-0.5 text-xs text-ink-soft">{caption}</p>
			</div>
			{loading ? (
				<p className="px-4 py-6 text-sm text-ink-faint">Đang tải…</p>
			) : children.length === 0 ? (
				<p className="px-4 py-6 text-sm text-ink-faint">{emptyLabel}</p>
			) : (
				<ul className="divide-y divide-line">{children}</ul>
			)}
		</section>
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
		<li className="flex items-start justify-between gap-3 px-4 py-3">
			<div className="min-w-0">
				<div className="text-sm font-medium text-ink">{booking.customer_name}</div>
				<div className="text-xs text-ink-soft">
					{booking.zalo_phone} · {courtName} · {booking.type === "monthly" ? "Theo tháng" : "Lẻ"}
				</div>
				<div className="mt-0.5 text-xs text-ink-faint">
					<span className="font-mono">{booking.reference}</span>
					{trailing ? ` · ${trailing}` : ""}
				</div>
			</div>
			<div className="shrink-0 font-semibold tabular-nums text-ink">
				{formatVnd(booking.amount_vnd)}
			</div>
		</li>
	);
}
