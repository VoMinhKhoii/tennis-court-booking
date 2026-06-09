"use client";

import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useEffect, useMemo, useState, useTransition } from "react";
import { updateSettings, uploadQrImage } from "@/lib/actions/owner";
import { settingsInputSchema } from "@/lib/booking/schemas";
import { useSettings } from "@/lib/queries/dashboard";
import type { SettingsRow } from "@/lib/queries/types";
import { createClient } from "@/lib/supabase/client";

const inputClass =
	"w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

export function SettingsPanel() {
	const queryClient = useQueryClient();
	const { data: settings, isLoading } = useSettings();

	if (isLoading) {
		return <p className="text-sm text-zinc-500">Loading…</p>;
	}

	return (
		<div className="space-y-8">
			<RateForm
				settings={settings ?? null}
				onDone={() => queryClient.invalidateQueries({ queryKey: ["settings"] })}
			/>
			<QrUpload
				qrImagePath={settings?.qr_image_path ?? null}
				onDone={() => queryClient.invalidateQueries({ queryKey: ["settings"] })}
			/>
		</div>
	);
}

function RateForm({ settings, onDone }: { settings: SettingsRow | null; onDone: () => void }) {
	const [rate, setRate] = useState(String(settings?.flat_hourly_rate_vnd || ""));
	const [bankBin, setBankBin] = useState(settings?.bank_bin ?? "");
	const [bankAccountNumber, setBankAccountNumber] = useState(settings?.bank_account_number ?? "");
	const [bankAccountName, setBankAccountName] = useState(settings?.bank_account_name ?? "");
	const [ownerZalo, setOwnerZalo] = useState(settings?.owner_zalo ?? "");
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [pending, startTransition] = useTransition();

	useEffect(() => {
		setRate(String(settings?.flat_hourly_rate_vnd || ""));
		setBankBin(settings?.bank_bin ?? "");
		setBankAccountNumber(settings?.bank_account_number ?? "");
		setBankAccountName(settings?.bank_account_name ?? "");
		setOwnerZalo(settings?.owner_zalo ?? "");
	}, [settings]);

	function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setSaved(false);
		const parsed = settingsInputSchema.safeParse({
			flatHourlyRateVnd: Number(rate),
			bankBin,
			bankAccountNumber,
			bankAccountName,
			ownerZalo,
		});
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Invalid settings.");
			return;
		}
		startTransition(async () => {
			const result = await updateSettings(parsed.data);
			if (result.ok) {
				setSaved(true);
				onDone();
			} else {
				setError(result.error);
			}
		});
	}

	return (
		<form onSubmit={onSubmit} className="space-y-3">
			<label className="block space-y-1">
				<span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
					Flat hourly rate (VND)
				</span>
				<input
					type="number"
					min={1}
					step={1000}
					required
					value={rate}
					onChange={(e) => setRate(e.target.value)}
					className={inputClass}
				/>
			</label>

			<div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
				<div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
					Bank details (dynamic VietQR)
				</div>
				<p className="mt-0.5 text-xs text-zinc-500">
					Leave blank to use the uploaded static QR instead.
				</p>
				<div className="mt-2 grid gap-2 sm:grid-cols-3">
					<input
						type="text"
						placeholder="Bank BIN (e.g. 970415)"
						value={bankBin}
						onChange={(e) => setBankBin(e.target.value)}
						className={inputClass}
					/>
					<input
						type="text"
						placeholder="Account number"
						value={bankAccountNumber}
						onChange={(e) => setBankAccountNumber(e.target.value)}
						className={inputClass}
					/>
					<input
						type="text"
						placeholder="Account name"
						value={bankAccountName}
						onChange={(e) => setBankAccountName(e.target.value)}
						className={inputClass}
					/>
				</div>
			</div>

			<label className="block space-y-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
				<span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Owner Zalo</span>
				<input
					type="text"
					placeholder="0901234567 hoặc https://zalo.me/..."
					value={ownerZalo}
					onChange={(e) => setOwnerZalo(e.target.value)}
					className={inputClass}
				/>
				<span className="text-xs text-zinc-500">
					Khách bấm “Gửi ảnh qua Zalo” sẽ mở liên hệ này. Số điện thoại hoặc link zalo.me.
				</span>
			</label>

			{error && <p className="text-sm text-red-600">{error}</p>}
			{saved && <p className="text-sm text-emerald-600">Saved.</p>}
			<button
				type="submit"
				disabled={pending}
				className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
			>
				{pending ? "Saving…" : "Save settings"}
			</button>
		</form>
	);
}

function QrUpload({ qrImagePath, onDone }: { qrImagePath: string | null; onDone: () => void }) {
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [pending, startTransition] = useTransition();

	const qrUrl = useMemo(() => {
		if (!qrImagePath) {
			return null;
		}
		const supabase = createClient();
		// Cache-bust so a re-upload to the same path shows the new image.
		const base = supabase.storage.from("qr").getPublicUrl(qrImagePath).data.publicUrl;
		return `${base}?v=${Date.now()}`;
		// qrImagePath changes (or settings refetch) drives the refresh.
	}, [qrImagePath]);

	function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setError(null);
		setSaved(false);
		const formData = new FormData(e.currentTarget);
		startTransition(async () => {
			const result = await uploadQrImage(formData);
			if (result.ok) {
				setSaved(true);
				onDone();
			} else {
				setError(result.error);
			}
		});
	}

	return (
		<form onSubmit={onSubmit} className="space-y-3">
			<div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Payment QR image</div>
			{qrUrl && (
				<Image
					src={qrUrl}
					alt="Current payment QR"
					width={160}
					height={160}
					unoptimized
					className="h-40 w-40 rounded-lg border border-zinc-200 object-contain dark:border-zinc-800"
				/>
			)}
			<input
				type="file"
				name="file"
				accept="image/*"
				required
				className="block text-sm text-zinc-700 dark:text-zinc-300"
			/>
			{error && <p className="text-sm text-red-600">{error}</p>}
			{saved && <p className="text-sm text-emerald-600">QR updated.</p>}
			<button
				type="submit"
				disabled={pending}
				className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
			>
				{pending ? "Uploading…" : "Upload QR"}
			</button>
		</form>
	);
}
