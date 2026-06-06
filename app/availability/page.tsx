import type { Metadata } from "next";
import Link from "next/link";
import { AvailabilityView } from "@/components/availability/availability-view";

export const metadata: Metadata = {
	title: "Availability",
	description: "Live tennis court availability — current and next month.",
};

export default function AvailabilityPage() {
	return (
		<main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
			<header className="mb-5">
				<Link href="/" className="text-sm text-emerald-700 dark:text-emerald-400">
					← Home
				</Link>
				<h1 className="mt-2 text-2xl font-semibold tracking-tight">Court availability</h1>
				<p className="text-sm text-zinc-600 dark:text-zinc-400">
					Live, updated in real time. Pick a court and month.
				</p>
			</header>
			<AvailabilityView />
		</main>
	);
}
