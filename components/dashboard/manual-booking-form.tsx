"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createManualBooking } from "@/lib/actions/owner";
import { MAX_BLOCK_COUNT } from "@/lib/booking/constants";
import { enumerateSlotDates, ictToday } from "@/lib/booking/dates";
import {
	minutesToTime,
	monthLabel,
	monthStartOf,
	nextMonthStart,
	timeToMinutes,
} from "@/lib/booking/grid";
import { computeAmountVnd } from "@/lib/booking/pricing";
import { type ManualBookingInput, manualBookingInputSchema } from "@/lib/booking/schemas";
import { formatVnd } from "@/lib/dashboard/format";
import { useCourts, useSettings } from "@/lib/queries/dashboard";
import type { CourtRow } from "@/lib/queries/types";

const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

const inputClass =
	"w-full rounded-md border border-line-strong bg-paper-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20";

function startTimeOptions(court: CourtRow): string[] {
	const open = timeToMinutes(court.open_time);
	const close = timeToMinutes(court.close_time);
	const out: string[] = [];
	for (let m = open; m + 30 <= close; m += 30) {
		out.push(minutesToTime(m));
	}
	return out;
}

type FormState = {
	type: "adhoc" | "monthly";
	courtId: string;
	customerName: string;
	zaloPhone: string;
	groupSize: number;
	startTime: string;
	blockCount: number;
	date: string;
	month: string;
	weekday: number;
};

export function ManualBookingForm() {
	const queryClient = useQueryClient();
	const { data: courts } = useCourts();
	const { data: settings } = useSettings();
	const activeCourts = useMemo(() => (courts ?? []).filter((c) => c.is_active), [courts]);

	const today = useMemo(() => ictToday(), []);
	const currentMonth = useMemo(() => monthStartOf(today), [today]);

	const [form, setForm] = useState<FormState>({
		type: "adhoc",
		courtId: "",
		customerName: "",
		zaloPhone: "",
		groupSize: 1,
		startTime: "",
		blockCount: 2,
		date: today,
		month: currentMonth,
		weekday: 1,
	});
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<{
		reference: string;
		amountVnd: number;
		occurrences: number;
	} | null>(null);
	const [pending, startTransition] = useTransition();

	const court = activeCourts.find((c) => c.id === form.courtId) ?? activeCourts[0] ?? null;
	const effectiveCourtId = court?.id ?? "";

	const enumeratedDates = useMemo<string[]>(() => {
		try {
			if (form.type === "adhoc") {
				return enumerateSlotDates({ type: "adhoc", date: form.date }, today);
			}
			return enumerateSlotDates(
				{ type: "monthly", month: form.month, weekday: form.weekday },
				today,
			);
		} catch {
			return [];
		}
	}, [form.type, form.date, form.month, form.weekday, today]);

	const rate = settings?.flat_hourly_rate_vnd ?? 0;
	const amountPreview =
		rate > 0 && enumeratedDates.length > 0
			? computeAmountVnd(rate, form.blockCount, enumeratedDates.length)
			: null;

	function update<K extends keyof FormState>(key: K, value: FormState[K]) {
		setForm((f) => ({ ...f, [key]: value }));
	}

	function buildInput(): ManualBookingInput {
		const base = {
			courtId: effectiveCourtId,
			customerName: form.customerName,
			zaloPhone: form.zaloPhone,
			groupSize: form.groupSize,
			startTime: form.startTime,
			blockCount: form.blockCount,
		};
		if (form.type === "adhoc") {
			return { type: "adhoc", date: form.date, ...base };
		}
		return { type: "monthly", month: form.month, weekday: form.weekday, ...base };
	}

	function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		const parsed = manualBookingInputSchema.safeParse(buildInput());
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Vui lòng kiểm tra lại biểu mẫu.");
			return;
		}
		startTransition(async () => {
			try {
				const result = await createManualBooking(parsed.data);
				if (result.ok) {
					setSuccess(result.data);
					// Confirmed bookings list is now stale.
					queryClient.invalidateQueries({ queryKey: ["bookings"] });
				} else {
					setError(result.error);
				}
			} catch {
				setError("Không tạo được lượt đặt. Vui lòng thử lại.");
			}
		});
	}

	if (success) {
		return (
			<div className="rounded-xl border border-brand-green/40 bg-brand-green-soft/25 p-5 shadow-court">
				<div className="font-display text-lg font-medium text-ink">Đã xác nhận lượt đặt</div>
				<div className="mt-1 text-sm text-ink-soft">
					Mã đặt <span className="font-mono">{success.reference}</span> · {success.occurrences} buổi
					· {formatVnd(success.amountVnd)}
				</div>
				<Button size="sm" className="mt-3" onClick={() => setSuccess(null)}>
					Đặt sân mới
				</Button>
			</div>
		);
	}

	if (activeCourts.length === 0) {
		return <p className="text-sm text-ink-faint">Vui lòng thêm một sân đang mở trước.</p>;
	}

	const times = court ? startTimeOptions(court) : [];

	return (
		<form
			onSubmit={onSubmit}
			className="max-w-xl space-y-5 rounded-xl border border-line bg-card p-5 shadow-court sm:p-6"
		>
			<Field label="Tên khách hàng">
				<input
					type="text"
					required
					value={form.customerName}
					onChange={(e) => update("customerName", e.target.value)}
					className={inputClass}
				/>
			</Field>

			<Field label="Zalo">
				<input
					type="tel"
					required
					inputMode="tel"
					value={form.zaloPhone}
					onChange={(e) => update("zaloPhone", e.target.value)}
					placeholder="0901234567"
					className={inputClass}
				/>
			</Field>

			<Field label="Sân">
				<select
					value={effectiveCourtId}
					onChange={(e) => update("courtId", e.target.value)}
					className={inputClass}
				>
					{activeCourts.map((c) => (
						<option key={c.id} value={c.id}>
							{c.name} ({c.open_time.slice(0, 5)}–{c.close_time.slice(0, 5)})
						</option>
					))}
				</select>
			</Field>

			<Field label="Loại đặt sân">
				<div className="flex gap-2">
					{(["adhoc", "monthly"] as const).map((t) => (
						<button
							key={t}
							type="button"
							onClick={() => update("type", t)}
							className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
								form.type === t
									? "bg-primary text-on-dark"
									: "border border-line-strong text-ink-soft"
							}`}
						>
							{t === "adhoc" ? "Lẻ" : "Theo tháng"}
						</button>
					))}
				</div>
			</Field>

			{form.type === "adhoc" ? (
				<Field label="Ngày">
					<input
						type="date"
						required
						min={today}
						value={form.date}
						onChange={(e) => update("date", e.target.value)}
						className={inputClass}
					/>
				</Field>
			) : (
				<>
					<Field label="Tháng áp dụng">
						<div className="flex gap-2">
							{[currentMonth, nextMonthStart(currentMonth)].map((m) => (
								<button
									key={m}
									type="button"
									onClick={() => update("month", m)}
									className={`flex-1 rounded-md px-3 py-2 text-sm ${
										form.month === m
											? "bg-secondary text-ink"
											: "border border-line-strong text-ink-soft"
									}`}
								>
									{monthLabel(m)}
								</button>
							))}
						</div>
					</Field>
					<Field label="Thứ">
						<select
							value={form.weekday}
							onChange={(e) => update("weekday", Number(e.target.value))}
							className={inputClass}
						>
							{WEEKDAYS.map((w, i) => (
								<option key={w} value={i}>
									{w}
								</option>
							))}
						</select>
					</Field>
				</>
			)}

			<Field label="Giờ bắt đầu">
				<select
					required
					value={form.startTime}
					onChange={(e) => update("startTime", e.target.value)}
					className={inputClass}
				>
					<option value="">Chọn giờ</option>
					{times.map((t) => (
						<option key={t} value={t}>
							{t}
						</option>
					))}
				</select>
			</Field>

			<Field label="Thời lượng">
				<select
					value={form.blockCount}
					onChange={(e) => update("blockCount", Number(e.target.value))}
					className={inputClass}
				>
					{Array.from({ length: MAX_BLOCK_COUNT }, (_, i) => i + 1).map((n) => (
						<option key={n} value={n}>
							{n * 30} phút ({n / 2} giờ)
						</option>
					))}
				</select>
			</Field>

			<Field label="Số người">
				<input
					type="number"
					min={1}
					value={form.groupSize}
					onChange={(e) => update("groupSize", Number(e.target.value))}
					className={inputClass}
				/>
			</Field>

			<div className="rounded-lg bg-secondary p-3 text-sm">
				<div className="flex items-center justify-between">
					<span className="text-ink-soft">Số tiền</span>
					<span className="text-lg font-semibold tabular-nums">
						{amountPreview === null ? "—" : formatVnd(amountPreview)}
					</span>
				</div>
				{amountPreview !== null && form.type === "monthly" && (
					<p className="mt-1 text-xs text-ink-faint">
						{enumeratedDates.length} buổi × {form.blockCount / 2} giờ
					</p>
				)}
			</div>

			{error && (
				<p className="rounded-md bg-signal-red-soft px-3 py-2 text-sm text-signal-red">{error}</p>
			)}

			<Button type="submit" size="lg" disabled={pending} className="h-11 w-full">
				{pending ? "Đang tạo…" : "Tạo lượt đặt đã xác nhận"}
			</Button>
		</form>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		// The control is the children, nested inside this label; Biome can't see through the boundary.
		// biome-ignore lint/a11y/noLabelWithoutControl: control is the children, nested in the label
		<label className="block space-y-1">
			<span className="text-sm font-medium text-ink-soft">{label}</span>
			{children}
		</label>
	);
}
