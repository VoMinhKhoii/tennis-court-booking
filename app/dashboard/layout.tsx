import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
	title: "Bảng điều khiển",
};

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
		<div className="flex flex-1 flex-col lg:flex-row">
			<DashboardSidebar />
			<main className="mx-auto w-full max-w-4xl flex-1 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
				{children}
			</main>
		</div>
	);
}
