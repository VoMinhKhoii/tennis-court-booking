/** Centralized TanStack Query keys so invalidation stays consistent. */
export const queryKeys = {
	availability: (courtId: string, monthStart: string) =>
		["availability", courtId, monthStart] as const,
	courts: () => ["courts"] as const,
	settings: () => ["settings"] as const,
	pendingBookings: () => ["bookings", "pending"] as const,
	confirmedBookings: (filters: { courtId?: string; month?: string; name?: string }) =>
		["bookings", "confirmed", filters] as const,
} as const;
