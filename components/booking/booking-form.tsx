"use client";

import { useMemo, useState, useTransition } from "react";
import { createBooking } from "@/lib/actions/create-booking";
import { MAX_BLOCK_COUNT } from "@/lib/booking/constants";
import { enumerateSlotDates, ictToday } from "@/lib/booking/dates";
import {
	minutesToTime,
	monthLabel,
	monthStartOf,
	nextMonthStart,
	rangeStartIctMinutes,
	timeToMinutes,
} from "@/lib/booking/grid";
import { computeAmountVnd } from "@/lib/booking/pricing";
import { type BookingInput, bookingInputSchema } from "@/lib/booking/schemas";
import { useAvailability } from "@/lib/queries/availability";
import { useCourts, useSettings } from "@/lib/queries/dashboard";
import type { CourtRow } from "@/lib/queries/types";
import { BookingReceiptScreen } from "./booking-receipt";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Format a VND integer with thousands separators. */
function formatVnd(amount: number): string {
	return `${amount.toLocaleString("en-US")} ₫`;
}

/** Build the list of 30-min start-time options within a court's window. */
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
	date: string; // adhoc
	month: string; // monthly (first-of-month)
	weekday: number; // monthly
};

export function BookingForm() {
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
	const [receipt, setReceipt] = useState<Awaited<ReturnType<typeof createBooking>> | null>(null);
	const [pending, startTransition] = useTransition();

	const court = activeCourts.find((c) => c.id === form.courtId) ?? activeCourts[0] ?? null;
	const effectiveCourtId = court?.id ?? "";

	// Enumerated occurrence dates (mirror of the SQL fn) for preview + badges.
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

	// Amount preview via the shared pricing path (§8). Empty rate => no preview.
	const rate = settings?.flat_hourly_rate_vnd ?? 0;
	const amountPreview =
		rate > 0 && enumeratedDates.length > 0
			? computeAmountVnd(rate, form.blockCount, enumeratedDates.length)
			: null;

	// Availability for the relevant month, to compute per-occurrence free/taken
	// badges. Adhoc uses the date's month; monthly uses the target month.
	const badgeMonth = form.type === "adhoc" ? monthStartOf(form.date) : form.month;
	const { data: availability } = useAvailability(effectiveCourtId, badgeMonth);

	const occupiedByDate = useMemo(() => {
		const map = new Map<string, Set<number>>();
		for (const row of availability ?? []) {
			let set = map.get(row.slot_date);
			if (!set) {
				set = new Set<number>();
				map.set(row.slot_date, set);
			}
			set.add(rangeStartIctMinutes(row.time_range));
		}
		return map;
	}, [availability]);

	/** Does the requested block span overlap an occupied block on this date? */
	const isDateTaken = (date: string): boolean => {
		if (!form.startTime) {
			return false;
		}
		const occupied = occupiedByDate.get(date);
		if (!occupied) {
			return false;
		}
		const start = timeToMinutes(form.startTime);
		for (let i = 0; i < form.blockCount; i++) {
			if (occupied.has(start + i * 30)) {
				return true;
			}
		}
		return false;
	};

	function update<K extends keyof FormState>(key: K, value: FormState[K]) {
		setForm((f) => ({ ...f, [key]: value }));
	}

	function buildInput(): BookingInput {
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
		const input = buildInput();
		// Client-side Zod is UX-only (§2); the server re-validates authoritatively.
		const parsed = bookingInputSchema.safeParse(input);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Please check the form.");
			return;
		}
		startTransition(async () => {
			const result = await createBooking(parsed.data);
			if (result.ok) {
				setReceipt(result);
			} else {
				setError(result.error);
			}
		});
	}

	if (receipt?.ok) {
		return <BookingReceiptScreen receipt={receipt.data} />;
	}

	if (activeCourts.length === 0) {
		return <p className="text-sm text-zinc-500">No courts are open for booking yet.</p>;
	}

	const times = court ? startTimeOptions(court) : [];

	return (
		<form onSubmit={onSubmit} className="space-y-5">
			<Field label="Your name">
				<input
					type="text"
					required
					value={form.customerName}
					onChange={(e) => update("customerName", e.target.value)}
					className={inputClass}
				/>
			</Field>

			<Field label="Zalo phone">
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

			<Field label="Court">
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

			<Field label="Booking type">
				<div className="flex gap-2">
					{(["adhoc", "monthly"] as const).map((t) => (
						<button
							key={t}
							type="button"
							onClick={() => update("type", t)}
							className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
								form.type === t
									? "bg-emerald-600 text-white"
									: "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
							}`}
						>
							{t === "adhoc" ? "One-off (ad-hoc)" : "Monthly"}
						</button>
					))}
				</div>
			</Field>

			{form.type === "adhoc" ? (
				<Field label="Date">
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
					<Field label="Target month">
						<div className="flex gap-2">
							{[currentMonth, nextMonthStart(currentMonth)].map((m) => (
								<button
									key={m}
									type="button"
									onClick={() => update("month", m)}
									className={`flex-1 rounded-md px-3 py-2 text-sm ${
										form.month === m
											? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
											: "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
									}`}
								>
									{monthLabel(m)}
								</button>
							))}
						</div>
					</Field>
					<Field label="Weekday">
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

			<Field label="Start time">
				<select
					required
					value={form.startTime}
					onChange={(e) => update("startTime", e.target.value)}
					className={inputClass}
				>
					<option value="">Select a time</option>
					{times.map((t) => (
						<option key={t} value={t}>
							{t}
						</option>
					))}
				</select>
			</Field>

			<Field label="Duration">
				<select
					value={form.blockCount}
					onChange={(e) => update("blockCount", Number(e.target.value))}
					className={inputClass}
				>
					{Array.from({ length: MAX_BLOCK_COUNT }, (_, i) => i + 1).map((n) => (
						<option key={n} value={n}>
							{n * 30} min ({n / 2} h)
						</option>
					))}
				</select>
			</Field>

			<Field label="Group size">
				<input
					type="number"
					min={1}
					value={form.groupSize}
					onChange={(e) => update("groupSize", Number(e.target.value))}
					className={inputClass}
				/>
			</Field>

			{enumeratedDates.length > 0 && (
				<div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
					<div className="mb-2 text-sm font-medium">
						{form.type === "monthly" ? "Sessions this month" : "Session"}
					</div>
					<ul className="space-y-1 text-sm">
						{enumeratedDates.map((d) => {
							const taken = isDateTaken(d);
							return (
								<li key={d} className="flex items-center justify-between">
									<span>{dateLabel(d)}</span>
									<span
										className={
											taken
												? "rounded bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
												: "rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
										}
									>
										{taken ? "taken" : "free"}
									</span>
								</li>
							);
						})}
					</ul>
				</div>
			)}

			<div className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
				<div className="flex items-center justify-between">
					<span className="text-zinc-600 dark:text-zinc-400">Amount</span>
					<span className="text-lg font-semibold tabular-nums">
						{amountPreview === null ? "—" : formatVnd(amountPreview)}
					</span>
				</div>
				{amountPreview !== null && form.type === "monthly" && (
					<p className="mt-1 text-xs text-zinc-500">
						{enumeratedDates.length} session{enumeratedDates.length === 1 ? "" : "s"} ×{" "}
						{form.blockCount / 2} h
					</p>
				)}
			</div>

			{error && (
				<p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
					{error}
				</p>
			)}

			<button
				type="submit"
				disabled={pending}
				className="w-full rounded-md bg-emerald-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
			>
				{pending ? "Submitting…" : "Request booking"}
			</button>
		</form>
	);
}

const inputClass =
	"w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		// The control is passed as children and rendered inside this label, so the
		// label is correctly associated; Biome can't see through the component boundary.
		// biome-ignore lint/a11y/noLabelWithoutControl: control is the children, nested in the label
		<label className="block space-y-1">
			<span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
			{children}
		</label>
	);
}

function dateLabel(date: string): string {
	return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
		weekday: "short",
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
}
