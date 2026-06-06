import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicSupabaseConfig } from "@/lib/env";

/**
 * Server Supabase client for RSC and server actions.
 *
 * Uses the anon key + the owner's session cookies, so all access is
 * RLS-enforced as the logged-in user (never the service role).
 */
export async function createClient() {
	const cookieStore = await cookies();
	const { url, anonKey } = publicSupabaseConfig();

	return createServerClient(url, anonKey, {
		cookies: {
			getAll() {
				return cookieStore.getAll();
			},
			setAll(cookiesToSet) {
				try {
					for (const { name, value, options } of cookiesToSet) {
						cookieStore.set(name, value, options);
					}
				} catch {
					// Called from a Server Component, which cannot set cookies.
					// Safe to ignore: the proxy refreshes the session.
				}
			},
		},
	});
}
