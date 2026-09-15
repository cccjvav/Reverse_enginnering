/** Candidate public contract from tracker bodies and preserved BridgeActivity callers. */
export interface BridgeActivityInput<T = unknown> {
  readonly tool: string;
  readonly status: 'running' | 'completed' | 'error' | 'progress';
  readonly durationMs?: number;
  readonly message?: string;
  readonly phase?: string;
  readonly percent?: number;
  readonly todoId?: string;
  readonly todoTitle?: string;
  readonly presentation?: T;
}
export interface BridgeActivityRecord<T = unknown> extends BridgeActivityInput<T> {
  readonly id: number;
  readonly at: string;
}
export interface BridgeActivitySnapshot<T = unknown> {
  stats: {
    toolCalls: number;
    completedToolCalls: number;
    failedToolCalls: number;
    averageDurationMs: number;
    successRate: number;
    lastTool: string | undefined;
    lastToolAt: string | undefined;
  };
  activities: BridgeActivityRecord<T>[];
}
export declare class BridgeActivityTracker<T = unknown> {
  constructor(limit: number, now?: () => string);
  push(input: BridgeActivityInput<T>): number;
  finish(id: number, status: 'completed' | 'error', durationMs: number, message?: string, presentation?: T): boolean;
  snapshot(): BridgeActivitySnapshot<T>;
  reset(): boolean;
  clear(): number;
}
