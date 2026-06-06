/**
 * Booking domain constants. These MUST stay in sync with the SQL side
 * (supabase/migrations/...): max_block_count(), the 30-min block, and the fixed
 * ICT timezone. The DB is the source of truth; these mirror it for the form
 * preview (§6, §8).
 */

/** Atomic bookable unit: 30 minutes (§3). */
export const BLOCK_MINUTES = 30;

/**
 * Maximum consecutive 30-min blocks a single booking may span. Mirrors
 * public.max_block_count() (= 28 blocks = 14h). Change both together.
 */
export const MAX_BLOCK_COUNT = 28;

/** Fixed business timezone (UTC+7, no DST). Spec §2. */
export const ICT_OFFSET_MINUTES = 7 * 60;
