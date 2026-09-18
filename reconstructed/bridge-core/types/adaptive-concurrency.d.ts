// Hand-written types for reconstructed/bridge-core/src/adaptive-concurrency.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  The author declares the sample shape inline at recovered
//               src/bridge-tool-dispatcher.ts:202 -
//               `{ durationMs: number; failed: boolean; queued: number }` -
//               and constructs the controller with `{ min, max }` only
//               (line 109), which is why windowSize and slowCallMs are
//               optional. They read `decision.changed` then `decision.limit`
//               (lines 204-206).
//   OBSERVED    Thresholds and the reason vocabulary are literals in the
//               shipped module: shrink when strained*3 >= window, grow when
//               queued*2 >= window, otherwise hold. The JSDoc on record() and
//               reset() survived compilation and is the author's own wording.
//   INFERRED    Nothing material; the class is small enough that every member
//               is directly observable.

/** Why the limit did or did not move. */
export type AdaptiveConcurrencyReason = 'hold' | 'grow' | 'shrink';

/** One completed call, fed back to the controller. */
export interface AdaptiveConcurrencySample {
	readonly durationMs: number;
	readonly failed: boolean;
	/** How many callers were waiting when this one started. */
	readonly queued: number;
}

export interface AdaptiveConcurrencyDecision {
	/** The limit in force after this sample. */
	readonly limit: number;
	/**
	 * Whether the limit actually moved.
	 *
	 * False even for a "shrink" or "grow" verdict that was clamped at min or
	 * max, so callers can skip a redundant resize - the author relies on this.
	 */
	readonly changed: boolean;
	readonly reason: AdaptiveConcurrencyReason;
}

export interface AdaptiveConcurrencyOptions {
	/** Floor for the limit; also its starting value. */
	readonly min: number;
	/** Ceiling for the limit. */
	readonly max: number;
	/** Samples per decision window. Defaults to DEFAULT_WINDOW. */
	readonly windowSize?: number;
	/** A call at or over this duration counts as strained. */
	readonly slowCallMs?: number;
}

/** Samples per decision window when unspecified. */
export const DEFAULT_WINDOW: number;
/** Slow-call threshold when unspecified. */
export const DEFAULT_SLOW_CALL_MS: number;

/**
 * Adjusts a concurrency limit from observed latency, failures and queueing.
 *
 * Deliberately conservative in both directions: it halves on strain but grows
 * by one, so a burst of failures is undone quickly while recovery is gradual.
 */
export class AdaptiveConcurrencyController {
	/**
	 * @throws if min is not a positive integer, or max is not an integer >= min.
	 */
	constructor(options: AdaptiveConcurrencyOptions);

	/** Current limit. Starts at `min`. */
	readonly limit: number;
	/** Samples collected since the last decision. */
	readonly pending: number;

	/**
	 * Records one completion.
	 *
	 * Returns a decision only once a full window has accumulated; until then it
	 * reports the current limit with reason "hold" and `changed: false`.
	 */
	record(sample: AdaptiveConcurrencySample): AdaptiveConcurrencyDecision;

	/**
	 * Drops partial-window state, for instance after a manual limit change.
	 *
	 * A supplied limit is truncated and clamped into [min, max] rather than
	 * rejected.
	 */
	reset(limit?: number): void;
}
