"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import type { BookingReceipt } from "@/lib/actions/create-booking";
import { createClient } from "@/lib/supabase/client";

/**
 * Post-submit screen (spec §6.2): reference (prominent), amount, QR, and the
 * pay instruction. No account creation, no lookup-by-reference. The QR comes
 * strictly from settings.qr_image_path (resolved server-side into the receipt),
 * served from the public `qr` Storage bucket.
 */
export function BookingReceiptScreen({ receipt }: { receipt: BookingReceipt }) {
	const qrUrl = useMemo(() => {
		if (!receipt.qrImagePath) {
			return null;
		}
		const supabase = createClient();
		return supabase.storage.from("qr").getPublicUrl(receipt.qrImagePath).data.publicUrl;
	}, [receipt.qrImagePath]);

	return (
		<div className="space-y-6 text-center">
			<div>
				<p className="text-sm text-zinc-600 dark:text-zinc-400">Booking requested</p>
				<p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">{receipt.reference}</p>
				<p className="mt-1 text-sm text-zinc-500">your booking reference</p>
			</div>

			<div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
				<p className="text-sm text-zinc-600 dark:text-zinc-400">Amount to transfer</p>
				<p className="text-2xl font-semibold tabular-nums">
					{receipt.amountVnd.toLocaleString("en-US")} ₫
				</p>
				{receipt.occurrences > 1 && (
					<p className="mt-1 text-xs text-zinc-500">{receipt.occurrences} sessions</p>
				)}
			</div>

			{qrUrl && (
				<div className="flex justify-center">
					<Image
						src={qrUrl}
						alt="Payment QR code"
						width={224}
						height={224}
						unoptimized
						className="h-56 w-56 rounded-lg border border-zinc-200 object-contain dark:border-zinc-800"
					/>
				</div>
			)}

			<div className="rounded-lg border border-zinc-200 p-4 text-left text-sm dark:border-zinc-800">
				<p>
					Transfer the <strong>exact amount</strong> with the reference{" "}
					<strong className="tabular-nums">{receipt.reference}</strong> in the bank memo, then send
					proof to the owner on Zalo.
				</p>
				<p className="mt-2 text-zinc-600 dark:text-zinc-400">The owner will confirm manually.</p>
			</div>

			<Link
				href="/availability"
				className="inline-block rounded-md border border-zinc-300 px-5 py-2.5 text-sm font-medium dark:border-zinc-700"
			>
				Back to availability
			</Link>
		</div>
	);
}
