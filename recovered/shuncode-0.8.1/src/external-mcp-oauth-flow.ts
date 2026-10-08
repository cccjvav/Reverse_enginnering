import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { auth, refreshAuthorization, extractWWWAuthenticateParams, type OAuthClientProvider } from '@modelcontextprotocol/client';
import { EXTERNAL_MCP_OAUTH_PATH, EXTERNAL_MCP_OAUTH_PORT, type ExternalMcpOAuthOptions } from '../../../src/external-mcp-oauth-config.js';

export type OAuthTokens = Parameters<OAuthClientProvider['saveTokens']>[0];
type OAuthClient = NonNullable<Awaited<ReturnType<OAuthClientProvider['clientInformation']>>>;
type OAuthDiscovery = Parameters<NonNullable<OAuthClientProvider['saveDiscoveryState']>>[0];
export interface ExternalMcpOAuthState {
  clientSecret?: string;
  client?: OAuthClient;
  tokens?: OAuthTokens;
  discovery?: OAuthDiscovery;
  expiresAt?: number;
  redirectUri?: string;
  resource?: string;
  /** Resource indicator validated by the SDK during the explicit authorization. */
  resourceIndicator?: string;
}
export interface OAuthFlowDeps {
  fetch?: typeof fetch;
  openAuthorization(url: URL, resource: URL): Promise<boolean>;
  signal?: AbortSignal;
  /** Test seam only; user-facing ports are validated public configuration. */
  callbackPort?: number;
  httpTransport?: 'auto' | 'streamable-http' | 'sse';
  timeoutMs?: number;
  now?: () => number;
}
export class OAuthActionError extends Error {
  constructor(message: string, readonly status = 401, readonly code = 'OAUTH_REQUIRED') { super(message); this.name = 'OAuthActionError'; }
}
export const oauthRequired = () => new OAuthActionError('请在 MCP 服务列表中点击「OAuth 授权」，完成浏览器登录。');

export function decodeOAuthState(raw: string): ExternalMcpOAuthState {
  try {
    if (raw.length > 128_000) throw new Error();
    const state: ExternalMcpOAuthState = JSON.parse(raw);
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error();
    if (state.tokens && (typeof state.tokens.access_token !== 'string' || !state.tokens.access_token || /[\r\n\0]/.test(state.tokens.access_token))) throw new Error();
    return state;
  } catch { throw new OAuthActionError('OAuth 安全存储状态无效，请重新配置并授权。'); }
}

/** OAuth endpoints are TLS-only, except loopback development servers. Never permit embedded credentials or redirects. */
export function oauthEndpoint(value: string | URL): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new OAuthActionError('OAuth 端点地址无效。'); }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw new OAuthActionError('OAuth 端点必须使用 HTTPS（本机回环地址除外），且不得包含用户名、密码或片段。');
  return url;
}

/** Discovery/token traffic has no MCP custom headers. Bound response size, time and redirects, including error bodies. */
export function oauthFetch(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): typeof fetch {
  return async (input, init) => {
    const url = oauthEndpoint(input instanceof Request ? input.url : String(input));
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : []), ...(init?.signal ? [init.signal] : [])]) });
    if (response.status >= 300 && response.status < 400) throw new OAuthActionError('OAuth 端点不允许 HTTP 重定向。');
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > 128_000) { await reader.cancel(); throw new OAuthActionError('OAuth 响应超过安全大小限制。'); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

/** No upstream error body, URL, code, verifier, token or client secret is exposed through error messages. */
export function safeOAuthError(error: unknown): OAuthActionError {
  if (error instanceof OAuthActionError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (['invalid_grant', 'invalid_client', 'unauthorized_client', 'access_denied'].includes(String(code))) return oauthRequired();
  const name = error instanceof Error ? error.name : '';
  if (/Issuer|AuthorizationServerMismatch|InsecureToken|InvalidResource/.test(name)) return new OAuthActionError('OAuth 安全验证未通过，请检查认证服务并重新授权。');
  if (/Registration/.test(name)) return new OAuthActionError('OAuth 客户端注册失败；如服务不支持自动注册，请填写其提供的 Client ID。');
  return new OAuthActionError('OAuth 认证服务暂时不可用或响应无效，请检查网络后重试。', 503, 'OAUTH_UNAVAILABLE');
}

export async function openOAuthCallback(port: number, state: string, signal?: AbortSignal, timeoutMs = 300_000): Promise<{ redirectUri: string; result: Promise<{ code: string; iss?: string }>; close(): void }> {
  let complete!: (value: { code: string; iss?: string }) => void;
  let fail!: (error: Error) => void;
  let settled = false;
  const result = new Promise<{ code: string; iss?: string }>((resolve, reject) => { complete = resolve; fail = reject; });
  // The browser can return while discovery/openExternal is still being awaited; retain, never lose, that result.
  void result.catch(() => undefined);
  let redirectUri = '';
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const reply = (status: number, text: string) => { response.writeHead(status); response.end(`<!doctype html><meta charset="utf-8"><title>ShunCode OAuth</title><p>${text}</p>`); };
    let url: URL;
    try {
      if (!redirectUri || !request.url || request.url.length > 16_384) throw new Error();
      url = new URL(request.url, redirectUri);
    } catch { reply(400, '无效的回调请求。'); return; }
    if (request.method !== 'GET' || request.headers.host !== new URL(redirectUri).host || url.origin !== new URL(redirectUri).origin || url.pathname !== EXTERNAL_MCP_OAUTH_PATH) { reply(404, '无效的回调地址。'); return; }
    const supplied = url.searchParams.getAll('state');
    if (supplied.length !== 1 || Buffer.byteLength(supplied[0]) !== Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(supplied[0]), Buffer.from(state))) { reply(400, '授权校验失败，请返回 ShunCode 重试。'); return; }
    if (settled) { reply(410, '此授权回调已处理。'); return; }
    const codes = url.searchParams.getAll('code'), errors = url.searchParams.getAll('error'), issuers = url.searchParams.getAll('iss');
    if (codes.length > 1 || errors.length > 1 || issuers.length > 1 || (codes.length && errors.length)) { reply(400, '回调参数无效。'); return; }
    if (errors.length) {
      settled = true; reply(200, '授权未完成，可以关闭此页面并返回 ShunCode。'); fail(new OAuthActionError('用户未授予 OAuth 权限，配置已保留，可稍后重试。', 401, 'OAUTH_CANCELLED')); return;
    }
    if (codes.length !== 1 || !codes[0] || codes[0].length > 8192) { reply(400, '回调缺少有效授权码。'); return; }
    settled = true;
    reply(200, '授权回调已收到，请返回 ShunCode 查看结果。');
    complete({ code: codes[0], ...(issuers.length ? { iss: issuers[0] } : {}) });
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  } catch { server.close(); throw new OAuthActionError('OAuth 本机回调端口不可用；请先结束其他授权窗口，或调整回调端口后重试。', 409, 'OAUTH_PORT_BUSY'); }
  const address = server.address();
  if (!address || typeof address === 'string') throw new OAuthActionError('无法建立 OAuth 本机回调。');
  redirectUri = `http://127.0.0.1:${address.port}${EXTERNAL_MCP_OAUTH_PATH}`;
  const abort = () => { if (!settled) { settled = true; fail(new OAuthActionError('OAuth 授权已取消，配置已保留。', 401, 'OAUTH_CANCELLED')); } server.closeAllConnections(); server.close(); };
  const timer = setTimeout(() => { if (!settled) { settled = true; fail(new OAuthActionError('OAuth 授权等待超时，请重新发起。', 401, 'OAUTH_TIMEOUT')); } server.closeAllConnections(); server.close(); }, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  return { redirectUri, result, close: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); abort(); } };
}

/** SDK owns metadata/issuer/resource validation, DCR, S256 PKCE, token authentication and refresh-token rotation. */
function providerFor(record: ExternalMcpOAuthState, options: ExternalMcpOAuthOptions, redirectUri: string, state: string,
  redirect: (url: URL) => Promise<void>, now: () => number): OAuthClientProvider {
  let verifier: string | undefined;
  return {
    redirectUrl: redirectUri,
    clientMetadata: { client_name: 'ShunCode', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], application_type: 'native', token_endpoint_auth_method: record.clientSecret ? 'client_secret_basic' : 'none', ...(options.scope ? { scope: options.scope } : {}) },
    state: () => state,
    clientInformation: ctx => options.clientId ? { client_id: options.clientId, ...(record.clientSecret ? { client_secret: record.clientSecret } : {}), ...(ctx?.issuer ? { issuer: ctx.issuer } : {}) }
      : record.client && (!ctx || record.client.issuer === ctx.issuer) ? record.client : undefined,
    saveClientInformation: client => { record.client = client; },
    tokens: ctx => record.tokens && (!ctx || record.tokens.issuer === ctx.issuer) ? record.tokens : undefined,
    saveTokens: tokens => {
      if (tokens.token_type.toLowerCase() !== 'bearer' || !tokens.access_token || /[\r\n\0]/.test(tokens.access_token) || (tokens.expires_in !== undefined && (!Number.isFinite(tokens.expires_in) || tokens.expires_in < 0))) throw new OAuthActionError('OAuth 令牌格式无效。');
      const previous = record.tokens;
      record.tokens = { ...tokens, ...(!tokens.refresh_token && previous?.refresh_token ? { refresh_token: previous.refresh_token } : {}) };
      record.expiresAt = typeof tokens.expires_in === 'number' ? now() + tokens.expires_in * 1000 : undefined;
    },
    saveCodeVerifier: value => { verifier = value; },
    codeVerifier: () => { if (!verifier) throw oauthRequired(); return verifier; },
    redirectToAuthorization: redirect,
    saveResourceUrl: value => { record.resourceIndicator = value; },
    saveDiscoveryState: value => {
      const metadata = value.authorizationServerMetadata;
      if (!options.clientId && metadata && !metadata.registration_endpoint && record.client?.issuer !== metadata.issuer) throw new OAuthActionError('此服务不支持自动客户端注册，请在 OAuth 设置中填写服务提供的 Client ID。', 401, 'OAUTH_CLIENT_REQUIRED');
      record.discovery = value;
    },
    discoveryState: () => record.discovery,
    invalidateCredentials: kind => {
      if (kind === 'client' || kind === 'all') record.client = undefined;
      if (kind === 'tokens' || kind === 'all') { record.tokens = undefined; record.expiresAt = undefined; }
      if (kind === 'discovery' || kind === 'all') record.discovery = undefined;
      if (kind === 'verifier' || kind === 'all') verifier = undefined;
    },
  };
}

export async function authorizeExternalMcp(record: ExternalMcpOAuthState, options: ExternalMcpOAuthOptions, resource: string, headers: Record<string, string> | undefined, deps: OAuthFlowDeps): Promise<ExternalMcpOAuthState> {
  const state = randomBytes(32).toString('base64url');
  const callback = await openOAuthCallback(deps.callbackPort ?? options.redirectPort ?? EXTERNAL_MCP_OAUTH_PORT, state, deps.signal, deps.timeoutMs);
  const fetchImpl = deps.fetch ?? fetch;
  const boundedFetch = oauthFetch(fetchImpl, deps.signal);
  const next = structuredClone(record);
  next.tokens = undefined; next.expiresAt = undefined; next.discovery = undefined;
  if (!options.clientId && next.redirectUri !== callback.redirectUri) next.client = undefined;
  next.resource = resource; next.redirectUri = callback.redirectUri;
  try {
    const serverUrl = oauthEndpoint(resource);
    // Headers go only to the exact MCP endpoint, never to an authorization server or its discovery documents.
    const probe = (method: 'GET' | 'POST') => fetchImpl(serverUrl, { method, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(deps.signal ? [deps.signal] : [])]),
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
      ...(method === 'POST' ? { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ShunCode OAuth', version: '1' } } }) } : {}) });
    let challenge = await probe(deps.httpTransport === 'sse' ? 'GET' : 'POST');
    if (deps.httpTransport === 'auto' && [400, 404, 405, 406, 415].includes(challenge.status)) {
      await challenge.body?.cancel().catch(() => undefined); challenge = await probe('GET');
    }
    const discovered = challenge.status === 401 ? extractWWWAuthenticateParams(challenge) : {};
    await challenge.body?.cancel().catch(() => undefined);
    const provider = providerFor(next, options, callback.redirectUri, state, async url => {
      oauthEndpoint(url);
      if (url.searchParams.get('state') !== state || url.searchParams.get('code_challenge_method') !== 'S256' || !url.searchParams.get('code_challenge') || url.searchParams.get('redirect_uri') !== callback.redirectUri) throw new OAuthActionError('OAuth PKCE/回调校验失败。');
      if (deps.signal?.aborted || !(await deps.openAuthorization(url, serverUrl))) throw new OAuthActionError('OAuth 授权已取消，配置已保留。', 401, 'OAUTH_CANCELLED');
    }, deps.now ?? Date.now);
    const parameters = { serverUrl, fetchFn: boundedFetch, scope: options.scope ?? discovered.scope, resourceMetadataUrl: discovered.resourceMetadataUrl };
    if (await auth(provider, { ...parameters, forceReauthorization: true }) !== 'REDIRECT') throw new OAuthActionError('OAuth 服务未提供浏览器授权流程。');
    const response = await callback.result;
    if (deps.signal?.aborted) throw new OAuthActionError('OAuth 授权已取消。', 401, 'OAUTH_CANCELLED');
    if (await auth(provider, { ...parameters, authorizationCode: response.code, iss: response.iss }) !== 'AUTHORIZED' || !next.tokens) throw oauthRequired();
    return next;
  } catch (error) {
    if (deps.signal?.aborted) throw new OAuthActionError('OAuth 授权已取消，配置已保留。', 401, 'OAUTH_CANCELLED');
    throw safeOAuthError(error);
  } finally { callback.close(); }
}

export async function refreshExternalMcpOAuth(record: ExternalMcpOAuthState, options: ExternalMcpOAuthOptions, resource: string, deps: Pick<OAuthFlowDeps, 'fetch' | 'signal' | 'now'>): Promise<void> {
  // Do not use auth() here: it can register a new client or turn a transient refresh error into a browser redirect.
  // All discovery, issuer and resource binding below was validated by the SDK in an explicit login and stored encrypted.
  const discovery = record.discovery;
  const issuer = discovery?.authorizationServerMetadata?.issuer ?? discovery?.authorizationServerUrl;
  if (!record.tokens?.refresh_token || !record.redirectUri || record.resource !== resource || !issuer || !discovery?.authorizationServerUrl || record.tokens.issuer !== issuer) throw oauthRequired();
  const clientInformation = options.clientId
    ? { client_id: options.clientId, ...(record.clientSecret ? { client_secret: record.clientSecret } : {}), issuer }
    : record.client;
  if (!clientInformation || clientInformation.issuer !== issuer) throw oauthRequired();
  const provider = providerFor(record, options, record.redirectUri, '', async () => { throw oauthRequired(); }, deps.now ?? Date.now);
  try {
    const tokens = await refreshAuthorization(discovery.authorizationServerUrl, {
      metadata: discovery.authorizationServerMetadata, clientInformation,
      refreshToken: record.tokens.refresh_token, resource: new URL(record.resourceIndicator ?? resource),
      fetchFn: oauthFetch(deps.fetch, deps.signal),
    });
    await provider.saveTokens({ ...tokens, issuer }, { issuer });
  } catch (error) {
    if (deps.signal?.aborted) throw new OAuthActionError('OAuth 请求已取消。', 401, 'OAUTH_CANCELLED');
    throw safeOAuthError(error);
  }
}
