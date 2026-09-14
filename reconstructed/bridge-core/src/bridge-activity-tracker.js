// RECONSTRUCTED from src/bridge-activity-tracker.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


var BridgeActivityTracker = class {
  constructor(limit, now = () => (/* @__PURE__ */ new Date()).toISOString()) {
    this.limit = limit;
    this.now = now;
  }
  limit;
  now;
  activities = [];
  nextActivityId = 1;
  toolCalls = 0;
  completedToolCalls = 0;
  failedToolCalls = 0;
  totalToolDurationMs = 0;
  lastTool;
  lastToolAt;
  push(input) {
    const at = this.now();
    const item = {
      id: this.nextActivityId++,
      at,
      ...input
    };
    this.activities.push(item);
    if (this.activities.length > this.limit) {
      this.activities.splice(0, this.activities.length - this.limit);
    }
    if (input.status !== "progress") {
      this.toolCalls += 1;
      this.lastTool = input.tool;
      this.lastToolAt = at;
    }
    return item.id;
  }
  finish(id, status, durationMs, message, presentation) {
    const index = this.activities.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const current = this.activities[index];
    if (current.status === "running") {
      this.completedToolCalls += 1;
      this.totalToolDurationMs += durationMs;
      if (status === "error") this.failedToolCalls += 1;
    }
    this.activities[index] = {
      ...current,
      status,
      durationMs,
      message: message ?? current.message,
      presentation: presentation ?? current.presentation
    };
    return true;
  }
  snapshot() {
    return {
      stats: {
        toolCalls: this.toolCalls,
        completedToolCalls: this.completedToolCalls,
        failedToolCalls: this.failedToolCalls,
        averageDurationMs: this.completedToolCalls > 0 ? Math.round(this.totalToolDurationMs / this.completedToolCalls) : 0,
        successRate: this.completedToolCalls > 0 ? (this.completedToolCalls - this.failedToolCalls) / this.completedToolCalls * 100 : 100,
        lastTool: this.lastTool,
        lastToolAt: this.lastToolAt
      },
      activities: this.activities.slice(-this.limit)
    };
  }
  reset() {
    const changed = this.activities.length > 0 || this.nextActivityId !== 1 || this.toolCalls !== 0 || this.completedToolCalls !== 0 || this.failedToolCalls !== 0 || this.totalToolDurationMs !== 0 || this.lastTool !== void 0 || this.lastToolAt !== void 0;
    this.activities.length = 0;
    this.nextActivityId = 1;
    this.toolCalls = 0;
    this.completedToolCalls = 0;
    this.failedToolCalls = 0;
    this.totalToolDurationMs = 0;
    this.lastTool = void 0;
    this.lastToolAt = void 0;
    return changed;
  }
  /**
   * Clears the finished tool-call timeline and resets the call statistics while
   * keeping calls that are still running so their completion is still recorded
   * consistently. Mirrors the Bridge "clear tool call log" action.
   */
  clear() {
    const running = this.activities.filter((item) => item.status === "running");
    const removed = this.activities.length - running.length;
    this.activities.splice(0, this.activities.length, ...running);
    this.toolCalls = running.length;
    this.completedToolCalls = 0;
    this.failedToolCalls = 0;
    this.totalToolDurationMs = 0;
    const newest = running.length ? running[running.length - 1] : void 0;
    this.lastTool = newest?.tool;
    this.lastToolAt = newest?.at;
    return removed;
  }
};

export { BridgeActivityTracker };
