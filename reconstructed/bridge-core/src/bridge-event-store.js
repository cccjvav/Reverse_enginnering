// RECONSTRUCTED from src/bridge-event-store.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


import * as import_node_crypto5 from "node:crypto";

var BoundedInMemoryEventStore = class {
  constructor(limit) {
    this.limit = limit;
  }
  limit;
  events = /* @__PURE__ */ new Map();
  order = [];
  sequence = 0;
  async storeEvent(streamId, message) {
    const eventId = `${Date.now().toString(36)}-${(++this.sequence).toString(36)}-${(0, import_node_crypto5.randomUUID)()}`;
    this.events.set(eventId, { streamId, message });
    this.order.push(eventId);
    while (this.order.length > this.limit) {
      const oldest = this.order.shift();
      if (oldest) this.events.delete(oldest);
    }
    return eventId;
  }
  async replayEventsAfter(lastEventId, { send }) {
    const previous = this.events.get(lastEventId);
    if (!previous) return "";
    let found = false;
    for (const eventId of this.order) {
      if (eventId === lastEventId) {
        found = true;
        continue;
      }
      if (!found) continue;
      const event = this.events.get(eventId);
      if (event?.streamId === previous.streamId) {
        await send(eventId, event.message);
      }
    }
    return previous.streamId;
  }
};

export { BoundedInMemoryEventStore, import_node_crypto5 };
