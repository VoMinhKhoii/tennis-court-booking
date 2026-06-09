"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { CourtRow, SettingsRow } from "./types";

/**
 * Active courts for the public (no-auth) surfaces. Reads the anon-safe
 * public_courts view — anon has no SELECT on the court base table (§9), so the
 * availability page and booking form must read court metadata through the view.
 */
export function usePublicCourts() {
	return useQuery({
		queryKey: ["public_courts"],
		queryFn: async (): Promise<CourtRow[]> => {
			const supabase = createClient();
			const { data, error } = await supabase
				.from("public_courts")
				.select("id, name, open_time, close_time, is_active, created_at")
				.order("created_at", { ascending: true });
			if (error) {
				throw error;
			}
			return (data ?? []) as CourtRow[];
		},
	});
}

/**
 * Non-sensitive settings for the public booking form's price preview. Reads the
 * anon-safe public_settings view (flat rate + QR path only; owner_uid excluded).
 */
export function usePublicSettings() {
	return useQuery({
		queryKey: ["public_settings"],
		queryFn: async (): Promise<SettingsRow | null> => {
			const supabase = createClient();
			const { data, error } = await supabase
				.from("public_settings")
				.select("id, flat_hourly_rate_vnd, qr_image_path, owner_zalo")
				.eq("id", 1)
				.maybeSingle();
			if (error) {
				throw error;
			}
			return (data as SettingsRow) ?? null;
		},
	});
}
