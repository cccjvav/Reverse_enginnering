/** Candidate contract inferred from concurrency.js, not the lost original source. */
export declare class Semaphore {
  constructor(max: number);
  setLimit(next: number): void;
  get active(): number;
  get waiting(): number;
  get limit(): number;
  acquire(signal?: AbortSignal): Promise<() => void>;
  createReleaser(): () => void;
  release(): void;
  run<T>(fn: () => T | PromiseLike<T>, signal?: AbortSignal): Promise<T>;
}
export declare function toAbortError(reason?: unknown): Error;
export declare const DEFAULT_MCP_CONCURRENCY: 4;
export declare const mcpConcurrencyLimiter: Semaphore;
