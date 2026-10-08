import { validateExternalMcpUrl } from '../../../src/external-mcp-import.js';
import type { ExternalMcpCatalog, StoredExternalMcpServer } from './external-mcp-catalog.js';
import { EXTERNAL_MCP_MAX_SECRET_FIELDS, validateSecretName, validateSecretValue, type ExternalMcpSecretKind } from './external-mcp-secret-fields.js';

/**
 * Managing the credentials of an imported server (R2 §6.1-4). The page learns names and counts only. Every change is
 * one catalog transaction: write the new key, update the JSON reference, delete the old key, then notify.
 * The address and the command stay what they were: 替换地址 keeps the origin, 替换参数 keeps the command.
 */
export interface ExternalMcpSecretRefs {
  id: string;
  transport: 'stdio' | 'http';
  headers: string[];
  env: string[];
  /** The stored address carries a query or a token-like path segment (it is kept whole as a secret). */
  urlHasCredential: boolean;
  argsCount: number;
  /** stdio: how the server reaches the network (R2 §7.3.3). */
  proxyMode?: 'inherit' | 'none' | 'custom';
}

function find(catalog: ExternalMcpCatalog, id: unknown): StoredExternalMcpServer {
  const server = typeof id === 'string' ? catalog.snapshot().servers.find(item => item.id === id) : undefined;
  if (!server) throw new Error('MCP 服务已变化，请刷新。');
  return server;
}

function refsOf(server: StoredExternalMcpServer, kind: ExternalMcpSecretKind): Record<string, string> {
  if (kind === 'header' && server.transport !== 'http') throw new Error('stdio 服务使用环境变量提供密钥，不支持 Header。');
  if (kind === 'env' && server.transport !== 'stdio') throw new Error('HTTP 服务使用 Header 提供密钥，不支持环境变量。');
  return { ...((kind === 'header' ? server.headerRefs : server.envRefs) ?? {}) };
}

function setRefs(server: StoredExternalMcpServer, kind: ExternalMcpSecretKind, refs: Record<string, string>): void {
  const value = Object.keys(refs).length ? refs : undefined;
  if (kind === 'header') { if (value) server.headerRefs = value; else delete server.headerRefs; }
  else if (value) server.envRefs = value; else delete server.envRefs;
}

const sameName = (kind: ExternalMcpSecretKind, a: string, b: string): boolean => kind === 'header' ? a.toLowerCase() === b.toLowerCase() : a === b;

export async function getSecretRefs(catalog: ExternalMcpCatalog, id: unknown): Promise<ExternalMcpSecretRefs> {
  const server = find(catalog, id);
  let urlHasCredential = false, argsCount = 0;
  if (server.transport === 'http' && server.urlRef) {
    try {
      const url = new URL(await catalog.readSecret(server, server.urlRef));
      urlHasCredential = url.search !== '' || url.pathname.split('/').some(part => /^[A-Za-z0-9_-]{20,}$/.test(part));
    } catch { /* unreadable: the list reports the broken reference */ }
  }
  if (server.transport === 'stdio' && server.argsRef) {
    try { const args: unknown = JSON.parse(await catalog.readSecret(server, server.argsRef)); argsCount = Array.isArray(args) ? args.length : 0; } catch { /* reported by the list */ }
  }
  return { id: server.id, transport: server.transport, headers: Object.keys(server.headerRefs ?? {}), env: Object.keys(server.envRefs ?? {}), urlHasCredential, argsCount,
    ...(server.transport === 'stdio' ? { proxyMode: server.proxyMode ?? 'inherit' } : {}) };
}

export async function setSecret(catalog: ExternalMcpCatalog, id: unknown, kind: unknown, name: unknown, value: unknown): Promise<void> {
  if (kind !== 'header' && kind !== 'env') throw new Error('密钥类型只能是 header 或 env。');
  const field = validateSecretName(kind, name), secret = validateSecretValue(kind, value);
  await catalog.updateServer(find(catalog, id).id, async (server, store) => {
    if (server.authType === 'oauth' && kind === 'header' && field.toLowerCase() === 'authorization') throw new Error('OAuth 管理 Authorization；可添加其他请求头。');
    const refs = refsOf(server, kind);
    const existing = Object.keys(refs).find(key => sameName(kind, key, field));
    if (!existing && Object.keys(refs).length >= EXTERNAL_MCP_MAX_SECRET_FIELDS) throw new Error(`每个服务最多 ${EXTERNAL_MCP_MAX_SECRET_FIELDS} 项密钥。`);
    const obsolete = existing ? [refs[existing]!] : [];
    if (existing) delete refs[existing];
    refs[field] = await store(secret);
    setRefs(server, kind, refs);
    return obsolete;
  });
}

export async function clearSecret(catalog: ExternalMcpCatalog, id: unknown, kind: unknown, name: unknown): Promise<void> {
  if (kind !== 'header' && kind !== 'env') throw new Error('密钥类型只能是 header 或 env。');
  if (typeof name !== 'string') throw new Error('密钥名称无效。');
  await catalog.updateServer(find(catalog, id).id, async server => {
    const refs = refsOf(server, kind);
    const existing = Object.keys(refs).find(key => sameName(kind, key, name));
    if (!existing) throw new Error('该密钥已不存在，请刷新。');
    const obsolete = [refs[existing]!];
    delete refs[existing];
    setRefs(server, kind, refs);
    return obsolete;
  });
}

/** Header and env credentials only: the address and the arguments stay, or the server would stop working. */
export async function clearAllSecrets(catalog: ExternalMcpCatalog, id: unknown): Promise<void> {
  await catalog.updateServer(find(catalog, id).id, async server => {
    const obsolete = [...Object.values(server.headerRefs ?? {}), ...Object.values(server.envRefs ?? {})];
    delete server.headerRefs; delete server.envRefs;
    return obsolete;
  });
}

/** stdio proxy choice; a custom proxy URL may carry credentials and is therefore stored as a secret. */
export async function setProxyMode(catalog: ExternalMcpCatalog, id: unknown, mode: unknown, proxy?: unknown): Promise<void> {
  if (mode !== 'inherit' && mode !== 'none' && mode !== 'custom') throw new Error('网络代理选项只能是 inherit、none 或 custom。');
  let url: string | undefined;
  if (mode === 'custom') {
    try { const parsed = new URL(String(proxy ?? '').trim()); if (!['http:', 'https:', 'socks:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('scheme'); url = String(proxy).trim().replace(/\/$/, ''); }
    catch { throw new Error('代理地址须为 http://、https:// 或 socks5:// 开头的完整地址。'); }
  }
  await catalog.updateServer(find(catalog, id).id, async (server, store) => {
    if (server.transport !== 'stdio') throw new Error('只有 stdio 服务可以单独设置网络代理；HTTP 服务使用 ShunCode 的网络设置。');
    const obsolete = server.proxyRef ? [server.proxyRef] : [];
    if (mode === 'inherit') delete server.proxyMode; else server.proxyMode = mode;
    if (url) server.proxyRef = await store(url); else delete server.proxyRef;
    return obsolete;
  });
}

export async function replaceUrl(catalog: ExternalMcpCatalog, id: unknown, value: unknown): Promise<void> {
  if (typeof value !== 'string') throw new Error('请输入新的完整地址。');
  const next = validateExternalMcpUrl(value);
  await catalog.updateServer(find(catalog, id).id, async (server, store) => {
    if (server.transport !== 'http' || !server.urlRef) throw new Error('只有 HTTP 服务可以替换地址。');
    const current = new URL(await catalog.readSecret(server, server.urlRef));
    if (current.origin !== next.origin) throw new Error(`新地址必须仍是 ${current.origin}；要连接其他服务，请删除后重新导入。`);
    const obsolete = [server.urlRef];
    server.urlRef = await store(next.toString());
    return obsolete;
  });
}

export async function replaceArgs(catalog: ExternalMcpCatalog, id: unknown, args: unknown): Promise<void> {
  if (!Array.isArray(args) || args.length > 64 || args.some(arg => typeof arg !== 'string' || !arg || arg.length > 4096 || /[\r\n\0]/.test(arg) || arg.includes('${'))) {
    throw new Error('参数须为最多 64 项、每项不超过 4096 个字符的非空字符串，且不含换行或变量引用。');
  }
  await catalog.updateServer(find(catalog, id).id, async (server, store) => {
    if (server.transport !== 'stdio') throw new Error('只有 stdio 服务可以替换参数。');
    const obsolete = server.argsRef ? [server.argsRef] : [];
    if (args.length) server.argsRef = await store(JSON.stringify(args)); else delete server.argsRef;
    return obsolete;
  });
}
