"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createCourt, updateCourt } from "@/lib/actions/owner";
import { type CourtInput, courtInputSchema } from "@/lib/booking/schemas";
import { useCourts } from "@/lib/queries/dashboard";
import type { CourtRow } from "@/lib/queries/types";

const inputClass =
	"w-full rounded-md border border-line-strong bg-paper-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20";

/** HH:MM:SS -> HH:MM for <input type="time">. */
function toHm(t: string): string {
	return t.slice(0, 5);
}

export function CourtManager() {
	const queryClient = useQueryClient();
	const { data: courts, isLoading } = useCourts();
	const [editing, setEditing] = useState<CourtRow | "new" | null>(null);

	function refresh() {
		queryClient.invalidateQueries({ queryKey: ["courts"] });
		setEditing(null);
	}

	if (isLoading) {
		return <p className="text-sm text-ink-faint">Đang tải…</p>;
	}

	return (
		<div className="space-y-4">
			<ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card shadow-court">
				{(courts ?? []).map((c) => (
					<li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
						<div className="min-w-0">
							<div className="flex items-center gap-2 font-medium text-ink">
								{c.name}
								{!c.is_active && <Badge variant="secondary">Đã đóng</Badge>}
							</div>
							<div className="text-sm tabular-nums text-ink-soft">
								{toHm(c.open_time)}–{toHm(c.close_time)}
							</div>
						</div>
						<Button variant="outline" size="sm" onClick={() => setEditing(c)}>
							Sửa
						</Button>
					</li>
				))}
			</ul>

			{editing ? (
				<CourtForm
					key={editing === "new" ? "new" : editing.id}
					court={editing === "new" ? null : editing}
					onDone={refresh}
					onCancel={() => setEditing(null)}
				/>
			) : (
				<Button onClick={() => setEditing("new")}>
					<Plus />
					Thêm sân
				</Button>
			)}
		</div>
	);
}

function CourtForm({
	court,
	onDone,
	onCancel,
}: {
	court: CourtRow | null;
	onDone: () => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState(court?.name ?? "");
	const [openTime, setOpenTime] = useState(court ? toHm(court.open_time) : "06:00");
	const [closeTime, setCloseTime] = useState(court ? toHm(court.close_time) : "21:00");
	const [isActive, setIsActive] = useState(court?.is_active ?? true);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		const input: CourtInput = { name, openTime, closeTime, isActive };
		const parsed = courtInputSchema.safeParse(input);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Vui lòng kiểm tra lại biểu mẫu.");
			return;
		}
		startTransition(async () => {
			try {
				const result = court
					? await updateCourt(court.id, parsed.data)
					: await createCourt(parsed.data);
				if (result.ok) {
					onDone();
				} else {
					setError(result.error);
				}
			} catch {
				setError("Không lưu được sân. Vui lòng thử lại.");
			}
		});
	}

	return (
		<form
			onSubmit={onSubmit}
			className="space-y-4 rounded-xl border border-line bg-card p-4 shadow-court"
		>
			<div className="font-display text-base font-medium text-ink">
				{court ? "Sửa sân" : "Sân mới"}
			</div>

			<label className="block space-y-1">
				<span className="text-sm font-medium text-ink-soft">Tên</span>
				<input
					type="text"
					required
					value={name}
					onChange={(e) => setName(e.target.value)}
					className={inputClass}
				/>
			</label>

			<div className="grid grid-cols-2 gap-3">
				<label className="block space-y-1">
					<span className="text-sm font-medium text-ink-soft">Giờ mở</span>
					<input
						type="time"
						required
						step={1800}
						value={openTime}
						onChange={(e) => setOpenTime(e.target.value)}
						className={inputClass}
					/>
				</label>
				<label className="block space-y-1">
					<span className="text-sm font-medium text-ink-soft">Giờ đóng</span>
					<input
						type="time"
						required
						step={1800}
						value={closeTime}
						onChange={(e) => setCloseTime(e.target.value)}
						className={inputClass}
					/>
				</label>
			</div>

			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={isActive}
					onChange={(e) => setIsActive(e.target.checked)}
					className="h-4 w-4"
				/>
				<span className="font-medium text-ink-soft">Đang mở (cho đặt)</span>
			</label>

			{error && <p className="text-sm text-signal-red">{error}</p>}

			<div className="flex gap-2">
				<Button type="submit" disabled={pending}>
					{pending ? "Đang lưu…" : "Lưu"}
				</Button>
				<Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
					Huỷ
				</Button>
			</div>
		</form>
	);
}
