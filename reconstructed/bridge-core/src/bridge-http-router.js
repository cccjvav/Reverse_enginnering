// RECONSTRUCTED from src/bridge-http-router.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.
import { getBuildInfo } from './build-info.js';
import { describeProtocolSupport } from './mcp-protocol.js';

function createBridgeHttpRoutes(routeToken) {
  return {
    endpointPath: `/mcp/${routeToken}`,
    healthPath: `/healthz/${routeToken}`
  };
}

function writeBridgeJsonError(response, statusCode, message) {
  writeBridgeJsonRpcError(response, statusCode, statusCode === 404 ? -32004 : -32e3, message, null);
}

function writeBridgeJsonRpcError(response, statusCode, rpcCode, message, id) {
  if (response.headersSent) return;
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: rpcCode, message },
    id
  }));
}

async function readJsonBody(request, maxRequestBytes) {
  return await new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxRequestBytes) {
        reject(new Error(`MCP request body exceeds ${maxRequestBytes} bytes.`));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve(void 0);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("MCP request body is not valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

async function handleBridgeHttpRequest(options, handlers, request, response) {
  const url2 = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url2.pathname === options.routes.healthPath) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      writeBridgeJsonError(response, 405, "Method not allowed.");
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.writeHead(200);
    if (request.method !== "HEAD") {
      const protocol = describeProtocolSupport();
      response.end(JSON.stringify({
        ok: true,
        name: "shuncode-bridge",
        sessions: handlers.getSessionCount(),
        build: getBuildInfo(),
        latestProtocolVersion: protocol.latest,
        supportedVersions: protocol.supportedVersions,
        protocol: protocol.transport,
        statelessCapable: protocol.statelessCapable,
        workspaceHub: "machine-wide (macOS) / globalStorage (Linux) - account and chat preserved across workspace switches"
      }));
    } else {
      response.end();
    }
    return;
  }
  if (url2.pathname !== options.routes.endpointPath) {
    writeBridgeJsonError(response, 404, "Not found");
    return;
  }
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type, accept, mcp-session-id, mcp-protocol-version, mcp-method, mcp-name, last-event-id, authorization, x-shuncode-account, x-shuncode-workspace, x-shuncode-client-id");
  response.setHeader("Access-Control-Expose-Headers", "mcp-session-id, mcp-protocol-version, mcp-method, mcp-name");
  response.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  const sessionId = request.headers["mcp-session-id"];
  const protocolVersion = request.headers["mcp-protocol-version"];
  const mcpMethod = request.headers["mcp-method"] ?? request.headers["Mcp-Method"];
  const mcpName = request.headers["mcp-name"] ?? request.headers["Mcp-Name"];
  if (request.method === "POST") {
    const body = await readJsonBody(request, options.maxRequestBytes);
    await handlers.handlePost(request, response, body, sessionId, protocolVersion, mcpMethod, mcpName);
    return;
  }
  if (request.method === "GET") {
    if (!options.standaloneGetEnabled) {
      response.setHeader("Allow", "POST, DELETE, OPTIONS");
      writeBridgeJsonError(response, 405, "Standalone SSE is disabled for Cloudflare Quick Tunnel; use Streamable HTTP POST responses.");
      return;
    }
    if (!sessionId) {
      writeBridgeJsonError(response, 400, "Bad Request: Mcp-Session-Id header is required for GET requests.");
      return;
    }
    await handlers.handleGet(request, response, sessionId);
    return;
  }
  if (request.method === "DELETE") {
    if (!sessionId) {
      writeBridgeJsonError(response, 400, "Bad Request: Mcp-Session-Id header is required for DELETE requests.");
      return;
    }
    await handlers.handleDelete(request, response, sessionId);
    return;
  }
  writeBridgeJsonError(response, 405, "Method not allowed.");
}

export { createBridgeHttpRoutes, handleBridgeHttpRequest, readJsonBody, writeBridgeJsonError, writeBridgeJsonRpcError };
