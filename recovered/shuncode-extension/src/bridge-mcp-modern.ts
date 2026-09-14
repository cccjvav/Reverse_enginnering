import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createMcpHandler, isLegacyRequest } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";

const MODERN_CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function modernMeta(body: unknown): Record<string, unknown> {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    const params = asRecord(asRecord(message)?.params);
    const meta = asRecord(params?._meta);
    if (meta) return meta;
  }
  return {};
}

function headerValue(request: IncomingMessage, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join("\u0000") : value ?? "";
}

/**
 * Modern MCP deliberately has no Mcp-Session-Id, but command tools still need a
 * stable owner across run_command -> get_command_output/cancel_command/send_command_input.
 * Derive a non-secret owner key from the modern client envelope and Bridge identity
 * headers; the random command_id remains the bearer capability and is never exposed
 * in this digest.
 */
export function modernCommandOwnerId(request: IncomingMessage, body: unknown): string {
  const meta = modernMeta(body);
  const clientInfo = asRecord(meta[MODERN_CLIENT_INFO_KEY]);
  const identity = {
    clientId: headerValue(request, "x-shuncode-client-id"),
    account: headerValue(request, "x-shuncode-account"),
    workspace: headerValue(request, "x-shuncode-workspace"),
    authorization: headerValue(request, "authorization"),
    clientName: typeof clientInfo?.name === "string" ? clientInfo.name : "",
    clientVersion: typeof clientInfo?.version === "string" ? clientInfo.version : "",
  };
  const digest = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return `modern:${digest}`;
}

/**
 * The 2026-07-28 ("modern") request path, kept apart from the session-affine
 * legacy transport.
 *
 * The two eras have genuinely different lifetimes: legacy traffic is bound to a
 * session that is created, pruned and torn down, while a modern request is
 * self-describing and served by a per-request server instance that is discarded
 * immediately. Holding both in one class meant the session registry, prune timer
 * and teardown bookkeeping sat next to code that must never touch them.
 *
 * This module therefore takes an explicit contract instead of a reference back to
 * the transport: it can create a server, count an in-flight request and emit
 * diagnostics, and it can do nothing else. Anything session-shaped is
 * unreachable from here by construction.
 */

/** Minimal server surface this path needs; structurally satisfied by `McpServerLike`. */
export interface ModernServerLike {
  setRequestHandler(method: string, handler: (request: any, extra: any) => any): void;
}

export interface ModernRequestDeps {
  /**
   * Build a server for a single request and register the Bridge tool surface on
   * it. `scopeId` is a stable command-owner scope derived from the modern client
   * envelope, because modern requests have no Mcp-Session-Id to carry ownership.
   */
  createServer(scopeId: string): ModernServerLike;
  /** Bracket one in-flight request so shutdown can observe it. */
  trackRequest<T>(run: () => Promise<T>): Promise<T>;
  diag(message: string): void;
}

/**
 * Convert Node's incoming header bag into fetch `Headers`.
 *
 * Node exposes repeated headers as arrays, so each value is appended
 * individually to preserve multi-value headers exactly as received.
 */
export function nodeHeadersToFetchHeaders(nodeHeaders: IncomingMessage["headers"]): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeHeaders)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.append(name, value);
    }
  }
  return headers;
}

/**
 * Classify a session-less, non-initialize POST using the SDK's own predicate.
 *
 * `isLegacyRequest` consumes the request body, so it is handed a synthetic
 * `Request` carrying the already-parsed body rather than the live
 * `IncomingMessage` — the real stream must stay intact for whichever handler
 * ends up serving it.
 *
 * A classification failure resolves to `false` (legacy), which routes the
 * request to the pre-existing path and preserves today's behaviour.
 */
export async function isModernRequest(
  request: IncomingMessage,
  body: unknown,
  diag: (message: string) => void,
): Promise<boolean> {
  try {
    const probe = new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: nodeHeadersToFetchHeaders(request.headers),
      body: JSON.stringify(body ?? null),
    });
    return !(await isLegacyRequest(probe));
  } catch (error) {
    diag(`modern classification failed, treating as legacy: ${String(error)}`);
    return false;
  }
}

/**
 * Serve one modern-era request.
 *
 * `createMcpHandler` is per-request by contract: it builds a fresh server
 * instance for every call, so there is no session to register, prune or reuse.
 * `legacy: 'reject'` keeps this handler strictly modern — legacy traffic never
 * reaches it because the router has already sent it to the session-affine path.
 */
export async function handleModernPost(
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
  deps: ModernRequestDeps,
): Promise<void> {
  await deps.trackRequest(async () => {
    const requestScopeId = modernCommandOwnerId(request, body);
    const handler = createMcpHandler(
      () => deps.createServer(requestScopeId) as never,
      {
        legacy: "reject",
        onerror: (error) => deps.diag(`modern handler error: ${error.message}`),
      },
    );
    await toNodeHandler(handler)(request, response, body);
  });
}

