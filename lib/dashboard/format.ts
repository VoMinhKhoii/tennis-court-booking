/** Shared display formatters for the owner dashboard. */

/** Format a VND integer with thousands separators. */
export function formatVnd(amount: number): string {
	return `${amount.toLocaleString("en-US")} ₫`;
}

/** Human "age" of a booking from its created_at ISO timestamp. */
export function formatAge(createdAt: string, now: Date = new Date()): string {
	const ms = now.getTime() - new Date(createdAt).getTime();
	const mins = Math.max(0, Math.floor(ms / 60000));
	if (mins < 60) {
		return `${mins}m`;
	}
	const hours = Math.floor(mins / 60);
	if (hours < 24) {
		return `${hours}h`;
	}
	const days = Math.floor(hours / 24);
	return `${days}d`;
}

/** Render an ISO timestamp in ICT (UTC+7) as a readable date-time. */
export function formatIctDateTime(iso: string): string {
	return new Date(iso).toLocaleString("en-GB", {
		timeZone: "Asia/Ho_Chi_Minh",
		day: "2-digit",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
}
