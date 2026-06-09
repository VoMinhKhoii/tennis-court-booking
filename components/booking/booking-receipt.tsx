"use client";

import { Check, Copy, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { type BookingReceipt, finalizeBooking } from "@/lib/actions/create-booking";
import { formatVnd } from "@/lib/booking/format";
import { safeZaloHref } from "@/lib/booking/zalo";
import { createClient } from "@/lib/supabase/client";

/** Resolve the displayable QR src: dynamic VietQR first, else the static upload. */
function useQrSrc(receipt: BookingReceipt): string | null {
	const staticQrUrl = useMemo(() => {
		if (receipt.qrUrl || !receipt.qrImagePath) return null;
		const supabase = createClient();
		return supabase.storage.from("qr").getPublicUrl(receipt.qrImagePath).data.publicUrl;
	}, [receipt.qrUrl, receipt.qrImagePath]);
	return receipt.qrUrl ?? staticQrUrl;
}

/** Amount + assigned court hero card (shared across payment / done screens). */
function AmountHero({ receipt }: { receipt: BookingReceipt }) {
	return (
		<div className="rounded-2xl border border-court-200 bg-court-25 p-5 text-center">
			<p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Số tiền</p>
			<p className="mt-1 font-mono text-4xl font-bold tabular-nums text-court-900">
				{formatVnd(receipt.amountVnd)}
			</p>
			<p className="mt-2 text-sm text-ink-soft">
				Sân đã xếp: <strong className="text-ink">{receipt.courtName}</strong>
				{receipt.occurrences > 1 ? ` · ${receipt.occurrences} buổi` : ""}
			</p>
		</div>
	);
}

/**
 * Step 3 — Thanh toán (spec §"Customer wizard" step 3). Reuses the receipt's
 * amount/court/QR/detail JSX, adds a countdown to the soft-hold expiry, a
 * "Đã chuyển khoản" reveal that surfaces the owner Zalo deep-link, and a final
 * "Rồi, hoàn tất" that promotes held -> pending via finalizeBooking.
 */
export function PaymentStep({
	receipt,
	onExpired,
	onDone,
}: {
	receipt: BookingReceipt;
	onExpired: () => void;
	onDone: () => void;
}) {
	const qrSrc = useQrSrc(receipt);
	const zalo = safeZaloHref(receipt.ownerZalo);
	const [revealed, setRevealed] = useState(false);
	const [holdExpired, setHoldExpired] = useState(false);
	const [pending, start] = useTransition();
	const [left, setLeft] = useState(() =>
		Math.max(0, new Date(receipt.holdExpiresAt).getTime() - Date.now()),
	);

	useEffect(() => {
		const tick = setInterval(() => {
			const ms = Math.max(0, new Date(receipt.holdExpiresAt).getTime() - Date.now());
			setLeft(ms);
			if (ms <= 0) {
				clearInterval(tick);
				onExpired();
			}
		}, 1000);
		return () => clearInterval(tick);
	}, [receipt.holdExpiresAt, onExpired]);

	const mm = String(Math.floor(left / 60000)).padStart(2, "0");
	const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
	const urgent = left < 60000;

	function finalize() {
		setHoldExpired(false);
		start(async () => {
			const r = await finalizeBooking(receipt.reference);
			if (r.ok) {
				onDone();
			} else {
				setHoldExpired(true);
			}
		});
	}

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="font-display text-xl font-bold text-ink">Thanh toán</h2>
					<p className="text-sm text-ink-soft">Quét mã để chuyển khoản giữ sân.</p>
				</div>
				<StatusPill tone="pending">Chờ xác nhận</StatusPill>
			</div>

			{/* Countdown — calm digits, red only under 1:00 */}
			<div
				className={`rounded-xl border px-4 py-3 text-center ${
					urgent ? "border-signal-red-soft bg-signal-red-soft" : "border-court-200 bg-court-25"
				}`}
			>
				<p className="text-sm text-ink-soft">
					Giữ chỗ trong{" "}
					<span
						className={`font-mono text-lg font-bold tabular-nums ${
							urgent ? "text-signal-red" : "text-court-900"
						}`}
					>
						{mm}:{ss}
					</span>
				</p>
				<p className="mt-0.5 text-xs text-ink-faint">
					Hết giờ chỉ cần đặt lại, bạn không mất tiền.
				</p>
			</div>

			<AmountHero receipt={receipt} />

			{/* QR */}
			{qrSrc && (
				<div className="flex flex-col items-center rounded-2xl border border-line bg-paper-raised p-5 shadow-court">
					{/** biome-ignore lint/performance/noImgElement: external VietQR image, no next/image domain config */}
					<img
						src={qrSrc}
						alt="Mã QR VietQR thanh toán"
						width={240}
						height={300}
						className="w-60 rounded-xl border border-line object-contain"
					/>
					<p className="mt-3 text-center text-xs text-ink-faint">
						Quét bằng app ngân hàng — số tiền và nội dung đã được điền sẵn.
					</p>
				</div>
			)}

			{/* Pay-by-hand details */}
			<div className="space-y-2 rounded-xl border border-line bg-paper p-4">
				<DetailRow label="Nội dung CK" value={receipt.reference} mono copyable />
				<DetailRow
					label="Số tiền"
					value={String(receipt.amountVnd)}
					display={formatVnd(receipt.amountVnd)}
					mono
					copyable
				/>
				{receipt.bankAccountName && (
					<DetailRow label="Chủ tài khoản" value={receipt.bankAccountName} />
				)}
				{receipt.bankAccountNumber && (
					<DetailRow label="Số tài khoản" value={receipt.bankAccountNumber} mono copyable />
				)}
			</div>

			<div className="rounded-xl border border-court-200 bg-court-25 p-4 text-sm text-ink-soft">
				<p>
					Chuyển khoản <strong className="text-ink">đúng số tiền</strong>, giữ nguyên nội dung{" "}
					<strong className="font-mono text-court-900">{receipt.reference}</strong>, rồi gửi ảnh
					chụp cho chủ sân qua <strong className="text-ink">Zalo</strong> để được xác nhận.
				</p>
			</div>

			{holdExpired ? (
				<div className="space-y-3 rounded-xl border border-signal-amber-soft bg-signal-amber-soft p-4 text-sm text-signal-amber">
					<p>
						Khung giờ đã hết giữ chỗ. Nếu bạn đã chuyển khoản, gửi ảnh + mã{" "}
						<strong className="font-mono">{receipt.reference}</strong> qua Zalo — chủ sân sẽ xử lý.
					</p>
					{zalo && (
						<a
							href={zalo}
							target="_blank"
							rel="noopener noreferrer"
							className={`${buttonVariants({ size: "lg" })} w-full`}
						>
							<MessageCircle className="size-4" /> Gửi ảnh qua Zalo
						</a>
					)}
				</div>
			) : !revealed ? (
				<Button type="button" size="lg" className="w-full" onClick={() => setRevealed(true)}>
					Đã chuyển khoản
				</Button>
			) : (
				<div className="space-y-2">
					{zalo ? (
						<a
							href={zalo}
							target="_blank"
							rel="noopener noreferrer"
							className={`${buttonVariants({ variant: "outline", size: "lg" })} w-full`}
						>
							<MessageCircle className="size-4" /> Gửi ảnh qua Zalo
						</a>
					) : (
						<p className="rounded-lg border border-line bg-paper p-3 text-center text-sm text-ink-soft">
							Gửi ảnh chuyển khoản kèm mã{" "}
							<strong className="font-mono text-court-900">{receipt.reference}</strong> cho chủ sân
							qua Zalo.
						</p>
					)}
					<Button type="button" size="lg" className="w-full" disabled={pending} onClick={finalize}>
						{pending ? "Đang xử lý…" : "Rồi, hoàn tất"}
					</Button>
				</div>
			)}
		</div>
	);
}

/**
 * Step 4 — Hoàn tất (spec §"Customer wizard" step 4). The hold is now a durable
 * pending booking awaiting owner confirmation.
 */
export function BookingDoneScreen({ receipt }: { receipt: BookingReceipt }) {
	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="font-display text-xl font-bold text-ink">Đang chờ chủ sân xác nhận</h2>
					<p className="text-sm text-ink-soft">
						Chủ sân sẽ kiểm tra chuyển khoản và xác nhận giữ sân cho bạn.
					</p>
				</div>
				<StatusPill tone="pending">Chờ xác nhận</StatusPill>
			</div>

			<AmountHero receipt={receipt} />

			<div className="space-y-2 rounded-xl border border-line bg-paper p-4">
				<DetailRow label="Nội dung CK" value={receipt.reference} mono copyable />
				<DetailRow
					label="Số tiền"
					value={String(receipt.amountVnd)}
					display={formatVnd(receipt.amountVnd)}
					mono
				/>
			</div>

			<Link
				href="/availability"
				className={`${buttonVariants({ variant: "outline", size: "lg" })} w-full`}
			>
				Về lịch trống
			</Link>
		</div>
	);
}

/**
 * Stripe-like payment page (spec §6.2), settled manually. A focused checkout:
 * the assigned court + amount, a scannable VietQR (amount + reference baked in),
 * and one-tap copy of the reference/amount for anyone who pays by hand. The
 * booking stays pending until the owner confirms the transfer.
 */
export function BookingReceiptScreen({ receipt }: { receipt: BookingReceipt }) {
	const qrSrc = useQrSrc(receipt);

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="font-display text-xl font-bold text-ink">Thanh toán</h2>
					<p className="text-sm text-ink-soft">Quét mã để chuyển khoản giữ sân.</p>
				</div>
				<StatusPill tone="pending">Chờ xác nhận</StatusPill>
			</div>

			<AmountHero receipt={receipt} />

			{/* QR */}
			{qrSrc && (
				<div className="flex flex-col items-center rounded-2xl border border-line bg-paper-raised p-5 shadow-court">
					{/** biome-ignore lint/performance/noImgElement: external VietQR image, no next/image domain config */}
					<img
						src={qrSrc}
						alt="Mã QR VietQR thanh toán"
						width={240}
						height={300}
						className="w-60 rounded-xl border border-line object-contain"
					/>
					<p className="mt-3 text-center text-xs text-ink-faint">
						Quét bằng app ngân hàng — số tiền và nội dung đã được điền sẵn.
					</p>
				</div>
			)}

			{/* Pay-by-hand details */}
			<div className="space-y-2 rounded-xl border border-line bg-paper p-4">
				<DetailRow label="Nội dung CK" value={receipt.reference} mono copyable />
				<DetailRow
					label="Số tiền"
					value={String(receipt.amountVnd)}
					display={formatVnd(receipt.amountVnd)}
					mono
					copyable
				/>
				{receipt.bankAccountName && (
					<DetailRow label="Chủ tài khoản" value={receipt.bankAccountName} />
				)}
				{receipt.bankAccountNumber && (
					<DetailRow label="Số tài khoản" value={receipt.bankAccountNumber} mono copyable />
				)}
			</div>

			<div className="rounded-xl border border-court-200 bg-court-25 p-4 text-sm text-ink-soft">
				<p>
					Chuyển khoản <strong className="text-ink">đúng số tiền</strong>, giữ nguyên nội dung{" "}
					<strong className="font-mono text-court-900">{receipt.reference}</strong>, rồi gửi ảnh
					chụp cho chủ sân qua <strong className="text-ink">Zalo</strong> để được xác nhận.
				</p>
			</div>

			<div className="flex flex-col gap-2 sm:flex-row">
				<span
					className={`${buttonVariants({ size: "lg" })} pointer-events-none w-full opacity-90 sm:flex-1`}
				>
					<MessageCircle className="size-4" /> Gửi ảnh qua Zalo
				</span>
				<Link
					href="/availability"
					className={`${buttonVariants({ variant: "outline", size: "lg" })} w-full sm:flex-1`}
				>
					Về lịch trống
				</Link>
			</div>
		</div>
	);
}

/** A label/value row, optionally mono + tap-to-copy. */
function DetailRow({
	label,
	value,
	display,
	mono = false,
	copyable = false,
}: {
	label: string;
	value: string;
	display?: string;
	mono?: boolean;
	copyable?: boolean;
}) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard may be unavailable (insecure context); silently ignore.
		}
	}

	const text = display ?? value;
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-sm text-ink-faint">{label}</span>
			{copyable ? (
				<button
					type="button"
					onClick={copy}
					aria-label={`Sao chép ${label}`}
					className="inline-flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-court-50"
				>
					<span
						className={`text-sm font-semibold text-ink ${mono ? "font-mono tabular-nums" : ""}`}
					>
						{text}
					</span>
					{copied ? (
						<Check className="size-3.5 text-court-700" />
					) : (
						<Copy className="size-3.5 text-ink-faint" />
					)}
				</button>
			) : (
				<span className={`text-sm font-semibold text-ink ${mono ? "font-mono tabular-nums" : ""}`}>
					{text}
				</span>
			)}
		</div>
	);
}
