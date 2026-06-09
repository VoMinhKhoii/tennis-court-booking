"use client";

import { useRouter } from "next/navigation";
import type { HoldResume } from "@/lib/actions/create-booking";
import { formatVnd } from "@/lib/booking/format";
import { Stepper } from "./booking-form";
import { PaymentStep, ReceiptSummary } from "./booking-receipt";
import { CheckoutShell } from "./checkout-shell";
import { clearCheckout } from "./checkout-storage";

/**
 * Live-hold payment step on /book/[reference]. The server already verified the
 * hold is live; this island runs the countdown + finalize. On finalize OR expiry
 * it clears local state and refreshes the route, so the server re-reads the hold
 * and renders the right next screen (done / recovery). Reload-safe by design.
 */
export function CheckoutPay({ receipt }: { receipt: HoldResume }) {
	const router = useRouter();
	return (
		<CheckoutShell
			summary={<ReceiptSummary receipt={receipt} />}
			total={formatVnd(receipt.amountVnd)}
		>
			<div className="space-y-5">
				<Stepper stage="payment" />
				<PaymentStep
					receipt={receipt}
					onExpired={() => {
						clearCheckout();
						router.refresh();
					}}
					onDone={() => {
						clearCheckout();
						router.refresh();
					}}
				/>
			</div>
		</CheckoutShell>
	);
}
