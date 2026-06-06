/**
 * Pricing — the TypeScript mirror of the amount computation inside
 * create_pending_booking (spec §8):
 *
 *   hours  = blockCount / 2
 *   amount = flatHourlyRateVnd * hours * occurrenceCount
 *
 * Counts come from the enumerated occurrences, never a separately-derived
 * integer. The DB recomputes amount from the rows it actually inserts, so this
 * is preview-only and must match. Returned amount is an integer VND value
 * (the SQL casts the product to bigint).
 */

import { BLOCK_MINUTES } from "./constants";

/** Duration of one booking, in hours, from its block count. */
export function blocksToHours(blockCount: number): number {
	return (blockCount * BLOCK_MINUTES) / 60;
}

/**
 * Total amount in VND for a booking.
 * @param flatHourlyRateVnd settings.flat_hourly_rate_vnd
 * @param blockCount consecutive 30-min blocks per occurrence
 * @param occurrenceCount number of dated occurrences (enumerateSlotDates length)
 */
export function computeAmountVnd(
	flatHourlyRateVnd: number,
	blockCount: number,
	occurrenceCount: number,
): number {
	const hours = blocksToHours(blockCount);
	// Math.trunc mirrors Postgres's cast-to-bigint truncation toward zero.
	return Math.trunc(flatHourlyRateVnd * hours * occurrenceCount);
}
