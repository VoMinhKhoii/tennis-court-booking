import type { Metadata } from "next";
import Link from "next/link";
import { Stepper } from "@/components/booking/booking-form";
import {
	BookingDoneScreen,
	CheckoutRecovery,
	ReceiptSummary,
} from "@/components/booking/booking-receipt";
import { CheckoutPay } from "@/components/booking/checkout-pay";
import { CheckoutShell } from "@/components/booking/checkout-shell";
import { buttonVariants } from "@/components/ui/button";
import { getHold } from "@/lib/actions/create-booking";
import { formatVnd } from "@/lib/booking/format";

export const metadata: Metadata = {
	title: "Thanh toán đặt sân",
	robots: { index: false },
};

/**
 * Hosted-checkout page keyed by the hold reference. The reference in the URL is
 * the source of truth: every load re-reads the booking and renders the screen
 * that matches its lifecycle state — live payment, waiting-for-owner, or expired
 * recovery. This is what makes the flow reload-proof.
 */
export default async function BookReferencePage({
	params,
}: {
	params: Promise<{ reference: string }>;
}) {
	const { reference } = await params;
	const res = await getHold(reference);

	// No such booking.
	if (!res.ok) {
		return (
			<main className="mx-auto w-full max-w-lg flex-1 space-y-4 px-4 py-12 text-center sm:px-6">
				<h1 className="font-display text-2xl font-bold text-ink">Không tìm thấy đơn đặt sân</h1>
				<p className="text-sm text-ink-soft">
					Mã <strong className="font-mono">{reference}</strong> không tồn tại hoặc đã bị xoá.
				</p>
				<Link href="/book" className={`${buttonVariants({ size: "lg" })} mx-auto w-fit`}>
					Đặt sân mới
				</Link>
			</main>
		);
	}

	const receipt = res.data;

	// Live hold → interactive payment step.
	if (receipt.state === "held") {
		return <CheckoutPay receipt={receipt} />;
	}

	// Finalized → waiting for / confirmed by the owner.
	if (receipt.state === "pending" || receipt.state === "confirmed") {
		return (
			<CheckoutShell
				summary={<ReceiptSummary receipt={receipt} />}
				total={formatVnd(receipt.amountVnd)}
			>
				<div className="space-y-5">
					<Stepper stage="done" />
					<BookingDoneScreen receipt={receipt} confirmed={receipt.state === "confirmed"} />
				</div>
			</CheckoutShell>
		);
	}

	// Expired hold (window elapsed / terminal) → recovery.
	return (
		<CheckoutShell summary={<ReceiptSummary receipt={receipt} />} total={formatVnd(receipt.amountVnd)}>
			<div className="space-y-5">
				<Stepper stage="payment" />
				<CheckoutRecovery reference={receipt.reference} ownerZalo={receipt.ownerZalo} />
			</div>
		</CheckoutShell>
	);
}
