// Hand-written types for reconstructed/bridge-core/src/concurrency.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  `Semaphore` is imported by the author's recovered
//               src/bridge-tool-dispatcher.ts:15 and declared there as a field
//               type (line 99), constructed with a number (line 108), and used
//               via run/setLimit/active/waiting/limit (lines 187-215).
//   OBSERVED    Everything else is read off the shipped implementation, which
//               unusually kept its explanatory JSDoc: the comments on setLimit
//               and createReleaser are the author's own words, so the subtle
//               guarantees below are quoted rather than deduced.
//   INFERRED    `run` is generic in its callback's return type. The
//               implementation simply returns `await fn()`, and the author
//               relies on the result being typed at the call site.

/**
 * Releases a previously acquired permit.
 *
 * Single-use by construction: repeated calls are ignored, so a caller's
 * `finally` running twice cannot corrupt the permit accounting.
 */
export type SemaphoreRelease = () => void;

/** A counting semaphore with a ceiling that can move at runtime. */
export class Semaphore {
	/** @throws if `max` is not a positive integer. */
	constructor(max: number);

	/** Permits currently held. */
	readonly active: number;
	/** Callers queued for a permit. */
	readonly waiting: number;
	/** Current ceiling. */
	readonly limit: number;

	/**
	 * Changes the permit ceiling.
	 *
	 * Raising it admits queued waiters immediately. Lowering it never revokes a
	 * permit already held, so `active` can sit above `limit` until in-flight
	 * work finishes. Callers must not assume `active <= limit`.
	 *
	 * @throws if `next` is not a positive integer.
	 */
	setLimit(next: number): void;

	/**
	 * Waits for a permit.
	 *
	 * Rejects immediately if the signal is already aborted, and removes itself
	 * from the queue if aborted while waiting - so an abandoned caller does not
	 * hold up the queue.
	 */
	acquire(signal?: AbortSignal): Promise<SemaphoreRelease>;

	/** Returns a fresh single-use releaser bound to one held permit. */
	createReleaser(): SemaphoreRelease;

	/** Hands a permit back. Clamped at zero, so over-release cannot go negative. */
	release(): void;

	/** Acquires, runs, and always releases - even if `fn` throws. */
	run<T>(fn: () => T | Promise<T>, signal?: AbortSignal): Promise<T>;
}

/** Default permit ceiling for MCP tool calls. */
export const DEFAULT_MCP_CONCURRENCY: number;

/**
 * Process-wide limiter shared by MCP tool invocations.
 *
 * Module-level singleton: every importer shares one gate, which is what makes
 * the ceiling meaningful across sessions.
 */
export const mcpConcurrencyLimiter: Semaphore;

/** Normalises an abort reason into an Error, since reasons may be anything. */
export function toAbortError(reason?: unknown): Error;
