// Hand-written types for reconstructed/bridge-core/src/jsonrpc-request-id-registry.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  The author imports JsonRpcRequestIdRegistry and
//               requestIdsOfRequest at recovered
//               src/bridge-mcp-transport.ts:23.
//   OBSERVED    Every behaviour below is directly readable in the shipped
//               module: the `typeof:value` key scheme, the all-or-nothing
//               claim, and the batch flattening.
//   INFERRED    `claim` is modelled as a discriminated union on `ok`, because
//               conflictId is present only on the failure branch.

/** A JSON-RPC id. The spec also permits null, which this module ignores. */
export type JsonRpcRequestId = string | number;

/** Successful claim; every id is now reserved. */
export interface JsonRpcClaimOk {
	readonly ok: true;
}

/** Rejected claim, naming the first id that collided. */
export interface JsonRpcClaimConflict {
	readonly ok: false;
	readonly conflictId: JsonRpcRequestId;
}

export type JsonRpcClaimResult = JsonRpcClaimOk | JsonRpcClaimConflict;

/**
 * Builds the internal key for an id.
 *
 * Includes the JavaScript type, so the string "1" and the number 1 are
 * distinct ids rather than colliding.
 */
export function keyOf(id: JsonRpcRequestId): string;

/**
 * Extracts the id from a JSON-RPC request.
 *
 * Returns undefined for anything without a string `method` - notifications and
 * responses have no claimable id - and for ids that are neither string nor
 * number.
 */
export function requestIdOf(message: unknown): JsonRpcRequestId | undefined;

/** Collects the claimable ids from a single request or a batch. */
export function requestIdsOfRequest(body: unknown): JsonRpcRequestId[];

/**
 * Tracks in-flight JSON-RPC ids so a client cannot reuse one.
 *
 * Claims are all-or-nothing: if any id in the batch is already active, or
 * repeats within the batch, nothing is reserved. That keeps the registry
 * consistent when a caller retries the whole batch.
 */
export class JsonRpcRequestIdRegistry {
	claim(ids: readonly JsonRpcRequestId[]): JsonRpcClaimResult;
	/** Releases ids. Unknown ids are ignored, so double-release is safe. */
	release(ids: readonly JsonRpcRequestId[]): void;
}
