import { createHash } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { validateExternalMcpId } from '../../../src/external-mcp-import.js';
import { classifyExternalMcpError, externalMcpErrorLogLine, type ExternalMcpFailureStatus } from '../../../src/external-mcp-network-errors.js';
import { connectExternalMcp, externalMcpTimeoutMs } from './external-mcp-connection.js';
export { connectExternalMcp } from './external-mcp-connection.js';
import type { ResolvedExternalMcpServer } from './external-mcp-catalog.js';
import { MAX_EXTERNAL_MCP_SERVERS } from './external-mcp-catalog.js';

export interface ExternalMcpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}
export interface ExternalMcpPublicTool extends ExternalMcpTool { serverId: string; upstreamName: string }
export interface ExternalMcpConnection {
  list(signal: AbortSignal): Promise<ExternalMcpTool[]>;
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult>;
  close(): Promise<void>;
}
export interface ExternalMcpRegistryDeps {
  load(): Promise<ResolvedExternalMcpServer[]>;
  trusted(): boolean;
  /** Synchronous user catalog revision for fail-closed cross-window disable/removal. */
  revision?(): string;
  onChanged(): void;
  log(message: string): void;
  connect?(config: ResolvedExternalMcpServer, onChanged: () => void, onClosed: () => void, bundledBinDir?: string, firstConnectTimeoutMs?: number): Promise<ExternalMcpConnection>;
  /** Absolute path to ShunCode's bundled runtime bin dir (uv/uvx, ...), appended to managed stdio PATH so `uvx` works out of the box. */
  bundledBinDir?: string;
}
export interface ExternalMcpHealth {
  id: string; state: 'off' | 'connecting' | 'ready' | 'error'; toolCount: number; error?: string;
  /** Why an `error` happened (R2 §6.2): 401/403 need credentials, proxy failures need network settings. */
  status?: ExternalMcpFailureStatus;
  /** `connecting` again after this server had been ready: the connection was lost and is being re-established. */
  reconnecting?: boolean;
}
interface UpstreamState {
  key: string;
  config: ResolvedExternalMcpServer;
  connection?: ExternalMcpConnection;
  pending?: Promise<ExternalMcpConnection>;
  controller: AbortController;
  health: ExternalMcpHealth;
  updated: number;
  active: number;
}
interface Binding { serverId: string; upstreamName: string; tool: ExternalMcpPublicTool }
const MAX_TOOLS = 100;
const MAX_TOOL_BYTES = 100_000;
const MAX_RESULT_BYTES = 1_000_000;

function safeTool(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 70);
}
function changedFingerprint(bindings: ReadonlyMap<string, Binding>): string {
  return createHash('sha256').update(JSON.stringify([...bindings].map(([name, value]) => [name, value.upstreamName, value.tool]))).digest('hex');
}
function timeoutSignal(parent: AbortSignal | undefined, duration: number): AbortSignal {
  const timeout = AbortSignal.timeout(duration);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}
async function deadline<T>(work: Promise<T>, duration: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('upstream deadline exceeded'), { name: 'TimeoutError' })), duration);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
function safeError(error: unknown): string {
  // SDK error.message can include a capability URL or request headers. Never echo it: attribute by code/status.
  return classifyExternalMcpError(error).message;
}
function failure(id: string, error: unknown): ExternalMcpHealth {
  const { status, message } = classifyExternalMcpError(error);
  return { id, state: 'error', toolCount: 0, error: message, status };
}

/** One registry per BridgeManager: sources fail independently and bindings are never guesses from tool names. */
export class ExternalMcpRegistry {
  private readonly states = new Map<string, UpstreamState>();
  /** Servers that reached `ready` and are still configured: a new connection for them is a reconnect. */
  private readonly wasReady = new Set<string>();
  private bindings = new Map<string, Binding>();
  private fingerprint = '';
  private cachedUntil = 0;
  private sourceRevision = '';
  private generation = 0;
  private disposed = false;
  constructor(private readonly deps: ExternalMcpRegistryDeps) { }

  snapshot(): ExternalMcpHealth[] { return [...this.states.values()].map(state => ({ ...state.health })); }

  /** Synchronous invalidation: no stale exposed name can be called after disable/trust revocation. */
  invalidate(): void {
    this.generation++;
    this.cachedUntil = 0;
    this.bindings.clear();
    this.deps.onChanged();
  }

  private async discard(id: string): Promise<void> {
    const state = this.states.get(id);
    if (!state) return;
    this.states.delete(id);
    state.controller.abort();
    // A transport stuck in connect must never stall trust revocation or Bridge shutdown.
    if (state.pending && !state.connection) void state.pending.then(connection => connection.close()).catch(() => undefined);
    if (state.connection) await deadline(state.connection.close(), 1_500).catch(() => undefined);
  }

  async stopAll(): Promise<void> {
    this.invalidate();
    await Promise.allSettled([...this.states.keys()].map(id => this.discard(id)));
  }

  async dispose(): Promise<void> { this.disposed = true; await this.stopAll(); }

  private async ensure(config: ResolvedExternalMcpServer, firstConnectTimeoutMs?: number): Promise<UpstreamState> {
    validateExternalMcpId(config.id);
    const key = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    let state = this.states.get(config.id);
    if (state && state.key !== key) { await this.discard(config.id); state = undefined; }
    if (!state) {
      state = { key, config, controller: new AbortController(), health: { id: config.id, state: 'connecting', toolCount: 0, ...(this.wasReady.has(config.id) ? { reconnecting: true } : {}) }, updated: 0, active: 0 };
      this.states.set(config.id, state);
    }
    if (!state.pending && !state.connection) {
      const owned = state;
      const connecting = (this.deps.connect ?? connectExternalMcp)(config,
        () => { if (this.states.get(config.id) === owned) this.invalidate(); },
        () => {
          if (this.states.get(config.id) === owned) {
            this.invalidate();
            void this.discard(config.id);
          }
        }, this.deps.bundledBinDir, firstConnectTimeoutMs);
      state.pending = connecting;
      try {
        const attempts = config.transport === 'http' && config.httpTransport === 'auto' ? 2 : 1;
        const connection = await deadline(connecting, (firstConnectTimeoutMs ?? externalMcpTimeoutMs(config, 'connect')) * attempts + 500);
        if (this.states.get(config.id) !== state || state.controller.signal.aborted) {
          void connection.close().catch(() => undefined);
          throw new Error('upstream disabled during connect');
        }
        state.connection = connection; state.health = { id: config.id, state: 'ready', toolCount: state.health.toolCount };
        this.wasReady.add(config.id);
      }
      catch (error) { state.health = failure(config.id, error); void connecting.then(conn => conn.close()).catch(() => undefined); throw error; }
      finally { state.pending = undefined; }
    } else if (state.pending) {
      state.connection = await state.pending;
    }
    return state;
  }

  /** Bounded per-upstream discovery (three seconds unless configured), with independent peers in parallel. */
  async listTools(reserved: ReadonlySet<string> = new Set(), firstConnectTimeouts?: ReadonlyMap<string, number>): Promise<ExternalMcpPublicTool[]> {
    if (this.disposed || !this.deps.trusted()) { await this.stopAll(); return []; }
    let revision: string | undefined;
    try { revision = this.deps.revision?.(); } catch { await this.stopAll(); return []; }
    if (Date.now() < this.cachedUntil && revision === this.sourceRevision) return [...this.bindings.values()].map(item => item.tool).filter(tool => !reserved.has(tool.name));
    const generation = ++this.generation;
    let configs: ResolvedExternalMcpServer[];
    try { configs = (await this.deps.load()).slice(0, MAX_EXTERNAL_MCP_SERVERS); }
    catch { await this.stopAll(); return []; }
    if (this.disposed || !this.deps.trusted() || generation !== this.generation) return [];
    const enabled = new Set(configs.map(config => config.id));
    for (const id of [...this.wasReady]) if (!enabled.has(id)) this.wasReady.delete(id);
    await Promise.allSettled([...this.states.keys()].filter(id => !enabled.has(id)).map(id => this.discard(id)));
    const outcomes = await Promise.allSettled(configs.map(async config => {
      const state = await this.ensure(config, firstConnectTimeouts?.get(config.id));
      if (!state.connection) return [];
      const listMs = externalMcpTimeoutMs(config, 'list');
      const tools = await deadline(state.connection.list(timeoutSignal(state.controller.signal, listMs)), listMs + 200);
      if (tools.length > MAX_TOOLS) throw new Error('too many tools');
      const local = new Map<string, Binding>();
      const conflicts = new Set<string>();
      for (const tool of tools) {
        if (!tool || typeof tool.name !== 'string' || !tool.name || !tool.inputSchema || typeof tool.inputSchema !== 'object' ||
          JSON.stringify(tool).length > MAX_TOOL_BYTES) continue;
        const clean = safeTool(tool.name);
        if (!clean || !/^[a-z0-9_]+$/.test(clean)) continue;
        const name = `ext__${config.id}__${clean}`;
        const definition: ExternalMcpPublicTool = {
          name, title: `${config.label} / ${String(tool.title || tool.name).slice(0, 100)}`,
          description: String(tool.description || '').slice(0, 4_000), inputSchema: tool.inputSchema,
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
          annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
          serverId: config.id, upstreamName: tool.name,
        };
        if (local.has(name)) { conflicts.add(name); local.delete(name); }
        else if (!conflicts.has(name)) local.set(name, { serverId: config.id, upstreamName: tool.name, tool: definition });
      }
      if (conflicts.size) this.deps.log(`[external-mcp] ${config.id}: ${conflicts.size} unsafe tool-name collisions suppressed`);
      state.updated = Date.now(); state.health = { id: config.id, state: 'ready', toolCount: local.size };
      return [...local];
    }));
    if (generation !== this.generation || this.disposed || !this.deps.trusted()) return [];
    try { if (revision !== this.deps.revision?.()) { await this.stopAll(); return []; } }
    catch { await this.stopAll(); return []; }
    const next = new Map<string, Binding>();
    for (let index = 0; index < outcomes.length; index++) {
      const result = outcomes[index];
      if (result.status === 'fulfilled') {
        for (const [name, binding] of result.value) if (!reserved.has(name) && !next.has(name)) next.set(name, binding);
      } else {
        const id = configs[index].id; const state = this.states.get(id);
        if (state) { state.health = failure(id, result.reason); }
        this.deps.log(externalMcpErrorLogLine(id, 'list', result.reason));
      }
    }
    const fingerprint = changedFingerprint(next);
    this.bindings = next;
    this.sourceRevision = revision ?? '';
    this.cachedUntil = Date.now() + 30_000;
    if (fingerprint !== this.fingerprint) { this.fingerprint = fingerprint; this.deps.onChanged(); }
    return [...next.values()].map(binding => binding.tool);
  }

  hasBinding(name: string): boolean { return this.bindings.has(name); }

  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult | undefined> {
    if (this.disposed || !this.deps.trusted()) return undefined;
    const binding = this.bindings.get(name);
    if (!binding) return undefined;
    // Do not wait for a poller: another window may have revoked this source moments ago.
    try { if (this.deps.revision && this.deps.revision() !== this.sourceRevision) { await this.stopAll(); return undefined; } }
    catch { await this.stopAll(); return undefined; }
    const state = this.states.get(binding.serverId);
    if (!state?.connection || state.controller.signal.aborted || state.active >= 2) {
      return { isError: true, content: [{ type: 'text', text: '上游连接已断开或并发已满，请稍后重试。' }] };
    }
    state.active++;
    try {
      const callMs = externalMcpTimeoutMs(state.config, 'call');
      const result = await deadline(state.connection.call(binding.upstreamName, args, timeoutSignal(signal ? AbortSignal.any([signal, state.controller.signal]) : state.controller.signal, callMs)), callMs + 200);
      // A peer may ignore cancellation and complete after another window disables
      // the server or the workspace loses trust. Do not disclose that late result.
      let revisionUnchanged = false;
      try { revisionUnchanged = !this.deps.revision || this.deps.revision() === this.sourceRevision; }
      catch { /* Fail closed if the catalog can no longer be read. */ }
      if (this.disposed || !this.deps.trusted() || state.controller.signal.aborted ||
        this.bindings.get(name) !== binding || !revisionUnchanged) {
        await this.stopAll();
        return { isError: true, content: [{ type: 'text', text: '上游权限已撤销，本次结果未转发。' }] };
      }
      if (JSON.stringify(result).length > MAX_RESULT_BYTES) return { isError: true, content: [{ type: 'text', text: '上游结果超过 1 MB，未转发。' }] };
      return result;
    } catch (error) {
      if (!signal?.aborted) { this.invalidate(); void this.discard(binding.serverId); }
      return { isError: true, content: [{ type: 'text', text: safeError(error) }] };
    } finally { state.active--; }
  }
}
