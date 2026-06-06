import { describe, expect, test } from "bun:test";
import {
	buildDayGrid,
	datesInMonth,
	minutesToTime,
	monthLabel,
	monthStartOf,
	nextMonthStart,
	rangeStartIctMinutes,
	timeToMinutes,
} from "./grid";

describe("timeToMinutes / minutesToTime", () => {
	test("parses HH:MM and HH:MM:SS", () => {
		expect(timeToMinutes("06:00")).toBe(360);
		expect(timeToMinutes("06:30:00")).toBe(390);
		expect(timeToMinutes("21:00")).toBe(1260);
	});
	test("round-trips", () => {
		expect(minutesToTime(360)).toBe("06:00");
		expect(minutesToTime(390)).toBe("06:30");
		expect(minutesToTime(1290)).toBe("21:30");
	});
});

describe("rangeStartIctMinutes", () => {
	test("derives ICT start minute from a UTC tstzrange lower bound", () => {
		// 03:00Z -> 10:00 ICT -> 600 minutes.
		expect(rangeStartIctMinutes('["2026-06-06 03:00:00+00","2026-06-06 03:30:00+00")')).toBe(600);
		// 14:30Z -> 21:30 ICT -> 1290.
		expect(rangeStartIctMinutes('["2026-06-06 14:30:00+00","2026-06-06 15:00:00+00")')).toBe(1290);
	});
	test("wraps across UTC midnight back into ICT same-day", () => {
		// 23:00Z -> 06:00 ICT next UTC day; slot_date carries the day, time = 360.
		expect(rangeStartIctMinutes('["2026-06-05 23:00:00+00","2026-06-05 23:30:00+00")')).toBe(360);
	});
});

describe("buildDayGrid", () => {
	test("emits aligned 30-min blocks within [open, close)", () => {
		const grid = buildDayGrid("06:00", "08:00", new Set());
		expect(grid.map((b) => b.startTime)).toEqual(["06:00", "06:30", "07:00", "07:30"]);
		expect(grid.every((b) => !b.occupied)).toBe(true);
	});
	test("marks occupied blocks by ICT start minute", () => {
		const grid = buildDayGrid("06:00", "07:30", new Set([390])); // 06:30
		expect(grid.find((b) => b.startTime === "06:30")?.occupied).toBe(true);
		expect(grid.find((b) => b.startTime === "06:00")?.occupied).toBe(false);
	});
});

describe("month helpers", () => {
	test("datesInMonth lists every calendar day", () => {
		expect(datesInMonth("2026-02-01")).toHaveLength(28);
		expect(datesInMonth("2026-06-01")).toHaveLength(30);
		expect(datesInMonth("2026-06-01")[0]).toBe("2026-06-01");
	});
	test("monthStartOf / nextMonthStart", () => {
		expect(monthStartOf("2026-06-17")).toBe("2026-06-01");
		expect(nextMonthStart("2026-06-01")).toBe("2026-07-01");
		expect(nextMonthStart("2026-12-01")).toBe("2027-01-01");
	});
	test("monthLabel", () => {
		expect(monthLabel("2026-06-01")).toBe("June 2026");
	});
});
