"use client";

import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useEffect, useMemo, useState, useTransition } from "react";
import { updateSettings, uploadQrImage } from "@/lib/actions/owner";
import { settingsInputSchema } from "@/lib/booking/schemas";
import { useSettings } from "@/lib/queries/dashboard";
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
				initialRate={settings?.flat_hourly_rate_vnd ?? 0}
				onDone={() => queryClient.invalidateQueries({ queryKey: ["settings"] })}
			/>
			<QrUpload
				qrImagePath={settings?.qr_image_path ?? null}
				onDone={() => queryClient.invalidateQueries({ queryKey: ["settings"] })}
			/>
		</div>
	);
}

function RateForm({ initialRate, onDone }: { initialRate: number; onDone: () => void }) {
	const [rate, setRate] = useState(String(initialRate || ""));
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [pending, startTransition] = useTransition();

	useEffect(() => {
		setRate(String(initialRate || ""));
	}, [initialRate]);

	function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setSaved(false);
		const parsed = settingsInputSchema.safeParse({ flatHourlyRateVnd: Number(rate) });
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Invalid rate.");
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
			{error && <p className="text-sm text-red-600">{error}</p>}
			{saved && <p className="text-sm text-emerald-600">Saved.</p>}
			<button
				type="submit"
				disabled={pending}
				className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
			>
				{pending ? "Saving…" : "Save rate"}
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
