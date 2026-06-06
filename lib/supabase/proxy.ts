import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { publicSupabaseConfig } from "@/lib/env";

/**
 * Refreshes the Supabase auth session on every matched request and keeps the
 * session cookies in sync between the browser and the server. Returned response
 * must be passed through unchanged (per @supabase/ssr guidance).
 */
export async function updateSession(request: NextRequest) {
	let supabaseResponse = NextResponse.next({ request });

	const { url, anonKey } = publicSupabaseConfig();
	const supabase = createServerClient(url, anonKey, {
		cookies: {
			getAll() {
				return request.cookies.getAll();
			},
			setAll(cookiesToSet) {
				for (const { name, value } of cookiesToSet) {
					request.cookies.set(name, value);
				}
				supabaseResponse = NextResponse.next({ request });
				for (const { name, value, options } of cookiesToSet) {
					supabaseResponse.cookies.set(name, value, options);
				}
			},
		},
	});

	// IMPORTANT: refresh the session. Do not run code between client creation
	// and getUser(), and do not remove this call.
	await supabase.auth.getUser();

	return supabaseResponse;
}
