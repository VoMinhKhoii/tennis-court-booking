import { ConfirmedView } from "@/components/dashboard/confirmed-view";

export default function ConfirmedPage() {
	return (
		<section>
			<h2 className="mb-1 text-lg font-semibold">Confirmed bookings</h2>
			<p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
				Filter by court, month, or customer name.
			</p>
			<ConfirmedView />
		</section>
	);
}
