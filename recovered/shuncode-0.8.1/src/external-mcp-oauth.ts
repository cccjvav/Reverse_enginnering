import { createHash, randomBytes } from 'node:crypto';
import type { ExternalMcpOAuthOptions } from '../../../src/external-mcp-oauth-config.js';
import { type ExternalMcpRuntimeOAuth, ExternalMcpCatalog, type StoredExternalMcpServer } from './external-mcp-catalog.js';
import { authorizeExternalMcp, decodeOAuthState, refreshExternalMcpOAuth, oauthRequired, OAuthActionError, type OAuthFlowDeps } from './external-mcp-oauth-flow.js';

export type ExternalMcpOAuthStatus = 'needs-auth' | 'authorizing' | 'authorized';
export interface ExternalMcpOAuthDeps extends Omit<OAuthFlowDeps, 'signal'> { trusted(): boolean; changed?(): void }
type Surface = 'bridge' | 'editor' | 'either';
interface Handle { id: string; reference: string; resource: string }
const stamp = (token: string) => createHash('sha256').update(token).digest('hex');

/** One encrypted credential set per service, shared by editor and Bridge; only explicit local commands may open a browser. */
export class ExternalMcpOAuth {
  private readonly active = new Map<string, { controller: AbortController; reference: string; urlRef?: string }>();
  private readonly handles = new Map<string, Handle>();
  private disposed = false;
  constructor(private readonly catalog: ExternalMcpCatalog, private readonly deps: ExternalMcpOAuthDeps) {
    catalog.setOAuthProvider(server => this.runtime(server));
  }

  private current(id: string, reference?: string, surface: Surface = 'either'): StoredExternalMcpServer {
    if (this.disposed || !this.deps.trusted()) throw new OAuthActionError('受限工作区不会读取或使用 OAuth 凭据。');
    const server = this.catalog.snapshot().servers.find(item => item.id === id);
    if (!server || !server.enabled || server.authType !== 'oauth' || !server.oauthRef || (reference && reference !== server.oauthRef)
      || (surface === 'editor' && !server.editorEnabled) || (surface === 'bridge' && !server.bridgeEnabled) || (!server.editorEnabled && !server.bridgeEnabled)) throw oauthRequired();
    return server;
  }
  private async resource(server: StoredExternalMcpServer): Promise<string> {
    if (!server.urlRef) throw oauthRequired();
    return new URL(await this.catalog.readSecret(server, server.urlRef)).toString();
  }

  runtime(server: StoredExternalMcpServer): ExternalMcpRuntimeOAuth {
    const reference = server.oauthRef ?? '';
    return { key: reference, token: staleStamp => this.token(server.id, reference, 'bridge', staleStamp) };
  }

  /** The unguessable handle is never catalog metadata or a discoverable definition; it is stripped before HTTP. */
  async issueEditorHandle(server: StoredExternalMcpServer): Promise<string> {
    this.current(server.id, server.oauthRef, 'editor');
    const resource = await this.resource(server);
    for (const [handle, entry] of this.handles) {
      if (entry.id !== server.id) continue;
      if (entry.reference === server.oauthRef && entry.resource === resource) return handle;
      this.handles.delete(handle);
    }
    if (this.handles.size >= 64) this.handles.delete(this.handles.keys().next().value!);
    const handle = randomBytes(32).toString('base64url');
    this.handles.set(handle, { id: server.id, reference: server.oauthRef!, resource });
    return handle;
  }
  async editorToken(handle: unknown, resource: unknown, staleStamp?: unknown): Promise<{ token: string; stamp: string }> {
    if (typeof handle !== 'string' || handle.length !== 43 || typeof resource !== 'string' || resource.length > 8192 || (staleStamp !== undefined && (typeof staleStamp !== 'string' || !/^[0-9a-f]{64}$/.test(staleStamp)))) throw oauthRequired();
    const binding = this.handles.get(handle);
    let canonical: string;
    try { canonical = new URL(resource).toString(); } catch { throw oauthRequired(); }
    if (!binding || canonical !== binding.resource) throw oauthRequired();
    const server = this.current(binding.id, binding.reference, 'editor');
    if (await this.resource(server) !== binding.resource) throw oauthRequired();
    return this.token(binding.id, binding.reference, 'editor', staleStamp as string | undefined);
  }

  /** The shared file lock serializes refresh-token rotation across windows, not only concurrent calls in this process. */
  private async token(id: string, reference: string, surface: Surface, staleStamp?: string): Promise<{ token: string; stamp: string }> {
    this.current(id, reference, surface);
    return this.catalog.withOAuthState(id, reference, async (raw, server, save) => {
      this.current(id, reference, surface);
      const record = decodeOAuthState(raw);
      const resource = await this.resource(server);
      if (!record.tokens || record.resource !== resource) throw oauthRequired();
      const now = this.deps.now?.() ?? Date.now();
      const lead = Math.min(30_000, Math.max(0, (record.tokens.expires_in ?? 300) * 100));
      const expired = record.expiresAt !== undefined && record.expiresAt <= now;
      const due = !!record.tokens.refresh_token && record.expiresAt !== undefined && record.expiresAt <= now + lead;
      const rejected = staleStamp !== undefined && staleStamp === stamp(record.tokens.access_token);
      if (expired || due || rejected) {
        try {
          await refreshExternalMcpOAuth(record, server.oauth ?? {}, resource, this.deps);
          this.current(id, reference, surface);
          await save(JSON.stringify(record)); // Do not change catalog revision during a successful tool call.
        } catch (error) {
          if (error instanceof OAuthActionError && error.status === 401) {
            record.tokens = undefined; record.expiresAt = undefined;
            await save(JSON.stringify(record)); this.deps.changed?.();
          }
          throw error;
        }
      }
      this.current(id, reference, surface);
      if (!record.tokens) throw oauthRequired();
      return { token: record.tokens.access_token, stamp: stamp(record.tokens.access_token) };
    });
  }

  async status(server: StoredExternalMcpServer): Promise<ExternalMcpOAuthStatus> {
    if (this.disposed || !this.deps.trusted()) return 'needs-auth';
    if (this.active.has(server.id)) return 'authorizing';
    try {
      if (!server.oauthRef) return 'needs-auth';
      const record = decodeOAuthState(await this.catalog.readSecret(server, server.oauthRef));
      const now = this.deps.now?.() ?? Date.now();
      return record.tokens && record.resource === await this.resource(server) && (record.expiresAt === undefined || record.expiresAt > now || !!record.tokens.refresh_token) ? 'authorized' : 'needs-auth';
    } catch { return 'needs-auth'; }
  }

  async authorize(id: string, parent?: AbortSignal): Promise<{ authorized: true }> {
    const server = this.current(id);
    if (this.active.has(id)) throw new OAuthActionError('此服务正在等待浏览器授权，请先完成或取消当前授权。', 409, 'OAUTH_BUSY');
    const controller = new AbortController();
    const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
    this.active.set(id, { controller, reference: server.oauthRef!, urlRef: server.urlRef }); this.deps.changed?.();
    try {
      const record = await this.catalog.withOAuthState(id, server.oauthRef, async raw => decodeOAuthState(raw));
      const runtime = await this.catalog.resolve(server);
      const next = await authorizeExternalMcp(record, server.oauth ?? {}, runtime.url!, runtime.headers, { ...this.deps, signal, httpTransport: runtime.httpTransport });
      if (signal.aborted) throw new OAuthActionError('OAuth 授权已取消。', 401, 'OAUTH_CANCELLED');
      this.current(id, server.oauthRef);
      await this.catalog.withOAuthState(id, server.oauthRef, async (_raw, _server, save) => {
        this.current(id, server.oauthRef);
        await save(JSON.stringify(next), true); // Explicit login creates a new authorization generation.
      });
      return { authorized: true };
    } finally { this.active.delete(id); this.deps.changed?.(); }
  }

  async logout(id: string): Promise<void> {
    if (!this.deps.trusted()) throw oauthRequired();
    this.cancel(id);
    const server = this.catalog.snapshot().servers.find(item => item.id === id);
    if (!server?.oauthRef) throw oauthRequired();
    await this.catalog.withOAuthState(id, server.oauthRef, async (raw, _server, save) => {
      const record = decodeOAuthState(raw);
      // This is local sign-out, not a claim that the authorization server's grant was revoked.
      await save(JSON.stringify({ ...(record.clientSecret ? { clientSecret: record.clientSecret } : {}) }), true);
    });
    for (const [handle, entry] of this.handles) if (entry.id === id) this.handles.delete(handle);
    this.deps.changed?.();
  }

  async configure(id: string, options: ExternalMcpOAuthOptions, clientSecret?: string): Promise<void> {
    if (!this.deps.trusted()) throw oauthRequired();
    this.cancel(id);
    await this.catalog.updateServer(id, async (server, store) => {
      if (server.transport !== 'http') throw new OAuthActionError('OAuth 仅适用于 HTTP/SSE 服务。');
      if (Object.keys(server.headerRefs ?? {}).some(key => key.toLowerCase() === 'authorization')) throw new OAuthActionError('请先在「密钥…」中移除 Authorization，再启用 OAuth。');
      const old = server.oauthRef;
      let previous: ReturnType<typeof decodeOAuthState> = {};
      try { if (old) previous = decodeOAuthState(await this.catalog.readSecret(server, old)); } catch { /* Explicit settings may repair a missing or corrupt vault entry. */ }
      const secret = clientSecret ?? (server.oauth?.clientId === options.clientId ? previous.clientSecret : undefined);
      server.authType = 'oauth'; server.oauth = options;
      server.oauthRef = await store(JSON.stringify({ ...(options.clientId && secret ? { clientSecret: secret } : {}) }));
      return old ? [old] : [];
    });
    this.deps.changed?.();
  }

  cancel(id: string): void { this.active.get(id)?.controller.abort(); }
  cancelAll(): void { for (const entry of this.active.values()) entry.controller.abort(); }
  cancelUnavailable(): void {
    for (const [id, active] of this.active) { try { if (this.current(id, active.reference).urlRef !== active.urlRef) this.cancel(id); } catch { this.cancel(id); } }
  }
  dispose(): void { this.disposed = true; this.cancelAll(); this.handles.clear(); }
}
