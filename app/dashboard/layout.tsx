import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
	title: "Dashboard",
};

const NAV = [
	{ href: "/dashboard", label: "Pending" },
	{ href: "/dashboard/confirmed", label: "Confirmed" },
	{ href: "/dashboard/manual", label: "Manual booking" },
	{ href: "/dashboard/courts", label: "Courts" },
	{ href: "/dashboard/settings", label: "Settings" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
	// Defense-in-depth gate (spec §7): verify identity AND owner status here, not
	// just in the proxy. getUser() is the verified check; is_owner() confirms the
	// caller is the seeded owner. Every owner action re-checks independently.
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) {
		redirect("/login");
	}
	const { data: isOwner } = await supabase.rpc("is_owner");
	if (isOwner !== true) {
		redirect("/login");
	}

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
			<header className="mb-6 flex items-center justify-between">
				<h1 className="text-xl font-semibold tracking-tight">Owner dashboard</h1>
				<form action={logout}>
					<button
						type="submit"
						className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
					>
						Sign out
					</button>
				</form>
			</header>

			<nav className="mb-6 flex flex-wrap gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-800">
				{NAV.map((item) => (
					<Link
						key={item.href}
						href={item.href}
						className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
					>
						{item.label}
					</Link>
				))}
			</nav>

			{children}
		</div>
	);
}
