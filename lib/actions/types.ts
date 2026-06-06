/**
 * Shared discriminated result type for server actions. Actions never throw to
 * the client for expected failures (validation, conflicts, auth); they return a
 * typed { ok: false, error } so the UI can render a message. Unexpected errors
 * still throw.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; field?: string };

export function ok<T>(data: T): ActionResult<T> {
	return { ok: true, data };
}

export function fail<T = never>(error: string, field?: string): ActionResult<T> {
	return { ok: false, error, field };
}
