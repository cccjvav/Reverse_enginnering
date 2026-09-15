import type {IncomingMessage, ServerResponse} from 'node:http';
import type {BridgeHttpOptions, BridgeHttpHandlers} from './http-router-types.js';
export type {BridgeHttpOptions, BridgeHttpHandlers} from './http-router-types.js';
export {createBridgeHttpRoutes, readJsonBody, writeBridgeJsonError, writeBridgeJsonRpcError} from '../../reconstructed/type-contracts/bridge-http-router.js';
export declare function handleBridgeHttpRequest(options: BridgeHttpOptions, handlers: BridgeHttpHandlers,
  request: IncomingMessage, response: ServerResponse): Promise<void>;
