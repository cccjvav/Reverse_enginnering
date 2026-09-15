// Maintenance candidate. Reject ambiguous protocol headers, retain original token/method routing.
import { handleBridgeHttpRequest as original, writeBridgeJsonRpcError } from '../../reconstructed/bridge-core/src/bridge-http-router.js';
export { createBridgeHttpRoutes, readJsonBody, writeBridgeJsonError, writeBridgeJsonRpcError } from '../../reconstructed/bridge-core/src/bridge-http-router.js';
const names = ['mcp-session-id', 'mcp-protocol-version', 'mcp-method', 'mcp-name'];
/** @param {unknown} value @returns {value is string | undefined} */
function scalar(value) { return value === undefined || typeof value === 'string'; }
/** @param {import('node:http').ServerResponse} response */
function reject(response) { writeBridgeJsonRpcError(response, 400, -32600, 'Ambiguous MCP protocol header.', null); }
/**
 * @param {import('./http-router-types.js').BridgeHttpOptions} options
 * @param {import('./http-router-types.js').BridgeHttpHandlers} handlers
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
export async function handleBridgeHttpRequest(options, handlers, request, response) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === options.routes.endpointPath) {
    // rawHeaders also catches duplicates Node has already joined into a string.
    const counts = new Map();
    for (let i = 0; i < (request.rawHeaders?.length ?? 0); i += 2) {
      const name = String(request.rawHeaders[i]).toLowerCase();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    for (const name of names) {
      const value = request.headers[name];
      if ((value !== undefined && typeof value !== 'string') || (counts.get(name) ?? 0) > 1) {
        writeBridgeJsonRpcError(response, 400, -32600, 'Ambiguous MCP protocol header.', null);
        return;
      }
    }
    // Preserve original compatibility spellings, but never accept two versions of one field.
    for (const name of ['Mcp-Method', 'Mcp-Name']) {
      const value = request.headers[name];
      if (value !== undefined && (typeof value !== 'string' || request.headers[name.toLowerCase()] !== undefined)) {
        writeBridgeJsonRpcError(response, 400, -32600, 'Ambiguous MCP protocol header.', null);
        return;
      }
    }
  }
  // Check values again at the actual callback boundary (after raw body parsing).
  // This also prevents a future raw router change from violating our scalar contract.
  /** @type {import('../../reconstructed/type-contracts/bridge-http-router.js').BridgeHttpHandlers} */
  const guarded = {
    getSessionCount: () => handlers.getSessionCount(),
    handlePost: (req, res, body, session, version, method, name) => {
      if (!scalar(session) || !scalar(version) || !scalar(method) || !scalar(name)) return reject(res);
      return handlers.handlePost(req, res, body, session, version, method, name);
    },
    handleGet: (req, res, session) => {
      if (typeof session !== 'string') return reject(res);
      return handlers.handleGet(req, res, session);
    },
    handleDelete: (req, res, session) => {
      if (typeof session !== 'string') return reject(res);
      return handlers.handleDelete(req, res, session);
    }
  };
  return original(options, guarded, request, response);
}
