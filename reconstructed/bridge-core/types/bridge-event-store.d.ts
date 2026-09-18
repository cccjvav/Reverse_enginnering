// Hand-written types for reconstructed/bridge-core/src/bridge-event-store.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  The author declares `eventStore: BoundedInMemoryEventStore`
//               (recovered src/bridge-mcp-transport.ts:87) and constructs it
//               with a single numeric limit (line 551).
//   OBSERVED    Method shapes from the shipped implementation. This class
//               implements the MCP SDK's EventStore contract for resumable
//               Streamable HTTP, which is why storeEvent and replayEventsAfter
//               are async and why replay returns the stream id.
//   INFERRED    `message` is typed `unknown`: the store never inspects it, only
//               hands it back to `send`. Naming a JSON-RPC message type here
//               would claim knowledge the module does not have.

/** Callback used to re-emit one buffered event during replay. */
export type BridgeEventSender = (
	eventId: string,
	message: unknown
) => void | Promise<void>;

/**
 * Ring buffer of recent events, keyed by event id, for stream resumption.
 *
 * Bounded globally rather than per stream: once `limit` events are held the
 * oldest is discarded regardless of which stream it belonged to, so one busy
 * stream can evict another's history. Resumption is therefore best-effort.
 */
export class BoundedInMemoryEventStore {
	constructor(limit: number);

	readonly limit: number;

	/**
	 * Buffers one event and returns its generated id.
	 *
	 * Ids are monotonic per process and carry a random suffix, so they are
	 * unique across restarts as well as within one.
	 */
	storeEvent(streamId: string, message: unknown): Promise<string>;

	/**
	 * Replays everything buffered after `lastEventId` on the same stream.
	 *
	 * Returns the stream id that was resumed, or an empty string when the id is
	 * unknown - which is how an expired or evicted cursor is reported rather
	 * than throwing.
	 */
	replayEventsAfter(
		lastEventId: string,
		options: { send: BridgeEventSender }
	): Promise<string>;
}
