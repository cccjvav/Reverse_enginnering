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
//   INTEROP     `message` is the MCP SDK's JSONRPCMessage, and `send` must
//               return Promise<void>, not void | Promise<void>. The store
//               itself never inspects the message, so `unknown` looked
//               defensible - but this class is handed to the SDK as its
//               eventStore (bridge-mcp-transport.ts:551), and callback
//               parameters are checked contravariantly: a looser parameter
//               type makes the whole options object unassignable. Typing it
//               loosely produced a real error at the SDK boundary, so the
//               precise type is the correct one here.

import type { JSONRPCMessage } from '@modelcontextprotocol/server';

/** Callback used to re-emit one buffered event during replay. */
export type BridgeEventSender = (
	eventId: string,
	message: JSONRPCMessage
) => Promise<void>;

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
	storeEvent(streamId: string, message: JSONRPCMessage): Promise<string>;

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
