"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail, ok } from "./types";

const loginSchema = z.object({
	email: z.email("Nhập email hợp lệ"),
	password: z.string().min(1, "Vui lòng nhập mật khẩu"),
});

/**
 * Owner login (spec §7). Public signups are disabled; only the seeded owner can
 * sign in. Authenticates against Supabase Auth, then verifies the caller is the
 * owner via is_owner() — a valid Supabase user that is not the owner is rejected
 * and signed back out so a non-owner account can never reach the dashboard.
 */
export async function login(input: {
	email: string;
	password: string;
}): Promise<ActionResult<{ ok: true }>> {
	const parsed = loginSchema.safeParse(input);
	if (!parsed.success) {
		return fail(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
	}

	const supabase = await createClient();
	const { error } = await supabase.auth.signInWithPassword({
		email: parsed.data.email,
		password: parsed.data.password,
	});
	if (error) {
		return fail("Email hoặc mật khẩu không đúng.");
	}

	const { data: isOwner } = await supabase.rpc("is_owner");
	if (isOwner !== true) {
		await supabase.auth.signOut();
		return fail("Tài khoản này không được phép truy cập.");
	}

	return ok({ ok: true });
}

/** Owner logout (spec §7). Clears the session, then returns to login. */
export async function logout(): Promise<void> {
	const supabase = await createClient();
	await supabase.auth.signOut();
	redirect("/login");
}
