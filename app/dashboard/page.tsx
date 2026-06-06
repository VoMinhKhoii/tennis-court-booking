import { PendingQueue } from "@/components/dashboard/pending-queue";

export default function DashboardPage() {
	return (
		<section>
			<h2 className="mb-1 text-lg font-semibold">Pending bookings</h2>
			<p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
				Oldest first. Confirm to lock the slots, or reject to free them.
			</p>
			<PendingQueue />
		</section>
	);
}
