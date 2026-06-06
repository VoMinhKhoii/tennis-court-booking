/**
 * Centralized environment access.
 *
 * Public values (NEXT_PUBLIC_*) are safe to expose to the browser.
 * `serverEnv()` reads the service-role key and MUST only be imported from
 * server-only code (server actions, route handlers, RSC). Never import it
 * into a client component.
 */

export const publicEnv = {
	supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
	supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
} as const;

function required(name: string, value: string | undefined): string {
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

export function publicSupabaseConfig() {
	return {
		url: required("NEXT_PUBLIC_SUPABASE_URL", publicEnv.supabaseUrl),
		anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY", publicEnv.supabaseAnonKey),
	};
}

/** Server-only. Throws if the service-role key is absent. */
export function serviceRoleKey() {
	return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}
