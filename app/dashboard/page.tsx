import { HoldsPanel } from "@/components/dashboard/holds-panel";
import { PendingQueue } from "@/components/dashboard/pending-queue";

export default function DashboardPage() {
	return (
		<div className="space-y-8">
			<section>
				<h2 className="mb-1 text-lg font-semibold">Pending bookings</h2>
				<p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
					Oldest first. Confirm to lock the slots, or reject to free them.
				</p>
				<PendingQueue />
			</section>

			<section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
				<h2 className="mb-1 text-lg font-semibold">Soft-holds</h2>
				<p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
					Read-only. Live holds block slots temporarily; expired holds may need reconciliation.
				</p>
				<HoldsPanel />
			</section>
		</div>
	);
}
