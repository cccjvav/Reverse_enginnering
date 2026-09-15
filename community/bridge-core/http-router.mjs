// Maintenance candidate. Reject ambiguous protocol headers, retain original token/method routing.
import { handleBridgeHttpRequest as original, writeBridgeJsonRpcError } from '../../reconstructed/bridge-core/src/bridge-http-router.js';
export { createBridgeHttpRoutes, readJsonBody, writeBridgeJsonError, writeBridgeJsonRpcError } from '../../reconstructed/bridge-core/src/bridge-http-router.js';
const names = ['mcp-session-id', 'mcp-protocol-version', 'mcp-method', 'mcp-name'];
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
  return original(options, handlers, request, response);
}
