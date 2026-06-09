import { describe, expect, test } from "bun:test";
import {
	bookingInputSchema,
	courtInputSchema,
	manualBookingInputSchema,
	settingsInputSchema,
} from "./schemas";

const COURT_ID = "550e8400-e29b-41d4-a716-446655440000";

const baseAdhoc = {
	type: "adhoc" as const,
	date: "2030-04-10",
	customerName: "Anh Khoa",
	zaloPhone: "0912345678",
	groupSize: 2,
	startTime: "10:00",
	blockCount: 2,
};

const baseMonthly = {
	type: "monthly" as const,
	month: "2030-05-01",
	weekdays: [3],
	customerName: "Chi Lan",
	zaloPhone: "+84912345678",
	groupSize: 1,
	startTime: "14:30",
	blockCount: 3,
};

describe("bookingInputSchema — accepts valid input", () => {
	test("valid ad-hoc", () => {
		expect(bookingInputSchema.safeParse(baseAdhoc).success).toBe(true);
	});
	test("valid monthly (single weekday)", () => {
		expect(bookingInputSchema.safeParse(baseMonthly).success).toBe(true);
	});
	test("valid monthly (multiple weekdays)", () => {
		expect(bookingInputSchema.safeParse({ ...baseMonthly, weekdays: [1, 3, 5] }).success).toBe(
			true,
		);
	});
	test("optional preferredCourtId accepted", () => {
		expect(bookingInputSchema.safeParse({ ...baseAdhoc, preferredCourtId: COURT_ID }).success).toBe(
			true,
		);
	});
});

describe("bookingInputSchema — rejects bad input", () => {
	test("misaligned start time (10:15)", () => {
		const r = bookingInputSchema.safeParse({ ...baseAdhoc, startTime: "10:15" });
		expect(r.success).toBe(false);
	});

	test("block count above the cap (29)", () => {
		expect(bookingInputSchema.safeParse({ ...baseAdhoc, blockCount: 29 }).success).toBe(false);
	});

	test("block count below 1 (0)", () => {
		expect(bookingInputSchema.safeParse({ ...baseAdhoc, blockCount: 0 }).success).toBe(false);
	});

	test("group size below 1", () => {
		expect(bookingInputSchema.safeParse({ ...baseAdhoc, groupSize: 0 }).success).toBe(false);
	});

	test("empty customer name", () => {
		expect(bookingInputSchema.safeParse({ ...baseAdhoc, customerName: "  " }).success).toBe(false);
	});

	test("invalid phone (letters)", () => {
		expect(bookingInputSchema.safeParse({ ...baseAdhoc, zaloPhone: "abc" }).success).toBe(false);
	});

	test("invalid preferredCourtId (not uuid)", () => {
		expect(bookingInputSchema.safeParse({ ...baseAdhoc, preferredCourtId: "nope" }).success).toBe(
			false,
		);
	});

	test("monthly weekday out of range", () => {
		expect(bookingInputSchema.safeParse({ ...baseMonthly, weekdays: [7] }).success).toBe(false);
	});

	test("monthly empty weekdays rejected", () => {
		expect(bookingInputSchema.safeParse({ ...baseMonthly, weekdays: [] }).success).toBe(false);
	});

	test("adhoc missing date field is rejected", () => {
		const { date, ...noDate } = baseAdhoc;
		void date;
		expect(bookingInputSchema.safeParse(noDate).success).toBe(false);
	});

	test("unknown type rejected by the discriminated union", () => {
		expect(bookingInputSchema.safeParse({ ...baseAdhoc, type: "weekly" }).success).toBe(false);
	});

	test("client cannot inject status/amount/source (stripped, not honored)", () => {
		const r = bookingInputSchema.safeParse({
			...baseAdhoc,
			status: "confirmed",
			amountVnd: 0,
			source: "owner",
		});
		expect(r.success).toBe(true);
		if (r.success) {
			expect("status" in r.data).toBe(false);
			expect("amountVnd" in r.data).toBe(false);
			expect("source" in r.data).toBe(false);
		}
	});
});

describe("courtInputSchema", () => {
	test("valid court", () => {
		expect(
			courtInputSchema.safeParse({
				name: "Court 1",
				openTime: "06:00",
				closeTime: "21:00",
				isActive: true,
			}).success,
		).toBe(true);
	});

	test("open must be before close", () => {
		expect(
			courtInputSchema.safeParse({
				name: "Court 1",
				openTime: "21:00",
				closeTime: "06:00",
				isActive: true,
			}).success,
		).toBe(false);
	});

	test("misaligned hours rejected", () => {
		expect(
			courtInputSchema.safeParse({
				name: "Court 1",
				openTime: "06:15",
				closeTime: "21:00",
				isActive: true,
			}).success,
		).toBe(false);
	});
});

describe("manualBookingInputSchema", () => {
	test("owner adhoc requires explicit courtId", () => {
		expect(manualBookingInputSchema.safeParse({ ...baseAdhoc, courtId: COURT_ID }).success).toBe(
			true,
		);
		expect(manualBookingInputSchema.safeParse(baseAdhoc).success).toBe(false);
	});
	test("owner monthly uses a single weekday + courtId", () => {
		expect(
			manualBookingInputSchema.safeParse({
				type: "monthly",
				month: "2030-05-01",
				weekday: 3,
				courtId: COURT_ID,
				customerName: "Chi Lan",
				zaloPhone: "0912345678",
				groupSize: 1,
				startTime: "14:30",
				blockCount: 3,
			}).success,
		).toBe(true);
	});
});

describe("settingsInputSchema", () => {
	test("positive integer rate", () => {
		expect(settingsInputSchema.safeParse({ flatHourlyRateVnd: 200_000 }).success).toBe(true);
	});
	test("rejects non-positive", () => {
		expect(settingsInputSchema.safeParse({ flatHourlyRateVnd: 0 }).success).toBe(false);
	});
	test("rejects non-integer", () => {
		expect(settingsInputSchema.safeParse({ flatHourlyRateVnd: 1.5 }).success).toBe(false);
	});
	test("accepts optional bank fields", () => {
		expect(
			settingsInputSchema.safeParse({
				flatHourlyRateVnd: 200_000,
				bankBin: "970415",
				bankAccountNumber: "0123456789",
				bankAccountName: "NGUYEN VAN A",
			}).success,
		).toBe(true);
	});
});
