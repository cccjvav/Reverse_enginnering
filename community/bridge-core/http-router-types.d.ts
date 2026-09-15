import type {IncomingMessage, ServerResponse} from 'node:http';
export type {BridgeHttpOptions} from '../../reconstructed/type-contracts/bridge-http-router.js';
/** The maintenance adapter rejects non-scalar/duplicate headers before delegation. */
export interface BridgeHttpHandlers {
  getSessionCount: () => number;
  handlePost: (request: IncomingMessage, response: ServerResponse, body: unknown,
    sessionId: string | undefined, protocolVersion: string | undefined,
    mcpMethod: string | undefined, mcpName: string | undefined) => void | Promise<void>;
  handleGet: (request: IncomingMessage, response: ServerResponse, sessionId: string) => void | Promise<void>;
  handleDelete: (request: IncomingMessage, response: ServerResponse, sessionId: string) => void | Promise<void>;
}
