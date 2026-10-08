/**
 * Credential fields a user adds to a shared MCP server (R2 §6.1). The UI only ever sees names; values travel once,
 * from a password field to SecretStorage, and are never echoed, logged or written to the user catalog JSON.
 */
export type ExternalMcpSecretKind = 'header' | 'env';
export interface ExternalMcpEntrySecrets { bearer?: string; headers?: Record<string, string>; env?: Record<string, string>; oauthClientSecret?: string }
export interface NormalizedEntrySecrets { headers?: Record<string, string>; env?: Record<string, string>; oauthClientSecret?: string }

export const EXTERNAL_MCP_MAX_SECRET_FIELDS = 40;
export const EXTERNAL_MCP_MAX_SECRET_VALUE = 4096;
/** Transport- and ShunCode-owned headers: a user value would break the session or leak to a proxy. */
export const EXTERNAL_MCP_RESERVED_HEADERS: readonly string[] = ['Host', 'Content-Length', 'Transfer-Encoding', 'Connection', 'Mcp-Session-Id',
  'MCP-Protocol-Version', 'Proxy-Authorization', 'X-ShunCode-Managed-Streamable-HTTP', 'X-ShunCode-MCP-Timeout-MS', 'X-ShunCode-MCP-OAuth'];
const RESERVED = new Set(EXTERNAL_MCP_RESERVED_HEADERS.map(name => name.toLowerCase()));
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const PLAIN = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function validateSecretName(kind: ExternalMcpSecretKind, name: unknown): string {
  if (typeof name !== 'string' || !name || name.length > 100) throw new Error(kind === 'header' ? 'Header 名称无效。' : '环境变量名称无效。');
  if (kind === 'header') {
    if (!HEADER_NAME.test(name)) throw new Error(`Header 名称「${name.slice(0, 40)}」只能包含字母、数字、- 和 _，并以字母开头。`);
    if (RESERVED.has(name.toLowerCase())) throw new Error(`Header「${name}」由连接本身使用，不能设置为密钥。`);
  } else {
    if (!ENV_NAME.test(name)) throw new Error(`环境变量名「${name.slice(0, 40)}」只能包含字母、数字和 _，且不能以数字开头。`);
    if (['SHUNCODE_MCP_MANAGED', 'SHUNCODE_MCP_TIMEOUT_MS'].includes(name.toUpperCase())) throw new Error('该环境变量由 ShunCode 内部使用。');
  }
  return name;
}

export function validateSecretValue(kind: ExternalMcpSecretKind, value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('请填写密钥值。');
  if (value.length > EXTERNAL_MCP_MAX_SECRET_VALUE) throw new Error(`密钥值超过 ${EXTERNAL_MCP_MAX_SECRET_VALUE} 个字符。`);
  if (value.includes('${')) throw new Error('密钥值包含尚未解析的变量引用；请填写实际值。');
  if (kind === 'header' ? /[\r\n\0]/.test(value) : value.includes('\0')) throw new Error('密钥值包含换行或空字符。');
  return value;
}

function fields(kind: ExternalMcpSecretKind, value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!PLAIN(value)) throw new Error(kind === 'header' ? 'Header 密钥格式无效。' : '环境变量密钥格式无效。');
  const result: Record<string, string> = Object.create(null);
  for (const [name, entry] of Object.entries(value)) {
    if (entry === '' || entry === undefined) continue;   // left blank: can be filled in later from the list
    result[validateSecretName(kind, name)] = validateSecretValue(kind, entry);
  }
  if (Object.keys(result).length > EXTERNAL_MCP_MAX_SECRET_FIELDS) throw new Error(`每个服务最多 ${EXTERNAL_MCP_MAX_SECRET_FIELDS} 项密钥。`);
  return Object.keys(result).length ? result : undefined;
}

/** Validates the `secrets` argument of shuncode.mcp.import against the selected entries of the preview. */
export function normalizeImportSecrets(raw: unknown, entries: readonly { id: string; transport: 'stdio' | 'http'; authType?: 'oauth'; oauth?: { clientId?: string } }[]): Map<string, NormalizedEntrySecrets> {
  const result = new Map<string, NormalizedEntrySecrets>();
  if (raw === undefined || raw === null) return result;
  if (!PLAIN(raw)) throw new Error('密钥参数格式无效。');
  for (const [id, value] of Object.entries(raw)) {
    const entry = entries.find(item => item.id === id);
    if (!entry) throw new Error('密钥只能提交给本次勾选的服务。');
    if (!PLAIN(value)) throw new Error('密钥参数格式无效。');
    const { bearer, headers, env, oauthClientSecret, ...rest } = value as ExternalMcpEntrySecrets & Record<string, unknown>;
    if (Object.keys(rest).length) throw new Error('密钥参数包含未知字段。');
    if (entry.transport === 'http' && env !== undefined) throw new Error('HTTP 服务使用 Header 提供密钥，不支持环境变量。');
    if (entry.transport === 'stdio' && (headers !== undefined || (bearer !== undefined && bearer !== ''))) throw new Error('stdio 服务使用环境变量提供密钥，不支持 Header。');
    const normalized: NormalizedEntrySecrets = {};
    const headerValues = fields('header', headers);
    if (entry.authType === 'oauth' && (bearer || Object.keys(headerValues ?? {}).some(key => key.toLowerCase() === 'authorization'))) throw new Error('OAuth 与 Bearer/Authorization 不能同时使用。');
    if (oauthClientSecret !== undefined && oauthClientSecret !== '') {
      if (entry.authType !== 'oauth' || !entry.oauth?.clientId) throw new Error('OAuth Client Secret 需要 OAuth 模式及 Client ID。');
      normalized.oauthClientSecret = validateSecretValue('header', oauthClientSecret);
    }
    if (bearer !== undefined && bearer !== '') {
      if (headerValues && Object.keys(headerValues).some(name => name.toLowerCase() === 'authorization')) throw new Error('Bearer 令牌与自定义 Authorization Header 只能选一种。');
      const token = validateSecretValue('header', bearer);
      if (/\s/.test(token)) throw new Error('Bearer 令牌不能包含空白字符。');
      normalized.headers = { ...(headerValues ?? {}), Authorization: `Bearer ${token}` };
    } else if (headerValues) normalized.headers = headerValues;
    const envValues = fields('env', env);
    if (envValues) normalized.env = envValues;
    if (normalized.headers || normalized.env || normalized.oauthClientSecret) result.set(id, normalized);
  }
  return result;
}

/** User input wins over the pasted JSON; header names compare case-insensitively, env names exactly. */
export function mergeSecretFields(kind: ExternalMcpSecretKind, fromJson: Record<string, string> | undefined, fromUser: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!fromUser) return fromJson;
  const merged: Record<string, string> = Object.create(null);
  const overridden = new Set(Object.keys(fromUser).map(name => kind === 'header' ? name.toLowerCase() : name));
  for (const [name, value] of Object.entries(fromJson ?? {})) if (!overridden.has(kind === 'header' ? name.toLowerCase() : name)) merged[name] = value;
  for (const [name, value] of Object.entries(fromUser)) merged[name] = value;
  if (Object.keys(merged).length > EXTERNAL_MCP_MAX_SECRET_FIELDS) throw new Error(`每个服务最多 ${EXTERNAL_MCP_MAX_SECRET_FIELDS} 项密钥。`);
  return merged;
}
