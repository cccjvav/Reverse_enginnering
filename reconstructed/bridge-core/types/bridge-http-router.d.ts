// Hand-written types for reconstructed/bridge-core/src/bridge-http-router.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  The author imports four of these symbols at recovered
//               src/bridge-mcp-transport.ts:17-22 and calls
//               handleBridgeHttpRequest at line 369 with a fully written-out
//               options and handlers literal - which is what fixes both
//               interfaces below, including the exact handler arities
//               (handlePost takes a parsed body, handleGet and handleDelete do
//               not) and the `.catch(...)` that shows it returns a promise.
//   OBSERVED    Route shapes from createBridgeHttpRoutes (line 6); the error
//               envelope and its JSON-RPC codes from writeBridgeJsonRpcError
//               (line 17); the body-size and JSON rules from readJsonBody
//               (line 27).
//   INFERRED    `readJsonBody` resolves undefined for an empty body - the
//               implementation returns early with `resolve(void 0)` before any
//               parse, so an absent body is distinct from `null`.

import type { IncomingMessage, ServerResponse } from 'node:http';

/** The two URL paths the bridge serves, both namespaced by the route token. */
export interface BridgeHttpRoutes {
	/** `/mcp/<routeToken>` - the Streamable HTTP MCP endpoint. */
	readonly endpointPath: string;
	/** `/healthz/<routeToken>` - liveness and capability probe. */
	readonly healthPath: string;
}

export interface BridgeHttpRouterOptions {
	readonly routes: BridgeHttpRoutes;
	/** Requests with a larger body are rejected rather than buffered. */
	readonly maxRequestBytes: number;
	/**
	 * Whether to serve the optional GET/SSE channel.
	 *
	 * The author enables it for every provider: some remote MCP clients open it
	 * straight after initialize, and refusing made working servers look
	 * disconnected.
	 */
	readonly standaloneGetEnabled?: boolean;
}

/**
 * Callbacks the router dispatches to.
 *
 * Only handlePost receives a parsed body; the router reads and validates JSON
 * before delegating, so handlers never see a malformed payload.
 */
export interface BridgeHttpHandlers {
	getSessionCount(): number;
	handlePost(
		request: IncomingMessage,
		response: ServerResponse,
		body: unknown,
		sessionId: string | undefined
	): void | Promise<void>;
	handleGet(
		request: IncomingMessage,
		response: ServerResponse,
		sessionId: string | undefined
	): void | Promise<void>;
	handleDelete(
		request: IncomingMessage,
		response: ServerResponse,
		sessionId: string | undefined
	): void | Promise<void>;
}

/** Derives the token-scoped paths. */
export function createBridgeHttpRoutes(routeToken: string): BridgeHttpRoutes;

/**
 * Writes a JSON-RPC error response.
 *
 * Maps the HTTP status to an RPC code: 404 becomes -32004, anything else
 * -32000. No-ops when headers have already been sent, so it is safe to call
 * from a late error handler.
 */
export function writeBridgeJsonError(
	response: ServerResponse,
	statusCode: number,
	message: string
): void;

/** As writeBridgeJsonError, with an explicit RPC code and request id. */
export function writeBridgeJsonRpcError(
	response: ServerResponse,
	statusCode: number,
	rpcCode: number,
	message: string,
	id: string | number | null
): void;

/**
 * Reads and parses a JSON request body.
 *
 * Resolves undefined when the body is empty - distinct from a body of `null`.
 *
 * @throws if the body exceeds maxRequestBytes, in which case the request is
 * destroyed rather than drained, or if it is not valid JSON.
 */
export function readJsonBody(
	request: IncomingMessage,
	maxRequestBytes: number
): Promise<unknown>;

/**
 * Routes one HTTP request.
 *
 * Handles the health endpoint itself and delegates MCP traffic to `handlers`.
 * Rejections surface to the caller, so the transport can log and reply 500 -
 * the author relies on exactly that.
 */
export function handleBridgeHttpRequest(
	options: BridgeHttpRouterOptions,
	handlers: BridgeHttpHandlers,
	request: IncomingMessage,
	response: ServerResponse
): Promise<void>;
