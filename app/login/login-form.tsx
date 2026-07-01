"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { login } from "@/lib/actions/auth";

const inputClass =
	"w-full rounded-md border border-line-strong bg-paper-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20";

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
			try {
				const result = await login({ email, password });
				if (result.ok) {
					router.replace("/dashboard");
					router.refresh();
				} else {
					setError(result.error);
				}
			} catch {
				setError("Không thể đăng nhập lúc này. Vui lòng thử lại.");
			}
		});
	}

	return (
		<form onSubmit={onSubmit} className="space-y-4">
			<label className="block space-y-1">
				<span className="text-sm font-medium text-ink-soft">Email</span>
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
				<span className="text-sm font-medium text-ink-soft">Mật khẩu</span>
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
				<p className="rounded-md bg-signal-red-soft px-3 py-2 text-sm text-signal-red">{error}</p>
			)}

			<Button type="submit" size="lg" disabled={pending} className="h-11 w-full">
				{pending ? "Đang đăng nhập…" : "Đăng nhập"}
			</Button>
		</form>
	);
}
