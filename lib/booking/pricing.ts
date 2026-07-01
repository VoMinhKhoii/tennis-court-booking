/**
 * Pricing — the TypeScript mirror of the amount computation inside price_span()
 * / create_pending_booking (spec §8):
 *
 *   perOccurrence = trunc(Σ over 30-min blocks of rateForBlock / 2)
 *   amount        = perOccurrence * occurrenceCount
 *
 * Rate is time-band aware: each block is priced by the band whose start is the
 * greatest <= the block's minute (else the flat fallback, for any minute earlier
 * than the first band). Counts come from the enumerated occurrences, never a
 * separately-derived integer. The DB recomputes amount from the rows it actually
 * inserts, so this is preview-only and must match. Returned amount is an integer
 * VND value (the SQL casts the product to bigint).
 */

import { BLOCK_MINUTES } from "./constants";
import { timeToMinutes } from "./grid";

/** A time-of-day price band: rate (VND/hour) applies from `start` (HH:MM) on. */
export type PriceBand = { start: string; rate: number };

/** Duration of one booking, in hours, from its block count. */
export function blocksToHours(blockCount: number): number {
	return (blockCount * BLOCK_MINUTES) / 60;
}

/** The VND/hour rate for a given minute-of-day, from ordered bands + flat fallback. */
function rateForMinute(sortedBands: PriceBand[], flatFallback: number, minute: number): number {
	let rate = flatFallback;
	for (const band of sortedBands) {
		if (timeToMinutes(band.start) <= minute) rate = band.rate;
		else break;
	}
	return rate;
}

/**
 * Total amount in VND for a booking, priced per 30-min block against its band.
 * @param bands settings.price_bands (any order; sorted here)
 * @param flatFallback settings.flat_hourly_rate_vnd (minutes before the first band)
 * @param startTime span start, HH:MM (30-min aligned)
 * @param blockCount consecutive 30-min blocks per occurrence
 * @param occurrenceCount number of dated occurrences (enumerateSlotDates length)
 */
export function computeAmountVnd(
	bands: PriceBand[],
	flatFallback: number,
	startTime: string,
	blockCount: number,
	occurrenceCount: number,
): number {
	const sorted = [...bands].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
	const startMin = timeToMinutes(startTime);
	let perOccurrence = 0;
	for (let i = 0; i < blockCount; i++) {
		perOccurrence += rateForMinute(sorted, flatFallback, startMin + i * BLOCK_MINUTES) / 2;
	}
	// Math.trunc mirrors Postgres's cast-to-bigint truncation toward zero.
	return Math.trunc(perOccurrence) * occurrenceCount;
}
