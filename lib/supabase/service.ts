import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseConfig, serviceRoleKey } from "@/lib/env";

/**
 * Service-role Supabase client. Server-only, NEVER exposed to the browser.
 *
 * The single legitimate use in v1 is the PUBLIC booking write path: anon has no
 * EXECUTE on create_pending_booking (spec §9), so the public server action must
 * call it from an elevated server context. This client is NOT used for owner
 * actions — those run under the owner's RLS session (lib/supabase/server.ts).
 *
 * No session persistence / token refresh: it carries no user, just the key.
 */
export function createServiceClient() {
	const { url } = publicSupabaseConfig();
	return createSupabaseClient(url, serviceRoleKey(), {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	});
}
