import { describe, expect, test } from "bun:test";
import { enumerateSlotDates, ictToday } from "./dates";

describe("ictToday", () => {
	test("derives the ICT calendar date (UTC+7)", () => {
		// 2026-06-06T18:30:00Z -> 2026-06-07 01:30 ICT -> 2026-06-07.
		expect(ictToday(new Date("2026-06-06T18:30:00Z"))).toBe("2026-06-07");
		// 2026-06-06T10:00:00Z -> 2026-06-06 17:00 ICT -> 2026-06-06.
		expect(ictToday(new Date("2026-06-06T10:00:00Z"))).toBe("2026-06-06");
	});
});

describe("enumerateSlotDates — adhoc", () => {
	test("returns exactly the supplied date", () => {
		expect(enumerateSlotDates({ type: "adhoc", date: "2030-04-10" }, "2026-06-06")).toEqual([
			"2030-04-10",
		]);
	});

	test("rejects an impossible date", () => {
		expect(() => enumerateSlotDates({ type: "adhoc", date: "2030-02-30" }, "2026-06-06")).toThrow();
	});
});

describe("enumerateSlotDates — monthly (mirrors SQL test 03)", () => {
	// Use a today far before the target months so the floor is first-of-month,
	// matching the SQL tests that pick year-2030 months.
	const earlyToday = "2026-06-06";

	test("2030-01 Tuesdays (dow=2) -> 5 dates Jan 1,8,15,22,29", () => {
		expect(
			enumerateSlotDates({ type: "monthly", month: "2030-01-15", weekday: 2 }, earlyToday),
		).toEqual(["2030-01-01", "2030-01-08", "2030-01-15", "2030-01-22", "2030-01-29"]);
	});

	test("2030-02 Tuesdays -> 4 dates", () => {
		const dates = enumerateSlotDates(
			{ type: "monthly", month: "2030-02-10", weekday: 2 },
			earlyToday,
		);
		expect(dates).toEqual(["2030-02-05", "2030-02-12", "2030-02-19", "2030-02-26"]);
	});

	test("mid-month start locks only remaining matching dates", () => {
		// today = 2030-01-16 (a Wednesday). Tuesdays in 2030-01 on/after the 16th:
		// Jan 22, 29.
		const dates = enumerateSlotDates(
			{ type: "monthly", month: "2030-01-01", weekday: 2 },
			"2030-01-16",
		);
		expect(dates).toEqual(["2030-01-22", "2030-01-29"]);
		expect(dates.every((d) => d >= "2030-01-16")).toBe(true);
	});

	test("today exactly on a matching weekday is included", () => {
		// 2030-01-15 is a Tuesday; with today = that date it must be the first.
		const dates = enumerateSlotDates(
			{ type: "monthly", month: "2030-01-01", weekday: 2 },
			"2030-01-15",
		);
		expect(dates[0]).toBe("2030-01-15");
	});

	test("does not leak beyond the target month", () => {
		const dates = enumerateSlotDates(
			{ type: "monthly", month: "2030-02-01", weekday: 2 },
			earlyToday,
		);
		expect(dates.every((d) => d.startsWith("2030-02"))).toBe(true);
	});

	test("rejects out-of-range weekday", () => {
		expect(() =>
			enumerateSlotDates({ type: "monthly", month: "2030-01-01", weekday: 7 }, earlyToday),
		).toThrow();
	});
});
