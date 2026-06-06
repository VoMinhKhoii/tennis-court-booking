/** Row shapes returned by the data-access hooks. */

/** public_availability view row (anon-readable, PII-free). Spec §6.1. */
export type AvailabilityRow = {
	court_id: string;
	slot_date: string; // YYYY-MM-DD (ICT)
	time_range: string; // tstzrange text, e.g. ["...","...")
	occupied: boolean;
};

export type CourtRow = {
	id: string;
	name: string;
	open_time: string; // HH:MM:SS
	close_time: string;
	is_active: boolean;
	created_at: string;
};

export type SettingsRow = {
	id: number;
	flat_hourly_rate_vnd: number;
	qr_image_path: string | null;
};

/** booking row (owner-readable). */
export type BookingRow = {
	id: string;
	court_id: string;
	type: "monthly" | "adhoc";
	customer_name: string;
	zalo_phone: string;
	group_size: number;
	status: "pending" | "confirmed" | "rejected";
	reference: string;
	amount_vnd: number;
	reject_reason: string | null;
	source: "public" | "owner";
	created_at: string;
	confirmed_at: string | null;
};
