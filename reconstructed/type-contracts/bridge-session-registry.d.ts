/** Minimal state read by the implementation, not a replacement for McpSession. */
export interface SessionActivity {
  activeRequests: number;
  activeStreams: number;
  lastActivity: number;
}
export interface SessionRegistryOptions<T extends SessionActivity> {
  closeSession?: (session: T) => void;
  onSessionDestroyed?: (sessionId: string, session: T, reason: string) => void;
}
export declare class BridgeSessionRegistry<T extends SessionActivity> {
  constructor(options?: SessionRegistryOptions<T>);
  get size(): number;
  get(sessionId: string): T | undefined;
  set(sessionId: string, session: T): void;
  has(sessionId: string): boolean;
  isActive(session: T): boolean;
  prune(now: number, idleTimeoutMs: number, maxSessions: number): void;
  makeRoom(maxSessions: number): boolean;
  destroy(sessionId: string, reason?: string): boolean;
  destroyAfter(sessionId: string, action: (session: T) => unknown, reason?: string): Promise<boolean>;
  destroyAll(reason?: string): void;
  values(): T[];
  trimInactive(maxSize: number): void;
}
