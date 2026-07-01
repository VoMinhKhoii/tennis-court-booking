import { CalendarClock } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
	title: "Đăng nhập chủ sân",
	description: "Đăng nhập để quản lý đặt sân tennis.",
};

export default async function LoginPage() {
	// If already signed in as the owner, skip the form.
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (user) {
		const { data: isOwner } = await supabase.rpc("is_owner");
		if (isOwner === true) {
			redirect("/dashboard");
		}
	}

	return (
		<main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
			<div className="rounded-2xl border border-line bg-card p-7 shadow-court-lg sm:p-8">
				<span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
					<CalendarClock className="size-6" />
				</span>
				<h1 className="mt-5 font-display text-3xl font-normal tracking-tight text-ink">
					Đăng nhập chủ sân
				</h1>
				<p className="mt-1 text-sm text-ink-soft">Đăng nhập để quản lý đặt sân, sân và cài đặt.</p>
				<div className="mt-6">
					<LoginForm />
				</div>
			</div>
		</main>
	);
}
