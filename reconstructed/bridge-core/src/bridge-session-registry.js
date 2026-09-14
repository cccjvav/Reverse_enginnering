// RECONSTRUCTED from src/bridge-session-registry.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


var BridgeSessionRegistry = class {
  constructor(options = {}) {
    this.options = options;
  }
  options;
  sessions = /* @__PURE__ */ new Map();
  get size() {
    return this.sessions.size;
  }
  get(sessionId) {
    return this.sessions.get(sessionId);
  }
  set(sessionId, session) {
    this.sessions.set(sessionId, session);
  }
  has(sessionId) {
    return this.sessions.has(sessionId);
  }
  isActive(session) {
    return session.activeRequests > 0 || session.activeStreams > 0;
  }
  prune(now, idleTimeoutMs, maxSessions) {
    for (const [sessionId, session] of this.sessions) {
      if (!this.isActive(session) && now - session.lastActivity >= idleTimeoutMs) {
        this.destroy(sessionId, "idle-prune");
      }
    }
    this.trimInactive(maxSessions);
  }
  makeRoom(maxSessions) {
    this.trimInactive(maxSessions - 1);
    return this.sessions.size < maxSessions;
  }
  /**
   * Remove one session. The default keeps existing callers source-compatible
   * while still providing a deterministic diagnostic reason to observers.
   */
  destroy(sessionId, reason = "explicit") {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.sessions.delete(sessionId);
    this.options.closeSession?.(session);
    this.options.onSessionDestroyed?.(sessionId, session, reason);
    return true;
  }
  async destroyAfter(sessionId, action, reason = "delete") {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    await action(session);
    this.destroy(sessionId, reason);
    return true;
  }
  destroyAll(reason = "explicit") {
    for (const sessionId of [...this.sessions.keys()]) {
      this.destroy(sessionId, reason);
    }
  }
  values() {
    return [...this.sessions.values()];
  }
  trimInactive(maxSize) {
    while (this.sessions.size > maxSize) {
      const oldestInactive = [...this.sessions.entries()].filter(([, session]) => !this.isActive(session)).sort((a, b) => a[1].lastActivity - b[1].lastActivity)[0];
      if (!oldestInactive) return;
      this.destroy(oldestInactive[0], "capacity-eviction");
    }
  }
};

export { BridgeSessionRegistry };
