// Hand-written types for reconstructed/bridge-core/src/managed-command-retention.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE for the names; OBSERVED, the module is a
// single pure function over a record list.

export const MANAGED_COMMAND_COMPLETED_STATE_TTL_MS: number;
export const MAX_COMPLETED_COMMAND_STATES_PER_OWNER: number;

/** The minimum a record must expose to take part in pruning. */
export interface ManagedCommandRetentionRecord {
	readonly id: string;
	readonly ownerId: string;
	readonly status: string;
	/** Epoch millis; undefined for a record that never finished cleanly. */
	readonly endedAt?: number;
}

/**
 * Decides which completed command states to drop.
 *
 * Running commands are never pruned. Finished ones go once past the TTL, and
 * each owner keeps at most MAX_COMPLETED_COMMAND_STATES_PER_OWNER of the rest,
 * newest first - so one busy owner cannot evict another's history.
 *
 * Pure: it returns ids to remove and mutates nothing.
 */
export function managedCommandStateIdsToPrune(
	records: Iterable<ManagedCommandRetentionRecord>,
	now?: number
): Set<string>;
