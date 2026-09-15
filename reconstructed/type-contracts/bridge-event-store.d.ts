/** Candidate SDK 2.0.0-compatible contract. Storage does not validate messages. */
import type { JSONRPCMessage } from '@modelcontextprotocol/server';
export * as import_node_crypto5 from 'node:crypto';
export declare class BoundedInMemoryEventStore {
  constructor(limit: number);
  storeEvent(streamId: string, message: JSONRPCMessage): Promise<string>;
  replayEventsAfter(lastEventId: string, options: {
    send: (eventId: string, message: JSONRPCMessage) => Promise<void>;
  }): Promise<string>;
}
