import { describe, expect, test } from "bun:test";
import { enumerateSlotDates } from "./dates";
import { blocksToHours, computeAmountVnd, type PriceBand } from "./pricing";

describe("blocksToHours", () => {
	test("2 blocks = 1h, 3 blocks = 1.5h", () => {
		expect(blocksToHours(2)).toBe(1);
		expect(blocksToHours(3)).toBe(1.5);
		expect(blocksToHours(1)).toBe(0.5);
	});
});

describe("computeAmountVnd (mirrors SQL price_span)", () => {
	// The advertised "Bảng Giá Theo Giờ" bands.
	const bands: PriceBand[] = [
		{ start: "06:00", rate: 350_000 },
		{ start: "11:00", rate: 300_000 },
		{ start: "15:00", rate: 350_000 },
		{ start: "17:00", rate: 450_000 },
	];
	const flat = 200_000;

	test("within one band: 10:00 for 1h × 1 occurrence = 350,000", () => {
		// 10:00 is in the 06:00 band (350k). 2 blocks = 1h.
		const occ = enumerateSlotDates({ type: "adhoc", date: "2030-04-10" }, "2026-06-06");
		expect(computeAmountVnd(bands, flat, "10:00", 2, occ.length)).toBe(350_000);
	});

	test("crossing a boundary: 16:00 for 2h = 350k(15–17) + 450k(17–19) = 800,000", () => {
		// 4 blocks: 16:00,16:30 → 350k band; 17:00,17:30 → 450k band.
		expect(computeAmountVnd(bands, flat, "16:00", 4, 1)).toBe(800_000);
	});

	test("monthly: 12:00 for 1.5h × 5 occurrences, all in 300k band = 2,250,000", () => {
		// Wednesdays in 2030-05 (dow=3): May 1,8,15,22,29 -> 5; 3 blocks = 1.5h.
		const occ = enumerateSlotDates(
			{ type: "monthly", month: "2030-05-15", weekday: 3 },
			"2026-06-06",
		);
		expect(occ.length).toBe(5);
		// 12:00–13:30 stays in the 11:00 band (300k). 300000 * 1.5 = 450000 per occurrence.
		expect(computeAmountVnd(bands, flat, "12:00", 3, occ.length)).toBe(2_250_000);
	});

	test("minute before the first band falls back to the flat rate", () => {
		// 05:00 for 1h with the flat fallback (200k); first band starts 06:00.
		expect(computeAmountVnd(bands, flat, "05:00", 2, 1)).toBe(200_000);
	});

	test("unsorted band input is handled (sorted internally)", () => {
		const shuffled: PriceBand[] = [bands[3], bands[0], bands[2], bands[1]];
		expect(computeAmountVnd(shuffled, flat, "16:00", 4, 1)).toBe(800_000);
	});

	test("truncates toward zero like the bigint cast", () => {
		// Single 30-min block at an odd rate: 100001 / 2 = 50000.5 -> 50000.
		expect(computeAmountVnd([{ start: "06:00", rate: 100_001 }], flat, "08:00", 1, 1)).toBe(50_000);
	});

	test("zero occurrences -> zero amount", () => {
		expect(computeAmountVnd(bands, flat, "08:00", 4, 0)).toBe(0);
	});
});
