/**
 * SSR-safe localStorage helpers to resume a checkout after a refresh / mobile
 * tab eviction (spec §"Refresh-resume"). Persists only the public reference +
 * hold expiry; the payment screen is re-hydrated from the server via getHold.
 */

const KEY = "tcb.checkout";

type Saved = { reference: string; holdExpiresAt: string };

/**
 * The backing store: the browser's localStorage when available; otherwise a
 * tiny in-memory shim so the module is SSR-safe and runs headless under tests.
 */
function store(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
	if (typeof window !== "undefined" && window.localStorage) {
		return window.localStorage;
	}
	if (typeof globalThis.localStorage !== "undefined") {
		return globalThis.localStorage;
	}
	if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
		return memoryStore;
	}
	return null;
}

const memoryMap = new Map<string, string>();
const memoryStore = {
	getItem: (k: string) => memoryMap.get(k) ?? null,
	setItem: (k: string, v: string) => {
		memoryMap.set(k, v);
	},
	removeItem: (k: string) => {
		memoryMap.delete(k);
	},
};

export function saveCheckout(v: Saved): void {
	store()?.setItem(KEY, JSON.stringify(v));
}

export function clearCheckout(): void {
	store()?.removeItem(KEY);
}

/** Returns a still-live saved hold, dropping (and clearing) expired/invalid ones. */
export function loadCheckout(): Saved | null {
	const raw = store()?.getItem(KEY);
	if (!raw) return null;
	try {
		const v = JSON.parse(raw) as Saved;
		if (!v.reference || new Date(v.holdExpiresAt) <= new Date()) {
			clearCheckout();
			return null;
		}
		return v;
	} catch {
		clearCheckout();
		return null;
	}
}
