import { beforeEach, describe, expect, test } from "bun:test";
import { clearCheckout, loadCheckout, saveCheckout } from "./checkout-storage";

describe("checkout-storage", () => {
	beforeEach(() => clearCheckout());

	test("round-trips a live hold", () => {
		const future = new Date(Date.now() + 60000).toISOString();
		saveCheckout({ reference: "ABC12345", holdExpiresAt: future });
		expect(loadCheckout()?.reference).toBe("ABC12345");
	});

	test("drops an expired hold", () => {
		saveCheckout({ reference: "OLD", holdExpiresAt: new Date(Date.now() - 1000).toISOString() });
		expect(loadCheckout()).toBeNull();
	});

	test("clear removes the saved hold", () => {
		saveCheckout({ reference: "X", holdExpiresAt: new Date(Date.now() + 60000).toISOString() });
		clearCheckout();
		expect(loadCheckout()).toBeNull();
	});

	test("returns null when no hold is saved", () => {
		expect(loadCheckout()).toBeNull();
	});
});
