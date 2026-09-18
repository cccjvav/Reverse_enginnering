// Hand-written types for reconstructed/bridge-core/src/bridge-activity-tracker.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  `BridgeActivitySnapshot` is the author's own type name,
//               imported by recovered src/bridge-tool-dispatcher.ts:27 and used
//               at line 126 as `BridgeActivitySnapshot<BridgeActivityPresentation>`.
//               That single use site is what tells us the type is generic in
//               the presentation payload - a non-generic reconstruction would
//               have been wrong, and nothing in the JavaScript would reveal it.
//   FIRST-HAND  The activity element shape is the author's `BridgeActivity`
//               interface, declared verbatim in recovered
//               src/bridge-constants.ts:240-252, including its status union.
//   OBSERVED    Statistics field names and their arithmetic come from
//               snapshot() (line 56) and finish() (line 38) in the shipped
//               implementation.
//
// The module is kept generic over the presentation type rather than importing
// the extension's own BridgeActivityPresentation: this is the lower layer, and
// depending upward would invert the dependency the author had.

/** Activity lifecycle states, from BridgeActivity in bridge-constants.ts:244. */
export type BridgeActivityStatus = 'running' | 'completed' | 'error' | 'progress';

/**
 * One recorded tool call.
 *
 * Mirrors the author's `BridgeActivity` (bridge-constants.ts:240). `id` and
 * `at` are assigned by push() (line 22) and must not be supplied by callers.
 */
export interface BridgeActivityEntry<TPresentation = unknown> {
	readonly id: number;
	readonly at: string;
	readonly tool: string;
	readonly status: BridgeActivityStatus;
	readonly durationMs?: number;
	readonly message?: string;
	readonly phase?: string;
	readonly percent?: number;
	readonly todoId?: string;
	readonly todoTitle?: string;
	readonly presentation?: TPresentation;
}

/** What a caller supplies to push(); id and at are added by the tracker. */
export type BridgeActivityInput<TPresentation = unknown> =
	Omit<BridgeActivityEntry<TPresentation>, 'id' | 'at'>;

/** Aggregate counters. Field set and arithmetic from snapshot():57. */
export interface BridgeActivityStats {
	readonly toolCalls: number;
	readonly completedToolCalls: number;
	readonly failedToolCalls: number;
	/** Mean duration of completed calls, rounded; 0 when none have completed. */
	readonly averageDurationMs: number;
	/** Percentage in 0..100. Defaults to 100 before anything has completed. */
	readonly successRate: number;
	readonly lastTool?: string;
	readonly lastToolAt?: string;
}

/**
 * Stats plus the retained activity window.
 *
 * Generic because the author instantiates it as
 * `BridgeActivitySnapshot<BridgeActivityPresentation>`.
 */
export interface BridgeActivitySnapshot<TPresentation = unknown> {
	readonly stats: BridgeActivityStats;
	/**
	 * Not `readonly BridgeActivityEntry[]`: snapshot() returns a fresh sliced
	 * array and the author assigns it straight to a mutable BridgeActivity[]
	 * field (bridge-server.ts:274). A readonly element type would reject their
	 * own code.
	 */
	readonly activities: BridgeActivityEntry<TPresentation>[];
}

export class BridgeActivityTracker<TPresentation = unknown> {
	/**
	 * Two positional arguments, not an options bag: the author calls
	 * `new BridgeActivityTracker<BridgeActivityPresentation>(MAX_ACTIVITY)`
	 * (bridge-tool-dispatcher.ts:85). `now` returns an ISO timestamp string,
	 * not epoch millis.
	 */
	constructor(limit: number, now?: () => string);
	/**
	 * Records a new activity and returns its id.
	 *
	 * Entries with status "progress" deliberately do not count towards
	 * toolCalls (line 31), so progress pings cannot inflate the statistics.
	 */
	push(input: BridgeActivityInput<TPresentation>): number;
	/**
	 * Completes a previously pushed activity. Returns false when the id is
	 * unknown - the tracker keeps only the most recent `limit` entries, so a
	 * late finish for an evicted activity is expected, not an error.
	 */
	finish(
		id: number,
		status: BridgeActivityStatus,
		durationMs: number,
		message?: string,
		presentation?: TPresentation
	): boolean;
	snapshot(): BridgeActivitySnapshot<TPresentation>;
	/** Drops finished activities, keeping running ones. Returns how many went. */
	clear(): number;
	reset(): void;
}
