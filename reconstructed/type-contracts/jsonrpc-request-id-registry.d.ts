/** IDs are strings or numbers; null/boolean/object are deliberately not IDs here. */
export type RequestId = string | number;
export type RequestIdClaim = { ok: true } | { ok: false; conflictId: RequestId };
export declare function keyOf(id: RequestId): string;
export declare function requestIdOf(message: unknown): RequestId | undefined;
export declare function requestIdsOfRequest(body: unknown): RequestId[];
export declare class JsonRpcRequestIdRegistry {
  claim(ids: RequestId[]): RequestIdClaim;
  release(ids: RequestId[]): void;
}
