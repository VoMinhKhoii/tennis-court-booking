"use client";

import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { updateSettings, uploadQrImage } from "@/lib/actions/owner";
import { settingsInputSchema } from "@/lib/booking/schemas";
import { useSettings } from "@/lib/queries/dashboard";
import type { SettingsRow } from "@/lib/queries/types";
import { createClient } from "@/lib/supabase/client";

const inputClass =
	"w-full rounded-md border border-line-strong bg-paper-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20";

export function SettingsPanel() {
	const queryClient = useQueryClient();
	const { data: settings, isLoading } = useSettings();

	if (isLoading) {
		return <p className="text-sm text-ink-faint">Đang tải…</p>;
	}

	return (
		<div className="grid max-w-3xl gap-6 lg:grid-cols-2">
			<SettingsCard title="Giá & thanh toán" caption="Giá và thông tin ngân hàng cho VietQR.">
				<RateForm
					settings={settings ?? null}
					onDone={() => queryClient.invalidateQueries({ queryKey: ["settings"] })}
				/>
			</SettingsCard>
			<SettingsCard
				title="Mã QR thanh toán"
				caption="Mã QR tĩnh hiển thị cho khách khi thanh toán."
			>
				<QrUpload
					qrImagePath={settings?.qr_image_path ?? null}
					onDone={() => queryClient.invalidateQueries({ queryKey: ["settings"] })}
				/>
			</SettingsCard>
		</div>
	);
}

function SettingsCard({
	title,
	caption,
	children,
}: {
	title: string;
	caption: string;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-xl border border-line bg-card shadow-court">
			<div className="border-b border-line px-5 py-4">
				<h3 className="font-display text-base font-medium text-ink">{title}</h3>
				<p className="mt-0.5 text-xs text-ink-soft">{caption}</p>
			</div>
			<div className="p-5">{children}</div>
		</section>
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
			setError(parsed.error.issues[0]?.message ?? "Cài đặt không hợp lệ.");
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
				<span className="text-sm font-medium text-ink-soft">Giá theo giờ (VND)</span>
				<input
					type="number"
					min={1000}
					step={1000}
					required
					value={rate}
					onChange={(e) => setRate(e.target.value)}
					className={inputClass}
				/>
			</label>

			<div className="border-t border-line pt-3">
				<div className="text-sm font-medium text-ink-soft">Thông tin ngân hàng (VietQR động)</div>
				<p className="mt-0.5 text-xs text-ink-faint">Để trống để dùng mã QR tĩnh đã tải lên.</p>
				<div className="mt-2 grid gap-2 sm:grid-cols-3">
					<input
						type="text"
						placeholder="Mã BIN ngân hàng (vd. 970415)"
						value={bankBin}
						onChange={(e) => setBankBin(e.target.value)}
						className={inputClass}
					/>
					<input
						type="text"
						placeholder="Số tài khoản"
						value={bankAccountNumber}
						onChange={(e) => setBankAccountNumber(e.target.value)}
						className={inputClass}
					/>
					<input
						type="text"
						placeholder="Tên tài khoản"
						value={bankAccountName}
						onChange={(e) => setBankAccountName(e.target.value)}
						className={inputClass}
					/>
				</div>
			</div>

			<label className="block space-y-1 border-t border-line pt-3">
				<span className="text-sm font-medium text-ink-soft">Zalo chủ sân</span>
				<input
					type="text"
					placeholder="0901234567 hoặc https://zalo.me/..."
					value={ownerZalo}
					onChange={(e) => setOwnerZalo(e.target.value)}
					className={inputClass}
				/>
				<span className="text-xs text-ink-faint">
					Khách bấm “Gửi ảnh qua Zalo” sẽ mở liên hệ này. Số điện thoại hoặc link zalo.me.
				</span>
			</label>

			{error && <p className="text-sm text-signal-red">{error}</p>}
			{saved && <p className="text-sm text-success">Đã lưu.</p>}
			<Button type="submit" disabled={pending}>
				{pending ? "Đang lưu…" : "Lưu cài đặt"}
			</Button>
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
			{qrUrl && (
				<Image
					src={qrUrl}
					alt="Mã QR thanh toán hiện tại"
					width={160}
					height={160}
					unoptimized
					className="h-40 w-40 rounded-lg border border-line object-contain"
				/>
			)}
			<input
				type="file"
				name="file"
				accept="image/*"
				required
				className="block text-sm text-ink-soft"
			/>
			{error && <p className="text-sm text-signal-red">{error}</p>}
			{saved && <p className="text-sm text-success">Đã cập nhật mã QR.</p>}
			<Button type="submit" disabled={pending}>
				{pending ? "Đang tải lên…" : "Tải lên mã QR"}
			</Button>
		</form>
	);
}
