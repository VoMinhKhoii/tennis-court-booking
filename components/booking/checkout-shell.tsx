import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/**
 * Stripe-like hosted-checkout shell. A focused, full-page layout (NOT a modal):
 * on desktop a sticky order summary sits beside the active step; on mobile the
 * summary collapses into a total bar above the step. Used by both `/book`
 * (info → review, summary = live form preview) and `/book/[reference]`
 * (payment / done / recovery, summary = the locked order).
 */
export function CheckoutShell({
	summary,
	total,
	children,
	backHref = "/availability",
}: {
	/** Order-summary body (court, time, sessions, total). */
	summary: ReactNode;
	/** Compact total shown in the collapsed mobile summary bar. */
	total?: ReactNode;
	/** The active step. */
	children: ReactNode;
	backHref?: string;
}) {
	return (
		<main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
			<header className="mb-5">
				<Link
					href={backHref}
					className="text-sm font-medium text-court-700 transition-colors hover:text-court-900"
				>
					← Lịch trống
				</Link>
				<h1 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
					Đặt sân
				</h1>
			</header>

			<div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
				{/* Order summary: collapsible bar on mobile, sticky sidebar on desktop. */}
				<aside>
					<details className="group rounded-xl border border-court-200 bg-court-25 lg:hidden">
						<summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-court-900 [&::-webkit-details-marker]:hidden">
							<span>Chi tiết đơn</span>
							<span className="flex items-center gap-2">
								{total != null && (
									<span className="font-mono font-bold tabular-nums text-court-900">{total}</span>
								)}
								<ChevronDown className="size-4 text-court-700 transition-transform group-open:rotate-180" />
							</span>
						</summary>
						<div className="border-t border-court-200 px-4 py-4">{summary}</div>
					</details>

					<div className="hidden rounded-2xl border border-court-200 bg-court-25 p-5 lg:sticky lg:top-6 lg:block">
						{summary}
					</div>
				</aside>

				{/* Active step. */}
				<section>
					<Card className="p-5 sm:p-6">{children}</Card>
				</section>
			</div>
		</main>
	);
}

/**
 * Shared order-summary body for the checkout sidebar. Dumb on purpose — consumers
 * pass already-formatted rows + total so the form (live preview) and the
 * reference pages (locked order) render an identical-looking summary.
 */
export function OrderSummary({
	rows,
	amount,
	note,
}: {
	rows: { label: string; value: ReactNode }[];
	amount: ReactNode;
	note?: ReactNode;
}) {
	return (
		<div className="space-y-4">
			<h2 className="font-display text-sm font-bold uppercase tracking-wide text-court-800">
				Đơn đặt sân
			</h2>
			<dl className="space-y-2 text-sm">
				{rows.map((r) => (
					<div key={r.label} className="flex items-start justify-between gap-3">
						<dt className="shrink-0 text-ink-faint">{r.label}</dt>
						<dd className="text-right text-ink">{r.value}</dd>
					</div>
				))}
			</dl>
			<div className="flex items-center justify-between border-t border-court-200 pt-3">
				<span className="text-sm font-medium text-ink-soft">Tổng tiền</span>
				<span className="font-mono text-2xl font-bold tabular-nums text-court-900">{amount}</span>
			</div>
			{note}
		</div>
	);
}
