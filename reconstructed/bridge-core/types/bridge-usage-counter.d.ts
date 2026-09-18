// Hand-written types for reconstructed/bridge-core/src/bridge-usage-counter.js
//
// PROVENANCE — the author imports BridgeUsageCounter
// (bridge-tool-dispatcher.ts:5), so the class name is FIRST-HAND. OBSERVED:
// the class is 20 lines and every member is visible.

/** Counts tool calls between reports, with a claim/return protocol. */
export class BridgeUsageCounter {
	/** Calls counted but not yet taken. */
	readonly pending: number;
	recordToolCall(): void;
	/** Atomically reads and clears the counter. */
	take(): number;
	/**
	 * Puts a previously taken count back after a failed report.
	 *
	 * Non-finite and non-positive values are ignored, so a failed report cannot
	 * corrupt the counter.
	 */
	returnCount(count: number): void;
	/** Clears the counter. Returns whether anything was actually discarded. */
	reset(): boolean;
}
