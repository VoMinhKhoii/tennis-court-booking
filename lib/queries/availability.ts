"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "./keys";
import type { AvailabilityRow } from "./types";

/**
 * Live availability for one court over a calendar month (spec §6.1).
 *
 * Reads the public_availability view (anon's only read). `monthStart` is the
 * first-of-month YYYY-MM-DD; the query fetches every occupied slot whose
 * slot_date falls in that month. The grid (Phase 3) subtracts these from the
 * court's operating window to render free/occupied blocks.
 */
export function useAvailability(courtId: string, monthStart: string) {
	return useQuery({
		queryKey: queryKeys.availability(courtId, monthStart),
		queryFn: async (): Promise<AvailabilityRow[]> => {
			const supabase = createClient();
			const monthEnd = lastOfMonth(monthStart);
			const { data, error } = await supabase
				.from("public_availability")
				.select("court_id, slot_date, time_range, occupied")
				.eq("court_id", courtId)
				.gte("slot_date", monthStart)
				.lte("slot_date", monthEnd)
				.order("slot_date", { ascending: true });
			if (error) {
				throw error;
			}
			return (data ?? []) as AvailabilityRow[];
		},
		enabled: Boolean(courtId && monthStart),
	});
}

/**
 * Subscribe to the PUBLIC Broadcast channel for a court and invalidate the
 * availability queries on each event (spec §6.1; Phase 1 note: public channel,
 * { private: false }; payload is PII-free). One subscription per court.
 */
export function useAvailabilityRealtime(courtId: string) {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!courtId) {
			return;
		}
		const supabase = createClient();
		const channel = supabase
			.channel(`availability:court:${courtId}`, { config: { private: false } })
			.on("broadcast", { event: "*" }, () => {
				queryClient.invalidateQueries({ queryKey: ["availability", courtId] });
			})
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
		};
	}, [courtId, queryClient]);
}

function lastOfMonth(monthStart: string): string {
	const [y, m] = monthStart.split("-").map(Number);
	const last = new Date(Date.UTC(y, m, 0));
	return last.toISOString().slice(0, 10);
}
