import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
	title: "Owner login",
	description: "Sign in to manage tennis court bookings.",
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
			<h1 className="text-2xl font-semibold tracking-tight">Owner login</h1>
			<p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
				Sign in to manage bookings, courts, and settings.
			</p>
			<div className="mt-6">
				<LoginForm />
			</div>
		</main>
	);
}
