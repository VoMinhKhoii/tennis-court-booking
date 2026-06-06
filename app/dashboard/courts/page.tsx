import { CourtManager } from "@/components/dashboard/court-manager";

export default function CourtsPage() {
	return (
		<section>
			<h2 className="mb-1 text-lg font-semibold">Courts</h2>
			<p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
				Add or edit courts. Hours are 30-min aligned; toggle active to hide a court from booking.
			</p>
			<CourtManager />
		</section>
	);
}
