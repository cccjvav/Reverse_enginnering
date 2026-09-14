// RECONSTRUCTED from src/bridge-usage-counter.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


var BridgeUsageCounter = class {
  pending = 0;
  recordToolCall() {
    this.pending += 1;
  }
  take() {
    const count = this.pending;
    this.pending = 0;
    return count;
  }
  returnCount(count) {
    if (Number.isFinite(count) && count > 0) {
      this.pending += count;
    }
  }
  reset() {
    const changed = this.pending !== 0;
    this.pending = 0;
    return changed;
  }
};

export { BridgeUsageCounter };
