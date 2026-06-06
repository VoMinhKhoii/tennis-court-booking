import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseConfig } from "@/lib/env";

/** Browser Supabase client for client components. Runs as anon. */
export function createClient() {
	const { url, anonKey } = publicSupabaseConfig();
	return createBrowserClient(url, anonKey);
}
