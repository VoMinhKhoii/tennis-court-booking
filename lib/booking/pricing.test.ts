import { describe, expect, test } from "bun:test";
import { enumerateSlotDates } from "./dates";
import { blocksToHours, computeAmountVnd } from "./pricing";

describe("blocksToHours", () => {
	test("2 blocks = 1h, 3 blocks = 1.5h", () => {
		expect(blocksToHours(2)).toBe(1);
		expect(blocksToHours(3)).toBe(1.5);
		expect(blocksToHours(1)).toBe(0.5);
	});
});

describe("computeAmountVnd (mirrors SQL test 03 pricing)", () => {
	const rate = 200_000;

	test("ad-hoc: rate * 1h * 1 occurrence", () => {
		// 2 blocks = 1h, 1 occurrence.
		const occ = enumerateSlotDates({ type: "adhoc", date: "2030-04-10" }, "2026-06-06");
		expect(computeAmountVnd(rate, 2, occ.length)).toBe(200_000);
	});

	test("monthly: rate * 1.5h * 5 occurrences = 1,500,000", () => {
		// Wednesdays in 2030-05 (dow=3): May 1,8,15,22,29 -> 5; 3 blocks = 1.5h.
		const occ = enumerateSlotDates(
			{ type: "monthly", month: "2030-05-15", weekday: 3 },
			"2026-06-06",
		);
		expect(occ.length).toBe(5);
		expect(computeAmountVnd(rate, 3, occ.length)).toBe(1_500_000);
	});

	test("truncates toward zero like the bigint cast", () => {
		// rate that produces a fractional product: 100001 * 0.5 * 1 = 50000.5 -> 50000.
		expect(computeAmountVnd(100_001, 1, 1)).toBe(50_000);
	});

	test("zero occurrences -> zero amount", () => {
		expect(computeAmountVnd(rate, 4, 0)).toBe(0);
	});
});
