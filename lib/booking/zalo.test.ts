import { describe, expect, test } from "bun:test";
import { normalizeOwnerZalo, safeZaloHref } from "./zalo";

describe("normalizeOwnerZalo", () => {
	test("bare phone -> zalo.me url", () => {
		expect(normalizeOwnerZalo("0901234567")).toBe("https://zalo.me/0901234567");
		expect(normalizeOwnerZalo("+84901234567")).toBe("https://zalo.me/+84901234567");
	});
	test("accepts https zalo.me urls", () => {
		expect(normalizeOwnerZalo("https://zalo.me/abc")).toBe("https://zalo.me/abc");
		expect(normalizeOwnerZalo("https://chat.zalo.me/x")).toBe("https://chat.zalo.me/x");
	});
	test("rejects other hosts / schemes", () => {
		expect(normalizeOwnerZalo("javascript:alert(1)")).toBeNull();
		expect(normalizeOwnerZalo("https://evil.com")).toBeNull();
		expect(normalizeOwnerZalo("data:text/html,x")).toBeNull();
		expect(normalizeOwnerZalo("")).toBeNull();
	});
});

describe("safeZaloHref", () => {
	test("passes only https", () => {
		expect(safeZaloHref("https://zalo.me/x")).toBe("https://zalo.me/x");
		expect(safeZaloHref("javascript:alert(1)")).toBeNull();
		expect(safeZaloHref(null)).toBeNull();
	});
});
