import { beforeEach, describe, expect, test } from "bun:test";
import { __resetRateLimiter, checkRateLimit, RATE_LIMIT } from "./rate-limit";

describe("checkRateLimit", () => {
	beforeEach(() => __resetRateLimiter());

	test("allows up to MAX_PER_WINDOW, then blocks", () => {
		const now = 1_000_000;
		for (let i = 0; i < RATE_LIMIT.MAX_PER_WINDOW; i++) {
			expect(checkRateLimit("k", now)).toBe(true);
		}
		expect(checkRateLimit("k", now)).toBe(false);
	});

	test("resets after the window elapses", () => {
		const now = 1_000_000;
		for (let i = 0; i < RATE_LIMIT.MAX_PER_WINDOW; i++) {
			checkRateLimit("k", now);
		}
		expect(checkRateLimit("k", now)).toBe(false);
		expect(checkRateLimit("k", now + RATE_LIMIT.WINDOW_MS + 1)).toBe(true);
	});

	test("keys are independent", () => {
		const now = 1_000_000;
		for (let i = 0; i < RATE_LIMIT.MAX_PER_WINDOW; i++) {
			checkRateLimit("a", now);
		}
		expect(checkRateLimit("a", now)).toBe(false);
		expect(checkRateLimit("b", now)).toBe(true);
	});
});
