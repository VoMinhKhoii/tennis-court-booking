import { ManualBookingForm } from "@/components/dashboard/manual-booking-form";

export default function ManualBookingPage() {
	return (
		<section>
			<h2 className="mb-1 text-lg font-semibold">Manual booking</h2>
			<p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
				Create a confirmed booking for a regular. Slots lock immediately.
			</p>
			<ManualBookingForm />
		</section>
	);
}
