"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatIctDateTime, formatVnd } from "@/lib/dashboard/format";
import { useConfirmedBookings, useCourts } from "@/lib/queries/dashboard";

const inputClass =
	"w-full rounded-md border border-line-strong bg-paper-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20";

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
			<div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-line bg-card p-4 shadow-court sm:grid-cols-3">
				<label className="block space-y-1">
					<span className="text-xs font-medium text-ink-soft">Sân</span>
					<select
						value={courtId}
						onChange={(e) => setCourtId(e.target.value)}
						className={inputClass}
					>
						<option value="">Tất cả sân</option>
						{(courts ?? []).map((c) => (
							<option key={c.id} value={c.id}>
								{c.name}
							</option>
						))}
					</select>
				</label>
				<label className="block space-y-1">
					<span className="text-xs font-medium text-ink-soft">Tháng</span>
					<input
						type="month"
						value={month}
						onChange={(e) => setMonth(e.target.value)}
						className={inputClass}
					/>
				</label>
				<label className="block space-y-1">
					<span className="text-xs font-medium text-ink-soft">Khách hàng</span>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Tên"
						className={inputClass}
					/>
				</label>
			</div>

			{isLoading ? (
				<p className="text-sm text-ink-faint">Đang tải…</p>
			) : error ? (
				<p className="text-sm text-signal-red">Không tải được lượt đặt đã xác nhận.</p>
			) : !bookings || bookings.length === 0 ? (
				<div className="rounded-xl border border-dashed border-line bg-card/50 px-6 py-10 text-center text-sm text-ink-faint">
					Không có lượt đặt đã xác nhận phù hợp
				</div>
			) : (
				<ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card shadow-court">
					{bookings.map((b) => (
						<li key={b.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
							<div className="min-w-0">
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-medium text-ink">{b.customer_name}</span>
									<Badge variant={b.type === "monthly" ? "secondary" : "outline"}>
										{b.type === "monthly" ? "Theo tháng" : "Lẻ"}
									</Badge>
								</div>
								<div className="mt-0.5 text-sm text-ink-soft">
									{b.zalo_phone} · {courtName(b.court_id)}
								</div>
								<div className="mt-1 text-xs text-ink-faint">
									<span className="font-mono">{b.reference}</span> ·{" "}
									{b.source === "owner" ? "thủ công" : "công khai"}
									{b.confirmed_at ? ` · ${formatIctDateTime(b.confirmed_at)}` : ""}
								</div>
							</div>
							<div className="shrink-0 font-semibold tabular-nums text-ink">
								{formatVnd(b.amount_vnd)}
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
