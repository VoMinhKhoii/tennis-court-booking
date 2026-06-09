/**
 * Owner Zalo contact validation/normalization (spec §"Settings: owner Zalo").
 * Accepts a bare phone (normalized to a zalo.me URL) or an https zalo.me URL;
 * rejects everything else to block stored javascript:/data: XSS + open-redirect.
 */

const ZALO_HOSTS = new Set(["zalo.me", "chat.zalo.me"]);
function isZaloHost(h: string): boolean {
	return ZALO_HOSTS.has(h) || h.endsWith(".zalo.me");
}

/** Validate/normalize an owner-entered Zalo contact to a safe https URL, or null. */
export function normalizeOwnerZalo(raw: string): string | null {
	const v = raw.trim();
	if (!v) return null;
	if (/^\+?\d{6,15}$/.test(v)) return `https://zalo.me/${v}`;
	try {
		const u = new URL(v);
		if (u.protocol === "https:" && isZaloHost(u.hostname)) return v;
	} catch {}
	return null;
}

/** Render-time guard: only emit https hrefs pointing at an allowed Zalo host. */
export function safeZaloHref(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const u = new URL(value);
		return u.protocol === "https:" && isZaloHost(u.hostname) ? value : null;
	} catch {
		return null;
	}
}
