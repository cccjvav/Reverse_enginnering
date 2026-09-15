/** Candidate contract inferred from adaptive-concurrency.js. */
export interface ConcurrencyOptions {
  min: number;
  max: number;
  windowSize?: number;
  slowCallMs?: number;
}
export interface ConcurrencySample {
  failed: boolean;
  durationMs: number;
  queued: number;
}
export interface ConcurrencyDecision {
  limit: number;
  changed: boolean;
  reason: 'hold' | 'shrink' | 'grow';
}
export declare class AdaptiveConcurrencyController {
  constructor(options: ConcurrencyOptions);
  get limit(): number;
  get pending(): number;
  record(sample: ConcurrencySample): ConcurrencyDecision;
  reset(limit?: number): void;
}
export declare const DEFAULT_WINDOW: 12;
export declare const DEFAULT_SLOW_CALL_MS: 30000;
