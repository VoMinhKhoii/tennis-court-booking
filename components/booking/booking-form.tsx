"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { createHold } from "@/lib/actions/create-booking";
import { MAX_BLOCK_COUNT } from "@/lib/booking/constants";
import { enumerateSlotDatesMulti, ictToday } from "@/lib/booking/dates";
import { formatVnd } from "@/lib/booking/format";
import {
	minutesToTime,
	monthLabel,
	monthStartOf,
	nextMonthStart,
	rangeIctBlockStarts,
	timeToMinutes,
} from "@/lib/booking/grid";
import { computeAmountVnd } from "@/lib/booking/pricing";
import { type BookingInput, bookingInputSchema } from "@/lib/booking/schemas";
import { useAvailabilityAllCourts } from "@/lib/queries/availability";
import { usePublicCourts, usePublicSettings } from "@/lib/queries/public";
import { CheckoutShell, OrderSummary } from "./checkout-shell";
import { clearCheckout, loadCheckout, saveCheckout } from "./checkout-storage";

// Chip order Mon→Sun (values stay 0=Sun..6=Sat to match Postgres dow).
const WEEKDAY_CHIPS: { value: number; label: string }[] = [
	{ value: 1, label: "T2" },
	{ value: 2, label: "T3" },
	{ value: 3, label: "T4" },
	{ value: 4, label: "T5" },
	{ value: 5, label: "T6" },
	{ value: 6, label: "T7" },
	{ value: 0, label: "CN" },
];

/** Prefill from a grid selection or an owner deep-link. No court is chosen. */
export type BookingInitial = Partial<{
	type: "adhoc" | "monthly";
	date: string;
	month: string;
	weekdays: number[];
	startTime: string;
	blockCount: number;
	preferredCourtId: string;
}>;

/** Start-time options (within a [open, close) window) that still fit the duration. */
function startTimeOptions(openMin: number, closeMin: number, blockCount: number): string[] {
	const duration = Math.max(1, blockCount) * 30;
	const out: string[] = [];
	for (let m = openMin; m + duration <= closeMin; m += 30) {
		out.push(minutesToTime(m));
	}
	return out;
}

type FormState = {
	type: "adhoc" | "monthly";
	preferredCourtId: string; // "" = auto (balanced)
	customerName: string;
	zaloPhone: string;
	groupSize: number;
	startTime: string;
	blockCount: number;
	date: string;
	month: string;
	weekdays: number[];
};

export function BookingForm({
	initial,
	lockSlot = false,
}: {
	initial?: BookingInitial;
	lockSlot?: boolean;
}) {
	const router = useRouter();
	const { data: courts } = usePublicCourts();
	const { data: settings } = usePublicSettings();
	const activeCourts = useMemo(() => (courts ?? []).filter((c) => c.is_active), [courts]);

	const today = useMemo(() => ictToday(), []);
	const currentMonth = useMemo(() => monthStartOf(today), [today]);

	const [form, setForm] = useState<FormState>(() => ({
		type: initial?.type ?? "adhoc",
		preferredCourtId: initial?.preferredCourtId ?? "",
		customerName: "",
		zaloPhone: "",
		groupSize: 1,
		startTime: initial?.startTime ?? "",
		blockCount: initial?.blockCount ?? 2,
		date: initial?.date ?? today,
		month: initial?.month ?? currentMonth,
		weekdays: initial?.weekdays ?? [],
	}));
	const [stage, setStage] = useState<"form" | "review">("form");
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	// Tab-close recovery: if a live hold is saved locally, offer to resume it.
	// The hold itself lives on /book/[reference]; this is just a convenience link.
	const [resumeRef, setResumeRef] = useState<string | null>(null);
	useEffect(() => {
		const saved = loadCheckout();
		if (saved) setResumeRef(saved.reference);
	}, []);

	// Union operating window across all courts (court is auto-assigned later).
	const { openMin, closeMin } = useMemo(() => {
		let open = Number.POSITIVE_INFINITY;
		let close = Number.NEGATIVE_INFINITY;
		for (const c of activeCourts) {
			open = Math.min(open, timeToMinutes(c.open_time));
			close = Math.max(close, timeToMinutes(c.close_time));
		}
		return {
			openMin: Number.isFinite(open) ? open : 0,
			closeMin: Number.isFinite(close) ? close : 0,
		};
	}, [activeCourts]);

	const enumeratedDates = useMemo<string[]>(() => {
		try {
			if (form.type === "adhoc") {
				return form.date ? [form.date] : [];
			}
			return enumerateSlotDatesMulti(form.month, form.weekdays, today);
		} catch {
			return [];
		}
	}, [form.type, form.date, form.month, form.weekdays, today]);

	const rate = settings?.flat_hourly_rate_vnd ?? 0;
	const amountPreview =
		rate > 0 && enumeratedDates.length > 0
			? computeAmountVnd(rate, form.blockCount, enumeratedDates.length)
			: null;

	const badgeMonth = form.type === "adhoc" ? monthStartOf(form.date) : form.month;
	const { data: availability } = useAvailabilityAllCourts(badgeMonth);

	// date -> (court_id -> occupied block-start minutes).
	const occByDateCourt = useMemo(() => {
		const map = new Map<string, Map<string, Set<number>>>();
		for (const row of availability ?? []) {
			let byCourt = map.get(row.slot_date);
			if (!byCourt) {
				byCourt = new Map<string, Set<number>>();
				map.set(row.slot_date, byCourt);
			}
			let set = byCourt.get(row.court_id);
			if (!set) {
				set = new Set<number>();
				byCourt.set(row.court_id, set);
			}
			for (const min of rangeIctBlockStarts(row.time_range)) {
				set.add(min);
			}
		}
		return map;
	}, [availability]);

	// How many courts can host the FULL range on this date (open + no conflict).
	const freeCourtsForRange = (date: string): number => {
		if (!form.startTime) return activeCourts.length;
		const start = timeToMinutes(form.startTime);
		const end = start + form.blockCount * 30;
		let count = 0;
		for (const c of activeCourts) {
			if (start < timeToMinutes(c.open_time) || end > timeToMinutes(c.close_time)) continue;
			const occ = occByDateCourt.get(date)?.get(c.id);
			let ok = true;
			if (occ) {
				for (let i = 0; i < form.blockCount; i++) {
					if (occ.has(start + i * 30)) {
						ok = false;
						break;
					}
				}
			}
			if (ok) count += 1;
		}
		return count;
	};
	const isDateTaken = (date: string): boolean =>
		Boolean(form.startTime) && freeCourtsForRange(date) === 0;

	function update<K extends keyof FormState>(key: K, value: FormState[K]) {
		setForm((f) => ({ ...f, [key]: value }));
	}

	function toggleWeekday(wd: number) {
		setForm((f) => ({
			...f,
			weekdays: f.weekdays.includes(wd) ? f.weekdays.filter((d) => d !== wd) : [...f.weekdays, wd],
		}));
	}

	function buildInput(): BookingInput {
		const base = {
			customerName: form.customerName,
			zaloPhone: form.zaloPhone,
			groupSize: form.groupSize,
			startTime: form.startTime,
			blockCount: form.blockCount,
			preferredCourtId: form.preferredCourtId || undefined,
		};
		if (form.type === "adhoc") {
			return { type: "adhoc", date: form.date, ...base };
		}
		return { type: "monthly", month: form.month, weekdays: form.weekdays, ...base };
	}

	function onReview(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		const parsed = bookingInputSchema.safeParse(buildInput());
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Vui lòng kiểm tra lại thông tin.");
			return;
		}
		setStage("review");
	}

	// Confirm → create the soft-hold, then redirect to the hosted-checkout page
	// keyed by the reference. The reference in the URL is the source of truth, so
	// the payment step survives any reload (no modal to evaporate).
	function onConfirm() {
		setError(null);
		const parsed = bookingInputSchema.safeParse(buildInput());
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Vui lòng kiểm tra lại thông tin.");
			setStage("form");
			return;
		}
		startTransition(async () => {
			const result = await createHold(parsed.data);
			if (result.ok) {
				saveCheckout({
					reference: result.data.reference,
					holdExpiresAt: result.data.holdExpiresAt,
				});
				router.replace(`/book/${result.data.reference}`);
			} else {
				setError(result.error);
				setStage("form");
			}
		});
	}

	if (activeCourts.length === 0) {
		return (
			<main className="mx-auto w-full max-w-lg flex-1 px-4 py-6 sm:px-6">
				<p className="text-sm text-ink-faint">Hiện chưa có sân nào mở đặt.</p>
			</main>
		);
	}

	const times = startTimeOptions(openMin, closeMin, form.blockCount);
	const endTime =
		form.startTime && form.blockCount
			? minutesToTime(timeToMinutes(form.startTime) + form.blockCount * 30)
			: null;

	const timeItems = times.map((t) => ({ value: t, label: t }));
	const durationItems = Array.from({ length: MAX_BLOCK_COUNT }, (_, i) => ({
		value: String(i + 1),
		label: `${(i + 1) / 2} giờ`,
	}));
	const courtItems = [
		{ value: "", label: "Tự động (cân bằng)" },
		...activeCourts.map((c) => ({ value: c.id, label: c.name })),
	];
	const preferredCourtName = activeCourts.find((c) => c.id === form.preferredCourtId)?.name ?? null;

	// ---- Live order summary (the Stripe sidebar) ---------------------------
	const weekdaysLabel = WEEKDAY_CHIPS.filter((w) => form.weekdays.includes(w.value))
		.map((w) => w.label)
		.join(", ");
	const summaryRows: { label: string; value: ReactNode }[] = [
		{ label: "Loại", value: form.type === "monthly" ? "Hàng tháng" : "Một buổi" },
	];
	if (form.startTime) {
		summaryRows.push({
			label: "Khung giờ",
			value: (
				<span className="font-mono font-bold tabular-nums">
					{form.startTime}
					{endTime ? `–${endTime}` : ""} ({form.blockCount / 2} giờ)
				</span>
			),
		});
	}
	if (form.type === "monthly") {
		summaryRows.push({ label: "Các thứ", value: weekdaysLabel || "—" });
	}
	summaryRows.push({ label: "Sân", value: preferredCourtName ?? "Tự động xếp sân" });
	if (enumeratedDates.length > 0) {
		summaryRows.push({ label: "Số buổi", value: String(enumeratedDates.length) });
	}
	const totalNode = amountPreview === null ? "—" : formatVnd(amountPreview);
	const summaryNode = (
		<OrderSummary
			rows={summaryRows}
			amount={totalNode}
			note={
				amountPreview !== null && form.type === "monthly" ? (
					<p className="text-xs text-ink-faint">
						{enumeratedDates.length} buổi × {form.blockCount / 2} giờ
					</p>
				) : undefined
			}
		/>
	);

	// ---- Review stage: read-only details, then create the hold. -------------
	if (stage === "review") {
		return (
			<CheckoutShell summary={summaryNode} total={totalNode}>
				<div className="space-y-5">
					<Stepper stage={stage} />
					<ReviewBill
						type={form.type}
						startTime={form.startTime}
						endTime={endTime}
						blockCount={form.blockCount}
						weekdays={form.weekdays}
						preferredCourtName={preferredCourtName}
						customerName={form.customerName}
						zaloPhone={form.zaloPhone}
						groupSize={form.groupSize}
						dates={enumeratedDates}
						isDateTaken={isDateTaken}
					/>

					{error && (
						<p className="rounded-lg bg-signal-red-soft px-3 py-2 text-sm font-medium text-signal-red">
							{error}
						</p>
					)}

					<div className="flex gap-3">
						<Button
							type="button"
							variant="outline"
							size="lg"
							className="flex-1"
							disabled={pending}
							onClick={() => setStage("form")}
						>
							Quay lại
						</Button>
						<Button
							type="button"
							size="lg"
							className="flex-[2]"
							disabled={pending}
							onClick={onConfirm}
						>
							{pending ? "Đang xử lý…" : "Tiến hành thanh toán"}
						</Button>
					</div>
					<p className="text-center text-xs text-ink-faint">
						Bước tiếp theo hiển thị mã QR chuyển khoản. Chủ sân xác nhận sau khi nhận tiền.
					</p>
				</div>
			</CheckoutShell>
		);
	}

	// ---- Form stage --------------------------------------------------------
	return (
		<CheckoutShell summary={summaryNode} total={totalNode}>
			<form onSubmit={onReview} className="space-y-5">
				<Stepper stage="form" />

				{resumeRef && (
					<div className="flex items-center justify-between gap-3 rounded-lg border border-court-300 bg-court-50 px-3 py-2.5 text-sm">
						<span className="text-court-900">Bạn đang có một lượt giữ chỗ chưa hoàn tất.</span>
						<div className="flex shrink-0 items-center gap-1">
							<Link
								href={`/book/${resumeRef}`}
								className="font-semibold text-court-700 hover:underline"
							>
								Tiếp tục
							</Link>
							<button
								type="button"
								onClick={() => {
									clearCheckout();
									setResumeRef(null);
								}}
								className="cursor-pointer rounded px-1.5 text-ink-faint hover:text-ink"
								aria-label="Bỏ qua"
							>
								✕
							</button>
						</div>
					</div>
				)}

				{lockSlot ? (
					<LockedTimeSummary
						type={form.type}
						startTime={form.startTime}
						endTime={endTime}
						blockCount={form.blockCount}
					/>
				) : (
					<div className="space-y-1.5">
						<Label>Loại đặt sân</Label>
						<SegToggle
							options={[
								{ value: "adhoc", label: "Một buổi" },
								{ value: "monthly", label: "Hàng tháng" },
							]}
							value={form.type}
							onChange={(v) => update("type", v as FormState["type"])}
						/>
					</div>
				)}

				{form.type === "adhoc" ? (
					!lockSlot && (
						<Field id="date" label="Ngày">
							<Input
								id="date"
								type="date"
								required
								min={today}
								value={form.date}
								onChange={(e) => update("date", e.target.value)}
								className="h-11"
							/>
						</Field>
					)
				) : (
					<>
						<div className="space-y-1.5">
							<Label>Tháng áp dụng</Label>
							<SegToggle
								options={[currentMonth, nextMonthStart(currentMonth)].map((m) => ({
									value: m,
									label: monthLabel(m),
								}))}
								value={form.month}
								onChange={(v) => update("month", v)}
							/>
						</div>
						<div className="space-y-1.5">
							<Label>Các thứ trong tuần</Label>
							<div className="flex flex-wrap gap-1.5">
								{WEEKDAY_CHIPS.map((w) => {
									const on = form.weekdays.includes(w.value);
									return (
										<button
											key={w.value}
											type="button"
											onClick={() => toggleWeekday(w.value)}
											aria-pressed={on}
											className={`h-10 w-10 cursor-pointer rounded-md text-sm font-semibold transition-colors ${
												on
													? "bg-court-900 text-white shadow-court"
													: "border border-line-strong bg-paper-raised text-ink-soft hover:border-court-500"
											}`}
										>
											{w.label}
										</button>
									);
								})}
							</div>
							<p className="text-xs text-ink-faint">
								Chọn một hoặc nhiều thứ — sân giữ vào các thứ đó hằng tuần.
							</p>
						</div>
					</>
				)}

				{!lockSlot && (
					<div className="grid grid-cols-2 gap-3">
						<Field id="start" label="Giờ bắt đầu">
							<Select
								items={timeItems}
								value={form.startTime}
								onValueChange={(v) => update("startTime", String(v))}
							>
								<SelectTrigger id="start" className="h-11 w-full">
									<SelectValue placeholder="Chọn giờ" />
								</SelectTrigger>
								<SelectContent>
									{times.map((t) => (
										<SelectItem key={t} value={t}>
											{t}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
						<Field id="duration" label="Thời lượng">
							<Select
								items={durationItems}
								value={String(form.blockCount)}
								onValueChange={(v) => update("blockCount", Number(v))}
							>
								<SelectTrigger id="duration" className="h-11 w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{Array.from({ length: MAX_BLOCK_COUNT }, (_, i) => i + 1).map((n) => (
										<SelectItem key={n} value={String(n)}>
											{n / 2} giờ
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					</div>
				)}

				<Field id="court" label="Sân ưu tiên">
					<Select
						items={courtItems}
						value={form.preferredCourtId}
						onValueChange={(v) => update("preferredCourtId", String(v))}
					>
						<SelectTrigger id="court" className="h-11 w-full">
							<SelectValue placeholder="Tự động (cân bằng)" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">Tự động (cân bằng)</SelectItem>
							{activeCourts.map((c) => (
								<SelectItem key={c.id} value={c.id}>
									{c.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>

				<div className="grid gap-4 sm:grid-cols-2">
					<Field id="name" label="Họ và tên">
						<Input
							id="name"
							type="text"
							required
							value={form.customerName}
							onChange={(e) => update("customerName", e.target.value)}
							placeholder="Nguyễn Văn A"
							className="h-11"
						/>
					</Field>
					<Field id="zalo" label="Số Zalo">
						<Input
							id="zalo"
							type="tel"
							required
							inputMode="tel"
							value={form.zaloPhone}
							onChange={(e) => update("zaloPhone", e.target.value)}
							placeholder="0901234567"
							className="h-11"
						/>
					</Field>
				</div>

				<Field id="group" label="Số người">
					<Input
						id="group"
						type="number"
						min={1}
						value={form.groupSize}
						onChange={(e) => update("groupSize", Number(e.target.value))}
						className="h-11 w-32"
					/>
				</Field>

				{enumeratedDates.length > 0 && (
					<div className="rounded-lg border border-line bg-paper p-3">
						<div className="mb-2 text-sm font-semibold text-ink">
							{form.type === "monthly"
								? `Các buổi trong tháng (${enumeratedDates.length})`
								: "Buổi đã chọn"}
						</div>
						<ul className="space-y-1.5 text-sm">
							{enumeratedDates.map((d) => {
								const taken = isDateTaken(d);
								return (
									<li key={d} className="flex items-center justify-between gap-2">
										<span className="text-ink-soft">{dateLabel(d)}</span>
										<StatusPill tone={taken ? "taken" : "free"}>
											{taken ? "kín sân" : "còn trống"}
										</StatusPill>
									</li>
								);
							})}
						</ul>
					</div>
				)}

				{error && (
					<p className="rounded-lg bg-signal-red-soft px-3 py-2 text-sm font-medium text-signal-red">
						{error}
					</p>
				)}

				<Button type="submit" size="lg" disabled={pending} className="w-full">
					Tiếp tục
				</Button>
				<p className="text-center text-xs text-ink-faint">
					Bạn sẽ xem lại thông tin trước khi thanh toán.
				</p>
			</form>
		</CheckoutShell>
	);
}

/** Wizard progress: Thông tin → Xác nhận → Thanh toán → Hoàn tất. */
export const WIZARD_STEPS: { stage: "form" | "review" | "payment" | "done"; label: string }[] = [
	{ stage: "form", label: "Thông tin" },
	{ stage: "review", label: "Xác nhận" },
	{ stage: "payment", label: "Thanh toán" },
	{ stage: "done", label: "Hoàn tất" },
];

export function Stepper({ stage }: { stage: "form" | "review" | "payment" | "done" }) {
	const activeIndex = WIZARD_STEPS.findIndex((s) => s.stage === stage);
	return (
		<ol className="flex items-center gap-1.5" aria-label="Tiến trình đặt sân">
			{WIZARD_STEPS.map((step, i) => {
				const done = i < activeIndex;
				const active = i === activeIndex;
				return (
					<li key={step.stage} className="flex flex-1 items-center gap-1.5">
						<div className="flex min-w-0 flex-1 flex-col gap-1">
							<span
								className={`h-1 rounded-full transition-colors ${
									done || active ? "bg-court-600" : "bg-line"
								}`}
							/>
							<span
								className={`truncate text-[11px] font-semibold ${
									active ? "text-court-800" : done ? "text-ink-soft" : "text-ink-faint"
								}`}
								aria-current={active ? "step" : undefined}
							>
								{step.label}
							</span>
						</div>
					</li>
				);
			})}
		</ol>
	);
}

function ReviewBill({
	type,
	startTime,
	endTime,
	blockCount,
	weekdays,
	preferredCourtName,
	customerName,
	zaloPhone,
	groupSize,
	dates,
	isDateTaken,
}: {
	type: "adhoc" | "monthly";
	startTime: string;
	endTime: string | null;
	blockCount: number;
	weekdays: number[];
	preferredCourtName: string | null;
	customerName: string;
	zaloPhone: string;
	groupSize: number;
	dates: string[];
	isDateTaken: (d: string) => boolean;
}) {
	const weekdaysLabel = WEEKDAY_CHIPS.filter((w) => weekdays.includes(w.value))
		.map((w) => w.label)
		.join(", ");
	return (
		<div className="space-y-4">
			<div>
				<h3 className="font-display text-lg font-bold text-ink">Xác nhận đặt sân</h3>
				<p className="text-sm text-ink-soft">Kiểm tra lại thông tin trước khi thanh toán.</p>
			</div>

			<div className="rounded-xl border border-court-200 bg-court-25 p-4">
				<dl className="space-y-2 text-sm">
					<Row label="Loại" value={type === "monthly" ? "Hàng tháng" : "Một buổi"} />
					<Row
						label="Khung giờ"
						value={
							<span className="font-mono font-bold tabular-nums text-ink">
								{startTime}
								{endTime ? `–${endTime}` : ""} ({blockCount / 2} giờ)
							</span>
						}
					/>
					{type === "monthly" && <Row label="Các thứ" value={weekdaysLabel || "—"} />}
					<Row label="Sân" value={preferredCourtName ?? "Tự động xếp sân"} />
					<Row label="Người đặt" value={`${customerName} · ${zaloPhone} · ${groupSize} người`} />
				</dl>
			</div>

			{dates.length > 0 && (
				<div className="rounded-lg border border-line bg-paper p-3">
					<div className="mb-2 text-sm font-semibold text-ink">
						{type === "monthly" ? `Các buổi (${dates.length})` : "Buổi đã chọn"}
					</div>
					<ul className="space-y-1.5 text-sm">
						{dates.map((d) => {
							const taken = isDateTaken(d);
							return (
								<li key={d} className="flex items-center justify-between gap-2">
									<span className="text-ink-soft">{dateLabel(d)}</span>
									<StatusPill tone={taken ? "taken" : "free"}>
										{taken ? "kín sân" : "còn trống"}
									</StatusPill>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</div>
	);
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="flex items-start justify-between gap-3">
			<dt className="shrink-0 text-ink-faint">{label}</dt>
			<dd className="text-right text-ink">{value}</dd>
		</div>
	);
}

function LockedTimeSummary({
	type,
	startTime,
	endTime,
	blockCount,
}: {
	type: "adhoc" | "monthly";
	startTime: string;
	endTime: string | null;
	blockCount: number;
}) {
	return (
		<div className="rounded-xl border border-court-200 bg-court-25 p-4">
			<div className="flex items-center justify-between">
				<span className="font-display text-sm font-bold text-court-900">Khung giờ đã chọn</span>
				<StatusPill tone={type === "monthly" ? "confirmed" : "free"}>
					{type === "monthly" ? "Hàng tháng" : "Một buổi"}
				</StatusPill>
			</div>
			<p className="mt-2 font-mono text-lg font-bold tabular-nums text-ink">
				{startTime}
				{endTime ? `–${endTime}` : ""}{" "}
				<span className="text-sm font-normal text-ink-faint">({blockCount / 2} giờ)</span>
			</p>
		</div>
	);
}

function SegToggle<T extends string>({
	options,
	value,
	onChange,
}: {
	options: { value: T; label: string }[];
	value: T;
	onChange: (v: T) => void;
}) {
	return (
		<div className="flex gap-1 rounded-lg border border-line bg-paper p-1">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					onClick={() => onChange(o.value)}
					className={`flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
						value === o.value
							? "bg-court-900 text-white shadow-court"
							: "text-ink-soft hover:bg-court-50"
					}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>{label}</Label>
			{children}
		</div>
	);
}

function dateLabel(date: string): string {
	return new Date(`${date}T00:00:00Z`).toLocaleDateString("vi-VN", {
		weekday: "short",
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
}
