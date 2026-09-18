// Hand-written types for reconstructed/bridge-core/src/bridge-session-registry.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  The author declares the field as
//               `BridgeSessionRegistry<McpSession>` and constructs it with an
//               explicit type argument (recovered src/bridge-mcp-transport.ts,
//               lines 183 and 202). The class is therefore generic in the
//               session type - nothing in the JavaScript shows that.
//               Their McpSession also declares lastActivity, activeRequests and
//               activeStreams as numbers (lines 119-121), which is what the
//               constraint below encodes.
//   OBSERVED    Method set and semantics from the shipped implementation; the
//               comment on destroy() is the author's own surviving JSDoc.
//   INFERRED    The destroy reason is a widened string, not a closed union.
//               The module itself only emits "idle-prune",
//               "capacity-eviction", "explicit" and "delete", but the author
//               passes "bridge-shutdown" and "initialize-error" from the
//               extension, so a closed union would reject their own code.

/**
 * The minimum a session must expose for the registry to manage it.
 *
 * Matches the author's McpSession fields used by isActive() and the pruning
 * order (bridge-mcp-transport.ts:119-121).
 */
export interface BridgeSessionLike {
	/** Epoch millis of the last observed activity; drives idle pruning. */
	lastActivity: number;
	activeRequests: number;
	activeStreams: number;
}

/**
 * Why a session went away.
 *
 * Known values from this module are "idle-prune", "capacity-eviction",
 * "explicit" and "delete"; callers may supply their own, and the author does.
 */
export type BridgeSessionDestroyReason = string;

export interface BridgeSessionRegistryOptions<TSession> {
	/** Invoked before the session is dropped, to release its resources. */
	closeSession?: (session: TSession) => void;
	/** Observer hook; runs after removal, so the registry is already consistent. */
	onSessionDestroyed?: (
		sessionId: string,
		session: TSession,
		reason: BridgeSessionDestroyReason
	) => void;
}

/**
 * Keyed collection of live sessions with idle and capacity eviction.
 *
 * Active sessions - those with in-flight requests or open streams - are never
 * evicted, by either pruning path.
 */
export class BridgeSessionRegistry<TSession extends BridgeSessionLike> {
	constructor(options?: BridgeSessionRegistryOptions<TSession>);

	readonly size: number;

	get(sessionId: string): TSession | undefined;
	set(sessionId: string, session: TSession): void;
	has(sessionId: string): boolean;

	/** A session is active while it has requests in flight or streams open. */
	isActive(session: TSession): boolean;

	/** Evicts idle sessions past the timeout, then trims to maxSessions. */
	prune(now: number, idleTimeoutMs: number, maxSessions: number): void;

	/**
	 * Frees a slot for a new session.
	 *
	 * Returns false when every remaining session is active, since those are
	 * never evicted - the caller must reject rather than displace live work.
	 */
	makeRoom(maxSessions: number): boolean;

	/** Removes one session. Returns false if the id was unknown. */
	destroy(sessionId: string, reason?: BridgeSessionDestroyReason): boolean;

	/**
	 * Runs `action` against the session, then destroys it.
	 *
	 * The action is awaited first, so a graceful shutdown can complete before
	 * the session disappears. Returns false if the id was unknown.
	 */
	destroyAfter(
		sessionId: string,
		action: (session: TSession) => void | Promise<void>,
		reason?: BridgeSessionDestroyReason
	): Promise<boolean>;

	destroyAll(reason?: BridgeSessionDestroyReason): void;

	/** Snapshot of the live sessions. */
	values(): TSession[];

	/** Evicts oldest-inactive-first until at most maxSize sessions remain. */
	trimInactive(maxSize: number): void;
}
