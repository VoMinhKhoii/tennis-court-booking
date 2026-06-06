import type { Metadata } from "next";
import Link from "next/link";
import { BookingForm } from "@/components/booking/booking-form";

export const metadata: Metadata = {
	title: "Book a court",
	description: "Request a tennis court booking — one-off or monthly.",
};

export default function BookPage() {
	return (
		<main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
			<header className="mb-5">
				<Link href="/availability" className="text-sm text-emerald-700 dark:text-emerald-400">
					← Availability
				</Link>
				<h1 className="mt-2 text-2xl font-semibold tracking-tight">Book a court</h1>
				<p className="text-sm text-zinc-600 dark:text-zinc-400">
					One-off or monthly. The owner confirms each request manually.
				</p>
			</header>
			<BookingForm />
		</main>
	);
}
