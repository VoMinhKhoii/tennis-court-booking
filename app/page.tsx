import Link from "next/link";

export default function Home() {
	return (
		<main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
			<div className="space-y-2">
				<h1 className="text-3xl font-semibold tracking-tight">Tennis Court Booking</h1>
				<p className="max-w-md text-zinc-600 dark:text-zinc-400">
					View live court availability and reserve your slot.
				</p>
			</div>
			<div className="flex flex-col gap-3 sm:flex-row">
				<Link
					href="/availability"
					className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white"
				>
					View availability
				</Link>
				<Link
					href="/book"
					className="rounded-md border border-zinc-300 px-5 py-2.5 text-sm font-semibold dark:border-zinc-700"
				>
					Book a slot
				</Link>
			</div>
		</main>
	);
}
