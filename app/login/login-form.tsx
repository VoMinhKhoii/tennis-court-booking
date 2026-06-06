"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { login } from "@/lib/actions/auth";

const inputClass =
	"w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

export function LoginForm() {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		startTransition(async () => {
			const result = await login({ email, password });
			if (result.ok) {
				router.replace("/dashboard");
				router.refresh();
			} else {
				setError(result.error);
			}
		});
	}

	return (
		<form onSubmit={onSubmit} className="space-y-4">
			<label className="block space-y-1">
				<span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</span>
				<input
					type="email"
					required
					autoComplete="username"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					className={inputClass}
				/>
			</label>

			<label className="block space-y-1">
				<span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Password</span>
				<input
					type="password"
					required
					autoComplete="current-password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					className={inputClass}
				/>
			</label>

			{error && (
				<p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
					{error}
				</p>
			)}

			<button
				type="submit"
				disabled={pending}
				className="w-full rounded-md bg-emerald-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
			>
				{pending ? "Signing in…" : "Sign in"}
			</button>
		</form>
	);
}
