// Community maintenance candidate; NOT included in the installer overlay.
// Based on reconstructed/bridge-core/src/concurrency.js.
// Only behavioral change: do not admit queued work above a newly lowered limit.
var Semaphore = class {
  current = 0;
  queue = [];
  max;
  constructor(max) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error("Semaphore max must be a positive integer");
    }
    this.max = max;
  }
  /**
   * Change the permit ceiling at runtime.
   *
   * Raising it admits queued waiters immediately. Lowering it never revokes a
   * permit already held — in-flight work runs to completion and the ceiling
   * takes effect as those permits are returned, so a shrink can leave `active`
   * temporarily above `limit`.
   */
  setLimit(next) {
    if (!Number.isInteger(next) || next < 1) {
      throw new Error("Semaphore max must be a positive integer");
    }
    const grew = next > this.max;
    this.max = next;
    if (!grew) return;
    while (this.current < this.max && this.queue.length > 0) {
      const admit = this.queue.shift();
      if (admit) admit();
    }
  }
  get active() {
    return this.current;
  }
  get waiting() {
    return this.queue.length;
  }
  get limit() {
    return this.max;
  }
  async acquire(signal) {
    if (signal?.aborted) {
      throw toAbortError(signal.reason);
    }
    if (this.current < this.max) {
      this.current++;
      return this.createReleaser();
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const idx = this.queue.indexOf(tryAcquire);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(toAbortError(signal?.reason));
      };
      const tryAcquire = () => {
        if (signal) signal.removeEventListener("abort", onAbort);
        this.current++;
        resolve(this.createReleaser());
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      this.queue.push(tryAcquire);
    });
  }
  /**
   * Returns a single-use release function. Guarding against repeated calls keeps the
   * permit accounting correct even when a caller's `finally` runs more than once.
   */
  createReleaser() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }
  release() {
    this.current = Math.max(0, this.current - 1);
    const next = this.current < this.max ? this.queue.shift() : undefined;
    if (next) next();
  }
  async run(fn, signal) {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }
};

function toAbortError(reason) {
  return reason instanceof Error ? reason : new Error("Aborted");
}

var DEFAULT_MCP_CONCURRENCY = 4;

var mcpConcurrencyLimiter = new Semaphore(DEFAULT_MCP_CONCURRENCY);

export { DEFAULT_MCP_CONCURRENCY, Semaphore, mcpConcurrencyLimiter, toAbortError };
