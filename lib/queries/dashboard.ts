"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "./keys";
import type { BookingRow, CourtRow, SettingsRow } from "./types";

/** All courts (owner read; also used by the public form for court options). */
export function useCourts() {
	return useQuery({
		queryKey: queryKeys.courts(),
		queryFn: async (): Promise<CourtRow[]> => {
			const supabase = createClient();
			const { data, error } = await supabase
				.from("court")
				.select("id, name, open_time, close_time, is_active, created_at")
				.order("created_at", { ascending: true });
			if (error) {
				throw error;
			}
			return (data ?? []) as CourtRow[];
		},
	});
}

/** Settings row (owner read). */
export function useSettings() {
	return useQuery({
		queryKey: queryKeys.settings(),
		queryFn: async (): Promise<SettingsRow | null> => {
			const supabase = createClient();
			const { data, error } = await supabase
				.from("settings")
				.select(
					"id, flat_hourly_rate_vnd, price_bands, qr_image_path, bank_bin, bank_account_number, bank_account_name, owner_zalo",
				)
				.eq("id", 1)
				.maybeSingle();
			if (error) {
				throw error;
			}
			return (data as SettingsRow) ?? null;
		},
	});
}

/** Pending queue, oldest first so age is obvious (spec §7). */
export function usePendingBookings() {
	return useQuery({
		queryKey: queryKeys.pendingBookings(),
		queryFn: async (): Promise<BookingRow[]> => {
			const supabase = createClient();
			const { data, error } = await supabase
				.from("booking")
				.select("*")
				.eq("status", "pending")
				.order("created_at", { ascending: true });
			if (error) {
				throw error;
			}
			return (data ?? []) as BookingRow[];
		},
	});
}

/**
 * Live soft-holds (status='held', not yet expired) — read-only owner visibility
 * so a blocked slot is explained. Holds stay OUT of the actionable pending queue.
 */
export function useHeldBookings() {
	return useQuery({
		queryKey: queryKeys.heldBookings(),
		refetchInterval: 30_000,
		queryFn: async (): Promise<BookingRow[]> => {
			const supabase = createClient();
			const { data, error } = await supabase
				.from("booking")
				.select("*")
				.eq("status", "held")
				.gt("hold_expires_at", new Date().toISOString())
				.order("hold_expires_at", { ascending: true });
			if (error) {
				throw error;
			}
			return (data ?? []) as BookingRow[];
		},
	});
}

/**
 * Recently expired holds (spec §"Reconciliation surface") — a customer may have
 * paid during a hold that then expired; surface these so the owner can refund or
 * re-book. Read-only.
 */
export function useExpiredHolds(days = 3) {
	return useQuery({
		queryKey: queryKeys.expiredHolds(),
		queryFn: async (): Promise<BookingRow[]> => {
			const supabase = createClient();
			const since = new Date(Date.now() - days * 86_400_000).toISOString();
			const { data, error } = await supabase
				.from("booking")
				.select("*")
				.eq("status", "expired")
				.gte("created_at", since)
				.order("created_at", { ascending: false });
			if (error) {
				throw error;
			}
			return (data ?? []) as BookingRow[];
		},
	});
}

/** Confirmed bookings, filterable by court / month / customer name (spec §7). */
export function useConfirmedBookings(filters: {
	courtId?: string;
	month?: string; // YYYY-MM-DD within the target month
	name?: string;
}) {
	return useQuery({
		queryKey: queryKeys.confirmedBookings(filters),
		queryFn: async (): Promise<BookingRow[]> => {
			const supabase = createClient();
			let query = supabase
				.from("booking")
				.select("*")
				.eq("status", "confirmed")
				.order("confirmed_at", { ascending: false });

			if (filters.courtId) {
				query = query.eq("court_id", filters.courtId);
			}
			if (filters.name) {
				query = query.ilike("customer_name", `%${filters.name}%`);
			}

			const { data, error } = await query;
			if (error) {
				throw error;
			}
			let rows = (data ?? []) as BookingRow[];

			// Month filter is applied client-side against occurrences would require a
			// join; for the booking-level confirmed view we filter on created month of
			// the booking when provided. (Occurrence-level calendar lives in the grid.)
			if (filters.month) {
				const ym = filters.month.slice(0, 7);
				rows = rows.filter((b) => (b.confirmed_at ?? b.created_at).slice(0, 7) === ym);
			}
			return rows;
		},
	});
}
