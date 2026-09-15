/** Headers are forwarded without normalization; do not hide string[] from callers. */
import type { IncomingMessage, ServerResponse } from 'node:http';
export type BridgeHeaderValue = string | string[] | undefined;
export interface BridgeHttpRoutes { endpointPath: string; healthPath: string }
export interface BridgeHttpOptions {
  routes: BridgeHttpRoutes;
  maxRequestBytes: number;
  standaloneGetEnabled: boolean;
}
export interface BridgeHttpHandlers {
  getSessionCount: () => number;
  handlePost: (request: IncomingMessage, response: ServerResponse, body: unknown,
    sessionId: BridgeHeaderValue, protocolVersion: BridgeHeaderValue,
    mcpMethod: BridgeHeaderValue, mcpName: BridgeHeaderValue) => void | Promise<void>;
  handleGet: (request: IncomingMessage, response: ServerResponse, sessionId: string | string[]) => void | Promise<void>;
  handleDelete: (request: IncomingMessage, response: ServerResponse, sessionId: string | string[]) => void | Promise<void>;
}
export declare function createBridgeHttpRoutes(routeToken: string): BridgeHttpRoutes;
export declare function readJsonBody(request: IncomingMessage, maxRequestBytes: number): Promise<unknown>;
export declare function handleBridgeHttpRequest(options: BridgeHttpOptions, handlers: BridgeHttpHandlers,
  request: IncomingMessage, response: ServerResponse): Promise<void>;
export declare function writeBridgeJsonError(response: ServerResponse, statusCode: number, message: string): void;
export declare function writeBridgeJsonRpcError(response: ServerResponse, statusCode: number, rpcCode: number,
  message: string, id: string | number | null): void;
