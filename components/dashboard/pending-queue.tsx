"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
		return <p className="text-sm text-ink-faint">Đang tải…</p>;
	}
	if (error) {
		return <p className="text-sm text-signal-red">Không tải được lượt đặt chờ duyệt.</p>;
	}
	if (!bookings || bookings.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-line bg-card/50 px-6 py-10 text-center text-sm text-ink-faint">
				Không có lượt đặt chờ duyệt. Bạn đã xử lý hết.
			</div>
		);
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
		<li className="rounded-xl border border-line bg-card p-4 shadow-court transition-shadow hover:shadow-court-lg">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-medium text-ink">{booking.customer_name}</span>
						<Badge variant={booking.type === "monthly" ? "secondary" : "outline"}>
							{booking.type === "monthly" ? "Theo tháng" : "Lẻ"}
						</Badge>
					</div>
					<div className="mt-0.5 text-sm text-ink-soft">
						{booking.zalo_phone} · nhóm {booking.group_size} người
					</div>
					<div className="mt-1 text-xs text-ink-faint">
						{courtName} · <span className="font-mono">{booking.reference}</span>
					</div>
				</div>
				<div className="shrink-0 text-right">
					<div className="font-semibold tabular-nums text-ink">{formatVnd(booking.amount_vnd)}</div>
					<div className="text-xs text-ink-faint">chờ {formatAge(booking.created_at)}</div>
				</div>
			</div>

			{error && <p className="mt-2 text-sm text-signal-red">{error}</p>}

			{showReject ? (
				<div className="mt-3 space-y-2">
					<input
						type="text"
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						placeholder="Lý do (không bắt buộc)"
						className="w-full rounded-md border border-line-strong bg-paper-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20"
					/>
					<div className="flex gap-2">
						<Button variant="destructive" size="sm" onClick={onReject} disabled={pending}>
							{pending ? "Đang từ chối…" : "Xác nhận từ chối"}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setShowReject(false)}
							disabled={pending}
						>
							Huỷ
						</Button>
					</div>
				</div>
			) : (
				<div className="mt-3 flex gap-2 border-t border-line pt-3">
					<Button size="sm" onClick={onConfirm} disabled={pending}>
						{pending ? "Đang xác nhận…" : "Xác nhận"}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setShowReject(true)}
						disabled={pending}
					>
						Từ chối
					</Button>
				</div>
			)}
		</li>
	);
}
