import { randomUUID } from "node:crypto";
import { createServer as createNodeHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
// MCP v2 SDK transport: header-based routing plus account/chat consistency.
// The negotiated protocol set is derived from the SDK in src/mcp-protocol.ts.
import { Server as McpServer, type ServerOptions as McpServerOptions } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import {
  type CallToolRequest,
  type CallToolResult,
  isInitializeRequest,
  type ListToolsRequest,
} from "@modelcontextprotocol/server";
import type { Transport } from "@modelcontextprotocol/server";
import { handleModernPost, isModernRequest, type ModernRequestDeps } from "./bridge-mcp-modern.js";
import { CUSTOM_TOOL_OUTPUT_SCHEMA, type CustomToolManifest } from "../../../src/custom-tools.js";
import { BoundedInMemoryEventStore } from "../../../src/bridge-event-store.js";
import {
  createBridgeHttpRoutes,
  handleBridgeHttpRequest,
  writeBridgeJsonError,
  writeBridgeJsonRpcError,
} from "../../../src/bridge-http-router.js";
import { JsonRpcRequestIdRegistry, requestIdsOfRequest } from "../../../src/jsonrpc-request-id-registry.js";
import { BridgeSessionRegistry } from "../../../src/bridge-session-registry.js";
import { bridgeManagedCommandOwnerId } from "../../../src/managed-command-cancellation.js";
import {
  BRIDGE_SERVER_INSTRUCTIONS,
  BRIDGE_TOOL_DEFINITIONS,
  MAX_REQUEST_BYTES,
  MAX_SESSIONS,
  SESSION_EVENT_STORE_LIMIT,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_KEEPALIVE_INTERVAL_MS,
  SESSION_PRUNE_INTERVAL_MS,
  SESSION_RETRY_INTERVAL_MS,
} from "./bridge-constants.js";
import type { BridgeTunnelProvider } from "./bridge-constants.js";
import type { ToolCallResult } from "./bridge-tool-dispatcher.js";
import { SHUNCODE_BEHAVIOR_VERSION } from "../../../src/version.js";

/**
 * Only JSON-RPC method names are extracted here (never request parameters or
 * bodies) for the no-session POST diagnostic. Kept module-local alongside the
 * transport that is its only caller.
 */
function bridgeMethodOf(body: unknown): string {
  const list = Array.isArray(body) ? body : [body];
  return list
    .map((message) => {
      if (!message || typeof message !== "object") return "(non-object)";
      const method = (message as { method?: unknown }).method;
      return typeof method === "string" ? method : "(no method)";
    })
    .join(",");
}

/**
 * Minimal structural surface of the MCP `Server` that this transport uses. The
 * real SDK `McpServer` satisfies it, and a test fake can implement it without
 * `as unknown as` casts. Handler request/extra are intentionally loose because
 * the SDK types them via a generic keyed on the request schema.
 */
export interface McpServerLike {
  connect(transport: Transport): Promise<void>;
  // Loose handler return: the real SDK `Server.setRequestHandler` is generic and
  // its method params are bivariant, so it remains assignable here without this
  // minimal interface having to reproduce the SDK's full `ServerResult` union.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setRequestHandler(method: string, handler: (request: any, extra: any) => any): void;
  close(): Promise<void>;
}

/**
 * Minimal structural surface of `NodeStreamableHTTPServerTransport` used here. It
 * extends the SDK `Transport` (the real transport genuinely is one, so it is
 * assignable to `McpServerLike.connect`) and adds the `handleRequest` method
 * this module drives. A test fake implements it directly — no `as unknown as`.
 */
export interface SessionTransportLike extends Transport {
  handleRequest(request: IncomingMessage, response: ServerResponse, body?: unknown): Promise<void>;
}

/** Options this transport passes to the session transport factory. */
export interface SessionTransportOptions {
  sessionIdGenerator: () => string;
  enableJsonResponse: boolean;
  eventStore: BoundedInMemoryEventStore;
  keepAliveMs: number;
  retryInterval: number;
  onsessioninitialized: (sessionId: string) => void;
  onsessionclosed: (sessionId: string) => void;
}

/**
 * Minimal structural surface of a node `http.Server`. The real server satisfies
 * it; a fake can drive the captured request handler without binding a port.
 */
export interface HttpServerLike {
  listen(port: number, host: string): void;
  address(): { port: number } | string | null;
  close(callback?: () => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, listener: (...args: any[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, listener: (...args: any[]) => void): void;
}

type HttpRequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

/** A running timer handle the transport can cancel. */
export interface TransportTimer {
  clear(): void;
}

interface McpSession {
  transport: SessionTransportLike;
  server: McpServerLike;
  requestIds: JsonRpcRequestIdRegistry;
  lastActivity: number;
  activeRequests: number;
  activeStreams: number;
}

type TransportLifecycle = "idle" | "starting" | "listening" | "closing";

/**
 * One-time immutable snapshot passed to `start()`; the transport never re-reads
 * configuration across an `await` during startup.
 */
export interface McpTransportStartOptions {
  readonly provider: BridgeTunnelProvider;
  readonly routeToken: string;
  readonly namedTunnelLocalPort: number;
}

/** Defensive, read-only status projection for `BridgeStatus`. */
export interface McpTransportSnapshot {
  readonly localPort: number | undefined;
  readonly activeRequests: number;
  readonly connected: boolean;
  readonly revision: number;
  readonly sessions: number;
  readonly lastSessionActivityAt: number | undefined;
}

/**
 * Narrow, injectable dependencies. The transport must not import `vscode` or the
 * facade: tool dispatch, logging and diagnostics are provided through this seam,
 * and the low-level factories default to production but let tests substitute
 * deterministic fakes without bypassing session wiring.
 */
export interface McpTransportDeps {
  /** Windows 平台保留：Bridge 可组合工作范围与用户自定义服务器指令（见 bridge-server.composeServerInstructions）。 */
  serverInstructions?(): string;
  /** Route a tool call; the facade binds `BridgeToolDispatcher.dispatch` here. */
  dispatchToolCall(
    name: string,
    args: Record<string, unknown>,
    extra: { signal?: AbortSignal; commandOwnerId: string },
  ): Promise<ToolCallResult>;
  beginRemoteConversation(commandOwnerId: string): void;
  endRemoteConversation(commandOwnerId: string): void;
  releaseCommandOwner(commandOwnerId: string): void;
  log(message: string): void;
  /** Enabled user-added tools for tools/list. Must be total: never throws. */
  listCustomTools?(): CustomToolManifest[];
  diag(message: string): void;
  now?(): number;
  createTimer?(callback: () => void, ms: number): TransportTimer;
  createHttpServer?(handler: HttpRequestHandler): HttpServerLike;
  createMcpServer?(serverInfo: { name: string; version: string }, options: McpServerOptions): McpServerLike;
  createSessionTransport?(options: SessionTransportOptions): SessionTransportLike;
}

/**
 * Sole owner of the HTTP listener, MCP session registry, prune timer, active
 * request counter and transport-side revision. Session create/destroy each bump
 * `revision_` exactly once; the facade sums this with its own (tunnel-side) and
 * the dispatcher revision in getStatus(). The transport never holds a facade or
 * dispatcher reference — only the narrow deps above.
 */
export class BridgeMcpTransport {
  private readonly sessions: BridgeSessionRegistry<McpSession>;
  private httpServer: HttpServerLike | undefined;
  private localPort: number | undefined;
  private sessionPruneTimer: TransportTimer | undefined;
  private activeRequests = 0;
  private revision_ = 0;
  /**
   * DELETE can cause the SDK to emit both onsessionclosed and onclose. Retain
   * the request context only while its handler is in flight so either callback
   * preserves the client-requested reason without mislabeling other closes.
   */
  private readonly deleteInFlightSessionIds = new Set<string>();

  private lifecycle: TransportLifecycle = "idle";
  private startInFlight: Promise<void> | undefined;
  private closeInFlight: Promise<void> | undefined;
  private startOptions: McpTransportStartOptions | undefined;

  constructor(private readonly deps: McpTransportDeps) {
    this.sessions = new BridgeSessionRegistry<McpSession>({
      closeSession: (session) => {
        try { void session.transport.close(); } catch { /* ignore */ }
        try { void session.server.close(); } catch { /* ignore */ }
      },
      onSessionDestroyed: (sessionId, _session, reason) => {
        const commandOwnerId = bridgeManagedCommandOwnerId(sessionId);
        this.deps.endRemoteConversation(commandOwnerId);
        this.deps.releaseCommandOwner(commandOwnerId);
        this.revision_ += 1;
        this.deps.log(`[bridge] session destroyed: ${sessionId} reason=${reason}`);
      },
    });
  }

  /** Transport-side revision; the facade adds this to its own for getStatus(). */
  get revision(): number {
    return this.revision_;
  }

  snapshot(): McpTransportSnapshot {
    let lastSessionActivityAt: number | undefined;
    for (const session of this.sessions.values()) {
      lastSessionActivityAt = Math.max(lastSessionActivityAt ?? 0, session.lastActivity);
    }
    return {
      localPort: this.localPort,
      activeRequests: this.activeRequests,
      connected: this.sessions.size > 0,
      revision: this.revision_,
      sessions: this.sessions.size,
      lastSessionActivityAt,
    };
  }

  /** Internal (non-snapshot) predicate for facade lifecycle/tunnel-recovery reads. */
  isListening(): boolean {
    return this.lifecycle === "listening";
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  // ---- Lifecycle (segmented; never a single reordering stop()) --------------

  /**
   * Start the local HTTP/MCP listener. Idempotent and concurrency-safe: a second
   * call while `starting` reuses the in-flight promise (only one listen), a call
   * while `listening` resolves immediately, and a call while `closing` waits for
   * the close to finish before starting fresh.
   */
  async start(options: McpTransportStartOptions): Promise<void> {
    if (this.lifecycle === "listening") return;
    if (this.lifecycle === "starting" && this.startInFlight) return this.startInFlight;
    if (this.lifecycle === "closing" && this.closeInFlight) {
      // Wait for the in-flight close, then RE-ENTER arbitration instead of
      // starting unconditionally: another start that was queued behind the same
      // close may already have transitioned us to starting/listening, so a blind
      // start here would open a second listener. Recursing re-reads lifecycle.
      await this.closeInFlight;
      return this.start(options);
    }
    this.lifecycle = "starting";
    // Defensive copy: never let a caller mutate the options we retain across
    // awaits. The SAME copy is handed to startHttpServer and later session
    // construction, so response-mode policy cannot change after the listener starts.
    const startOptions = { ...options };
    this.startOptions = startOptions;
    const run = (async () => {
      try {
        await this.startHttpServer(startOptions);
        this.lifecycle = "listening";
      } catch (error) {
        // Startup failed: close any half-open server and clear all derived state.
        const server = this.httpServer;
        this.httpServer = undefined;
        if (server) {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        if (this.sessionPruneTimer) {
          this.sessionPruneTimer.clear();
          this.sessionPruneTimer = undefined;
        }
        this.localPort = undefined;
        this.startOptions = undefined;
        this.lifecycle = "idle";
        throw error;
      }
    })();
    this.startInFlight = run;
    try {
      await run;
    } finally {
      this.startInFlight = undefined;
    }
  }

  /**
   * First stop segment: stop pruning and destroy all sessions. Intentionally
   * does NOT zero `activeRequests` — that happens in closeListener(), preserving
   * the original ordering (sessions/prune → tunnel kill → activeRequests/listener).
   */
  destroySessionsAndStopPruning(): void {
    if (this.sessionPruneTimer) {
      this.sessionPruneTimer.clear();
      this.sessionPruneTimer = undefined;
    }
    this.sessions.destroyAll("bridge-shutdown");
  }

  /**
   * Third stop segment: zero active requests, close the listener and clear the
   * local port. Idempotent and concurrency-safe. If a start is still in flight,
   * wait for it to settle first — swallowing any startup error so cleanup still
   * completes — then close.
   */
  async closeListener(): Promise<void> {
    if (this.lifecycle === "closing" && this.closeInFlight) return this.closeInFlight;
    if (this.lifecycle === "starting" && this.startInFlight) {
      try {
        await this.startInFlight;
      } catch {
        // Startup failed; it already cleaned up to idle. Continue below.
      }
      // Wait, then RE-ENTER arbitration: while we awaited, another close queued
      // behind the same start may already own the closing transition. Recursing
      // re-reads lifecycle so only one close closes the (single) server.
      return this.closeListener();
    }
    if (this.lifecycle === "idle") {
      // Nothing is listening. Ensure derived state is clean and return without
      // ever entering "closing" — otherwise an idle close would strand the
      // lifecycle in "closing" and block future starts.
      this.activeRequests = 0;
      this.localPort = undefined;
      this.startOptions = undefined;
      return;
    }
    // lifecycle === "listening": commit to closing BEFORE creating the close
    // promise, and restore "idle" only in finally, so the terminal state is
    // never overwritten by an out-of-order assignment inside the async body.
    this.lifecycle = "closing";
    const run = (async () => {
      this.activeRequests = 0;
      const server = this.httpServer;
      this.httpServer = undefined;
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      this.localPort = undefined;
      this.startOptions = undefined;
    })();
    this.closeInFlight = run;
    try {
      await run;
    } finally {
      this.lifecycle = "idle";
      this.closeInFlight = undefined;
    }
  }

  // ---- HTTP listener -------------------------------------------------------

  private async startHttpServer(options: McpTransportStartOptions): Promise<void> {
    const routes = createBridgeHttpRoutes(options.routeToken);
    const handler: HttpRequestHandler = (request, response) => {
      void handleBridgeHttpRequest(
        {
          routes,
          maxRequestBytes: MAX_REQUEST_BYTES,
          // Keep the optional Streamable HTTP GET/SSE channel available for every
          // provider. Some remote MCP clients open it immediately after initialize;
          // rejecting it only for Quick Tunnel made otherwise healthy servers look
          // disconnected even though POST JSON responses were working.
          standaloneGetEnabled: true,
        },
        {
          getSessionCount: () => this.sessions.size,
          handlePost: (incoming, outgoing, body, sessionId) => this.handlePost(incoming, outgoing, body, sessionId),
          handleGet: (incoming, outgoing, sessionId) => this.handleGet(incoming, outgoing, sessionId),
          handleDelete: (incoming, outgoing, sessionId) => this.handleDelete(incoming, outgoing, sessionId),
        },
        request,
        response,
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.log(`[bridge] HTTP error: ${message}`);
        this.deps.log(`[bridge] HTTP error STACK: ${error instanceof Error ? error.stack : "n/a"}`);
        writeBridgeJsonError(response, 500, message);
      });
    };
    const server = this.deps.createHttpServer
      ? this.deps.createHttpServer(handler)
      : createNodeHttpServer(handler);
    this.httpServer = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error & { code?: string }) => {
        server.off("listening", onListening);
        if (options.provider === "cloudflare-named" && error.code === "EADDRINUSE") {
          reject(new Error(`Cloudflare Named Tunnel local port ${options.namedTunnelLocalPort} is already in use. Choose another port and update the Cloudflare published application Service URL.`));
          return;
        }
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(options.provider === "cloudflare-named" ? options.namedTunnelLocalPort : 0, "127.0.0.1");
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Bridge local HTTP server did not expose a TCP port.");
    this.localPort = address.port;
    this.sessionPruneTimer = this.deps.createTimer
      ? this.deps.createTimer(() => this.pruneSessions(), SESSION_PRUNE_INTERVAL_MS)
      : createUnrefInterval(() => this.pruneSessions(), SESSION_PRUNE_INTERVAL_MS);
  }

  // ---- Request handlers ----------------------------------------------------

  private async handlePost(request: IncomingMessage, response: ServerResponse, body: unknown, sessionId: string | undefined): Promise<void> {
    // Modern-era (2026-07-28) traffic carries no session id and no initialize handshake.
    // Classify first so those requests reach the stateless handler instead of the
    // session-affine path below, whose 400 would otherwise reject every 2026 client.
    if (!sessionId && !isInitializeRequest(body) && (await isModernRequest(request, body, this.deps.diag))) {
      this.deps.diag(`POST modern-era method=${bridgeMethodOf(body)}`);
      await handleModernPost(request, response, body, this.modernDeps());
      return;
    }

    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        this.deps.diag(`POST no-session sid=${sessionId.slice(0, 8)} -> 404`);
        writeBridgeJsonError(response, 404, "Session not found. The MCP session may have expired.");
        return;
      }
      session.lastActivity = this.now();
      const requestIds = requestIdsOfRequest(body);
      const claim = session.requestIds.claim(requestIds);
      if (!claim.ok) {
        this.deps.diag(`POST duplicate request id sid=${sessionId.slice(0, 8)} id=${String(claim.conflictId)}`);
        writeBridgeJsonRpcError(
          response,
          409,
          -32009,
          "Duplicate JSON-RPC request id is already in flight for this MCP session.",
          claim.conflictId,
        );
        return;
      }
      session.activeRequests += 1;
      this.activeRequests += 1;
      try {
        await session.transport.handleRequest(request, response, body);
      } finally {
        session.requestIds.release(requestIds);
        session.activeRequests = Math.max(0, session.activeRequests - 1);
        session.lastActivity = this.now();
        this.activeRequests = Math.max(0, this.activeRequests - 1);
      }
      return;
    }

    if (!isInitializeRequest(body)) {
      this.deps.diag(`POST no-sid non-initialize -> 400 method=${bridgeMethodOf(body)}`);
      writeBridgeJsonError(response, 400, "Bad Request: a POST without Mcp-Session-Id must be an MCP initialize request.");
      return;
    }
    this.sessions.makeRoom(MAX_SESSIONS);
    if (this.sessions.size >= MAX_SESSIONS) {
      writeBridgeJsonError(response, 503, "Bridge session capacity reached. Close an existing MCP session and retry.");
      return;
    }

    const { transport, server } = this.createSession();
    this.activeRequests += 1;
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      const newSessionId = transport.sessionId;
      if (newSessionId) this.sessions.destroy(newSessionId, "initialize-error");
      throw error;
    } finally {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
    }
  }

  private async handleGet(request: IncomingMessage, response: ServerResponse, sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.deps.diag(`GET no-session sid=${sessionId.slice(0, 8)} -> 404`);
      writeBridgeJsonError(response, 404, "Session not found. The MCP session may have expired.");
      return;
    }
    const getStartedAt = this.now();
    this.deps.diag(`GET stream open sid=${sessionId.slice(0, 8)}`);
    response.once("close", () => {
      this.deps.diag(`GET stream closed sid=${sessionId.slice(0, 8)} after ${this.now() - getStartedAt}ms aborted=${request.aborted === true} destroyed=${response.destroyed === true} finished=${response.writableFinished === true}`);
    });
    session.lastActivity = this.now();
    session.activeStreams += 1;
    let released = false;
    const releaseStream = () => {
      if (released) return;
      released = true;
      session.activeStreams = Math.max(0, session.activeStreams - 1);
      session.lastActivity = this.now();
    };
    response.once("close", releaseStream);
    try {
      await session.transport.handleRequest(request, response);
    } finally {
      response.off("close", releaseStream);
      releaseStream();
    }
  }

  private async handleDelete(request: IncomingMessage, response: ServerResponse, sessionId: string): Promise<void> {
    this.deleteInFlightSessionIds.add(sessionId);
    try {
      const destroyed = await this.sessions.destroyAfter(
        sessionId,
        async (session) => {
          await session.transport.handleRequest(request, response);
        },
        "delete",
      );
      if (!destroyed) {
        writeBridgeJsonError(response, 404, "Session not found.");
      }
    } finally {
      this.deleteInFlightSessionIds.delete(sessionId);
    }
  }

  // ---- Session assembly (always performed here; never bypassed by tests) ----

  private createSession(): { transport: SessionTransportLike; server: McpServerLike } {
    const server = this.instantiateMcpServer();

    let transport!: SessionTransportLike;
    const options: SessionTransportOptions = {
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: this.startOptions?.provider === "cloudflare",
      eventStore: new BoundedInMemoryEventStore(SESSION_EVENT_STORE_LIMIT),
      keepAliveMs: SESSION_KEEPALIVE_INTERVAL_MS,
      retryInterval: SESSION_RETRY_INTERVAL_MS,
      onsessioninitialized: (sid) => {
        this.deps.beginRemoteConversation(bridgeManagedCommandOwnerId(sid));
        this.sessions.set(sid, {
          transport,
          server,
          requestIds: new JsonRpcRequestIdRegistry(),
          lastActivity: this.now(),
          activeRequests: 0,
          activeStreams: 0,
        });
        this.revision_ += 1;
        this.deps.log(`[bridge] new MCP session: ${sid}`);
      },
      onsessionclosed: (sid) => {
        this.destroyClosedSession(sid);
      },
    };
    transport = this.deps.createSessionTransport
      ? this.deps.createSessionTransport(options)
      : new NodeStreamableHTTPServerTransport(options);

    this.registerToolHandlers(server, () => transport.sessionId);

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) this.destroyClosedSession(sid);
    };

    return { transport, server };
  }

  /**
   * Build a bare MCP server carrying the Bridge identity, capabilities and instructions.
   * Shared by both protocol eras so the two paths can never drift apart.
   */
  private instantiateMcpServer(): McpServerLike {
    const serverInfo = { name: "shuncode-bridge", version: SHUNCODE_BEHAVIOR_VERSION };
    const serverOptions: McpServerOptions = {
      capabilities: { tools: {}, logging: {} },
      // 2026-07-28 cache hints. Omitting these makes the SDK emit `ttlMs: 0`
      // and `cacheScope: 'private'`, i.e. "never cache", which is what the
      // Bridge shipped before. The tool list only changes when the extension
      // itself changes, so let shared caches hold it briefly; discovery is
      // even more stable. 2025-era responses are unaffected by these hints.
      cacheHints: {
        "tools/list": { ttlMs: 60_000, cacheScope: "public" },
        "server/discover": { ttlMs: 300_000, cacheScope: "public" },
      },
      // Keep this connection-specific rule beside the MCP metadata it must reach;
      // BRIDGE_SERVER_INSTRUCTIONS remains the shared base prompt.
      instructions: this.deps.serverInstructions?.() ?? BRIDGE_SERVER_INSTRUCTIONS,
    };
    return this.deps.createMcpServer
      ? this.deps.createMcpServer(serverInfo, serverOptions)
      : new McpServer(serverInfo, serverOptions);
  }

  /**
   * Dependencies handed to the modern-era path. Deliberately narrow: it can mint a
   * per-request server, bracket an in-flight request and log — nothing session-shaped
   * is reachable from there.
   */
  private modernDeps(): ModernRequestDeps {
    return {
      createServer: (scopeId) => {
        const server = this.instantiateMcpServer();
        this.registerToolHandlers(server, () => scopeId);
        return server;
      },
      trackRequest: async (run) => {
        this.activeRequests += 1;
        try {
          return await run();
        } finally {
          this.activeRequests = Math.max(0, this.activeRequests - 1);
        }
      },
      diag: (message) => this.deps.diag(message),
    };
  }

  /**
   * Register the Bridge tool surface on `server`.
   *
   * `resolveSessionId` supplies the command-owner scope: the legacy path passes the
   * transport's session id, while the modern path passes the stable owner derived
   * from the modern client envelope because it has no Mcp-Session-Id.
   */
  private registerToolHandlers(server: McpServerLike, resolveSessionId: () => string | undefined): void {
    server.setRequestHandler('tools/list', async () => ({
      tools: [
        ...BRIDGE_TOOL_DEFINITIONS.map((tool) => ({
        name: tool.name,
        title: (tool as any).title ?? tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: (tool as any).outputSchema,
        annotations: (tool as any).annotations,
      })),
      ...(this.deps.listCustomTools?.() ?? []).map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: CUSTOM_TOOL_OUTPUT_SCHEMA,
        // User-added tools run an arbitrary local command, so they are declared
        // destructive: clients must not auto-approve them the way they may for
        // the read-only built-ins.
        annotations: {
          title: tool.title,
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      })),
      ],
    }));

    server.setRequestHandler('tools/call', async (request, extra) => {
      const toolName = request.params.name as string;
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      const result = await this.deps.dispatchToolCall(toolName, args, {
        signal: extra.signal,
        commandOwnerId: bridgeManagedCommandOwnerId(resolveSessionId()),
      });
      return {
        content: result.content,
        isError: result.isError,
        structuredContent: result.structuredContent as Record<string, unknown> | undefined,
      } as CallToolResult;
    });
  }

  private pruneSessions(): void {
    this.sessions.prune(this.now(), SESSION_IDLE_TIMEOUT_MS, MAX_SESSIONS);
  }

  /** Attribute a close to DELETE only while that request is actively handled. */
  private destroyClosedSession(sessionId: string): void {
    const reason = this.deleteInFlightSessionIds.has(sessionId) ? "delete" : "transport-close";
    this.sessions.destroy(sessionId, reason);
  }
}

function createUnrefInterval(callback: () => void, ms: number): TransportTimer {
  const timer = setInterval(callback, ms);
  timer.unref?.();
  return { clear: () => clearInterval(timer) };
}
