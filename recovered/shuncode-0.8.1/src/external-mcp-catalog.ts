import { createHash, randomUUID } from 'node:crypto';
import { accessSync, closeSync, constants as fsConstants, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { previewExternalMcpImport, validateExternalMcpId, validateExternalMcpUrl, externalMcpTimeout, type ExternalMcpDraft, type ExternalMcpHttpTransport, type ExternalMcpImportWarning } from '../../../src/external-mcp-import.js';
import type { ExternalMcpOAuthOptions } from '../../../src/external-mcp-oauth-config.js';
import { externalMcpPreviewToken } from './external-mcp-preview-token.js';
import { mergeSecretFields, normalizeImportSecrets } from './external-mcp-secret-fields.js';
import type { ExternalMcpRefState } from './external-mcp-status.js';
import { globalSkillsDirectory } from '../../../src/global-skill-paths.js';

/**
 * Where the user-level MCP server list lives.
 *
 * It sits next to the global Skills, because that directory is already the one
 * user-global ShunCode store an agent can discover (list_skills reports it) and
 * survives reinstalls. `~/.shuncode/external-mcp.json` stays supported as the
 * legacy location and is migrated on first use, so an existing setup is never
 * silently dropped. Secrets never live in either file: they stay in the OS
 * credential store and only their refs are written here.
 */
export const LEGACY_EXTERNAL_MCP_CONFIG_PATH = path.join(os.homedir(), '.shuncode', 'external-mcp.json');
export const EXTERNAL_MCP_CONFIG_FILENAME = 'external-mcp.json';

/**
 * The Skill directory can be a read-only, root-owned install path (a Linux DEB puts it under
 * /usr/share). Writing the server list there would fail at the first `add`, so the home copy
 * stays the fallback whenever the directory cannot be created or written by this user.
 */
function skillDirectoryIsUsable(directory: string): boolean {
  try {
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
    accessSync(directory, fsConstants.W_OK);
    return true;
  } catch { return false; }
}

export function defaultExternalMcpConfigPath(): string {
  let skills: string | undefined;
  try { skills = globalSkillsDirectory(); } catch { skills = undefined; }
  if (!skills) return LEGACY_EXTERNAL_MCP_CONFIG_PATH;
  const candidate = path.join(skills, EXTERNAL_MCP_CONFIG_FILENAME);
  if (existsSync(candidate)) return candidate;
  return skillDirectoryIsUsable(skills) ? candidate : LEGACY_EXTERNAL_MCP_CONFIG_PATH;
}

export interface ExternalMcpConfigLocations {
  configPath: string;
  configExists: boolean;
  skillsDirectory?: string;
  legacyPath: string;
  legacyExists: boolean;
  migratedFrom?: string;
  /** false when the Skill directory is read-only for this user, so the home fallback is in use. */
  skillDirectoryWritable?: boolean;
  secretStorage: string;
}

/** Maximum shared MCP servers saved and loaded by the Bridge. Single source of truth for the cap. */
export const MAX_EXTERNAL_MCP_SERVERS = 100;

export interface ExternalMcpSecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export interface ExternalMcpRuntimeOAuth { key: string; token(staleStamp?: string): Promise<{ token: string; stamp: string }> }

export interface StoredExternalMcpServer {
  authType?: 'oauth';
  oauth?: ExternalMcpOAuthOptions;
  oauthRef?: string;
  id: string;
  label: string;
  transport: 'stdio' | 'http';
  httpTransport?: ExternalMcpHttpTransport;
  description?: string;
  cwd?: string;
  /** Request/connection timeout in seconds. */
  timeout?: number;
  enabled: boolean;
  editorEnabled: boolean;
  bridgeEnabled: boolean;
  command?: string;
  args?: string[]; // legacy user config only; new imports store arguments in SecretStorage
  argsRef?: string;
  envRefs?: Record<string, string>;
  urlRef?: string;
  headerRefs?: Record<string, string>;
  /** stdio only (R2 §7.3.3): follow ShunCode's proxy (default), no proxy, or a custom proxy kept as a secret. */
  proxyMode?: 'inherit' | 'none' | 'custom';
  proxyRef?: string;
}
export interface ResolvedExternalMcpServer {
  oauth?: ExternalMcpRuntimeOAuth;
  id: string;
  label: string;
  transport: 'stdio' | 'http';
  httpTransport?: ExternalMcpHttpTransport;
  description?: string;
  cwd?: string;
  /** Request/connection timeout in seconds. */
  timeout?: number;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Network fingerprint (no credentials): part of the connection identity, so a network change reconnects. */
  network?: string;
  /** Why no proxy was passed to a stdio server although one is configured (credentials, PAC). */
  proxyNotice?: string;
}
/** Set by the center: the network decision both surfaces share (external-mcp-network.ts). */
export interface ExternalMcpNetworkProvider {
  fingerprint(): string;
  stdioEnv(mode: 'inherit' | 'none' | 'custom' | undefined, customProxy?: string): { env: Record<string, string>; notice?: string };
}
export interface ExternalMcpCatalogSnapshot { revision: string; servers: StoredExternalMcpServer[] }
export interface ExternalMcpPreviewEntry {
  authType?: 'oauth';
  id: string; label: string; transport: 'stdio' | 'http'; detail: string; bridgeEnabled: boolean;
  httpTransport?: ExternalMcpHttpTransport;
  description?: string;
  cwd?: string;
  /** Request/connection timeout in seconds. */
  timeout?: number;
  /** Names of credentials the pasted JSON already provides; values are never returned. */
  providedHeaders?: string[]; providedEnv?: string[];
  /** The address has a query: it is stored whole as a secret and listed as protocol//host only. */
  urlHasQuery?: boolean;
}
export interface ExternalMcpPreviewResult { token: string; entries: ExternalMcpPreviewEntry[]; errors: { name: string; reason: string }[]; warnings: ExternalMcpImportWarning[] }
/** Credential transaction: may store new keys, returns the keys that become obsolete once the JSON is saved. */
export type ExternalMcpServerUpdate = (server: StoredExternalMcpServer, store: (value: string) => Promise<string>) => Promise<string[]>;

const SECRET_REF = /^shuncode\.externalMcp\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function secretKeys(server: StoredExternalMcpServer): string[] {
  return [server.oauthRef, server.urlRef, server.argsRef, server.proxyRef, ...Object.values(server.envRefs ?? {}), ...Object.values(server.headerRefs ?? {})].filter((key): key is string => !!key);
}

/** A single user-level write source; no workspace file ever stores credentials. */
export class ExternalMcpCatalog {
  private readonly listeners = new Set<() => void>();
  private pending = Promise.resolve();
  private oauthProvider: ((server: StoredExternalMcpServer) => ExternalMcpRuntimeOAuth) | undefined;
  setOAuthProvider(provider: (server: StoredExternalMcpServer) => ExternalMcpRuntimeOAuth): void { this.oauthProvider = provider; }
  private network: ExternalMcpNetworkProvider | undefined;
  private migratedFrom: string | undefined;
  constructor(private readonly secrets: ExternalMcpSecretStore, private readonly filePathOverride?: string) { }

  /** Effective config file. Resolved lazily: the global Skill directory is registered after construction. */
  get filePath(): string {
    if (this.filePathOverride) return this.filePathOverride;
    const target = defaultExternalMcpConfigPath();
    this.migrateLegacyConfig(target);
    return target;
  }

  /** One-shot move of the legacy ~/.shuncode copy; the old file is kept as a .bak, never deleted. */
  private migrateLegacyConfig(target: string): void {
    if (target === LEGACY_EXTERNAL_MCP_CONFIG_PATH) return;
    try {
      if (existsSync(target) || !existsSync(LEGACY_EXTERNAL_MCP_CONFIG_PATH)) return;
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(LEGACY_EXTERNAL_MCP_CONFIG_PATH, target);
      renameSync(LEGACY_EXTERNAL_MCP_CONFIG_PATH, `${LEGACY_EXTERNAL_MCP_CONFIG_PATH}.migrated.bak`);
      this.migratedFrom = LEGACY_EXTERNAL_MCP_CONFIG_PATH;
    } catch { /* A failed migration must never block reading or writing the catalog. */ }
  }

  /** Read-only answer to "where is my MCP config?" for the configure_mcp tool and diagnostics. */
  locations(): ExternalMcpConfigLocations {
    const configPath = this.filePath;
    let skills: string | undefined;
    try { skills = globalSkillsDirectory(); } catch { skills = undefined; }
    return {
      configPath,
      configExists: existsSync(configPath),
      skillsDirectory: skills,
      legacyPath: LEGACY_EXTERNAL_MCP_CONFIG_PATH,
      legacyExists: existsSync(LEGACY_EXTERNAL_MCP_CONFIG_PATH),
      migratedFrom: this.migratedFrom,
      skillDirectoryWritable: skills ? skillDirectoryIsUsable(skills) : undefined,
      secretStorage: process.platform === 'win32' ? 'Windows 凭据管理器'
        : process.platform === 'darwin' ? 'macOS 钥匙串' : '系统密钥环 (libsecret)',
    };
  }

  setNetworkProvider(provider: ExternalMcpNetworkProvider | undefined): void { this.network = provider; }
  onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed(): void { for (const listener of this.listeners) { try { listener(); } catch { /* Never abort a committed update. */ } } }

  snapshot(): ExternalMcpCatalogSnapshot {
    if (!existsSync(this.filePath)) return { revision: 'empty', servers: [] };
    if (statSync(this.filePath).size > 256_000) throw new Error('用户 MCP 配置超过 256 KB，请检查该文件。');
    const bytes = readFileSync(this.filePath);
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString('utf8')); }
    catch { throw new Error('用户 MCP 配置不是有效 JSON；未启动上游。'); }
    const catalog = parsed as { version?: unknown; servers?: unknown } | null;
    if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.servers) || catalog.servers.length > 50) throw new Error('用户 MCP 配置格式不受支持；未启动上游。');
    const servers: StoredExternalMcpServer[] = catalog.servers.map((entry: unknown) => {
      const server = entry as StoredExternalMcpServer;
      if (!server || typeof server !== 'object' || typeof server.id !== 'string' || typeof server.label !== 'string' ||
        !['stdio','http'].includes(server.transport) || typeof server.enabled !== 'boolean' || typeof server.editorEnabled !== 'boolean' || typeof server.bridgeEnabled !== 'boolean') {
        throw new Error('用户 MCP 配置含无效服务器；未启动上游。');
      }
      validateExternalMcpId(server.id);
      if (server.authType !== undefined && (server.authType !== 'oauth' || server.transport !== 'http' || !server.oauthRef || !SECRET_REF.test(server.oauthRef))) throw new Error('OAuth 配置引用无效。');
      externalMcpTimeout(server.timeout);
      if ((server.httpTransport !== undefined && !['auto', 'streamable-http', 'sse'].includes(server.httpTransport)) ||
        (server.description !== undefined && (typeof server.description !== 'string' || server.description.length > 2000)) ||
        (server.cwd !== undefined && (typeof server.cwd !== 'string' || server.cwd.length > 4096 || /[\r\n\0]/.test(server.cwd) || server.cwd.includes('${')))) {
        throw new Error('用户 MCP 的传输、描述或工作目录无效；未启动上游。');
      }
      return server;
    });
    if (new Set(servers.map(server => server.id)).size !== servers.length) throw new Error('用户 MCP 配置有重复 ID；未启动上游。');
    return { revision: createHash('sha256').update(bytes).digest('hex'), servers };
  }

  /** Preview token prevents stale UI submissions from overwriting another window's changes. */
  preview(input: string): ExternalMcpPreviewResult {
    const current = this.snapshot();
    const parsed = previewExternalMcpImport(input);
    const taken = new Set(current.servers.map(server => server.id));
    const entries = parsed.entries.filter(entry => {
      if (!taken.has(entry.id)) return true;
      parsed.errors.push({ name: entry.label, reason: `ID ${entry.id} 已存在；请更改 JSON 键名或先删除旧条目。` });
      return false;
    }).map(entry => ({ id: entry.id, label: entry.label, transport: entry.transport,
      ...(entry.authType ? { authType: entry.authType } : {}),
      ...(entry.httpTransport ? { httpTransport: entry.httpTransport } : {}),
      ...(entry.description ? { description: entry.description } : {}),
      ...(entry.cwd ? { cwd: entry.cwd } : {}),
      ...(entry.timeout !== undefined ? { timeout: entry.timeout } : {}),
      detail: entry.transport === 'http' ? new URL(entry.url!).origin : `stdio · ${entry.command} · ${entry.args?.length ?? 0} 个参数（敏感值不显示）`,
      bridgeEnabled: true,
      ...(entry.headers && Object.keys(entry.headers).length ? { providedHeaders: Object.keys(entry.headers) } : {}),
      ...(entry.env && Object.keys(entry.env).length ? { providedEnv: Object.keys(entry.env) } : {}),
      ...(entry.transport === 'http' && new URL(entry.url!).search ? { urlHasQuery: true } : {}) }));
    return { token: externalMcpPreviewToken(current.revision, input), entries, errors: parsed.errors, warnings: parsed.warnings };
  }

  /** Serializes this window's writes; the revision guard rejects known cross-window conflicts. */
  private async exclusive<T>(run: () => Promise<T>, waitMs = 5000): Promise<T> {
    const previous = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await this.withFileLock(run, waitMs); }
    finally { release(); }
  }

  /** All extension windows share this advisory lock; the preview revision is checked while holding it. */
  private async withFileLock<T>(run: () => Promise<T>, waitMs: number): Promise<T> {
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const lock = this.filePath + '.lock';
    let fd: number | undefined;
    for (let attempt = 0; attempt < Math.ceil(waitMs / 100) && fd === undefined; attempt++) {
      try { fd = openSync(lock, 'wx', 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try { if (Date.now() - statSync(lock).mtimeMs > 10 * 60_000) rmSync(lock, { force: true }); }
        catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError; }
        if (fd === undefined) await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    if (fd === undefined) throw new Error('另一个窗口正在修改 MCP 配置，请稍后重试。');
    try { return await run(); }
    finally { closeSync(fd); rmSync(lock, { force: true }); }
  }

  /** Upgrade earlier user catalogs that briefly kept stdio argv in plaintext. */
  async migrateLegacyArgs(): Promise<void> {
    await this.exclusive(async () => {
      const { servers } = this.snapshot();
      const written: string[] = [];
      let updated = false;
      try {
        for (const server of servers) {
          if (server.args === undefined) continue;
          if (!Array.isArray(server.args) || server.args.length > 64 || server.args.some(arg => typeof arg !== 'string' || arg.length > 4096)) {
            throw new Error('历史 MCP 命令参数无效；未启动上游。');
          }
          if (server.args.length && !server.argsRef) {
            const key = `shuncode.externalMcp.${randomUUID()}`;
            await this.secrets.store(key, JSON.stringify(server.args));
            written.push(key); server.argsRef = key;
          }
          delete server.args;
          updated = true;
        }
        if (updated) this.save(servers);
      } catch (error) {
        await Promise.allSettled(written.map(key => this.secrets.delete(key)));
        throw error;
      }
    });
  }

  private save(servers: StoredExternalMcpServer[], notify = true): void {
    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const tmp = path.join(directory, `.external-mcp-${randomUUID()}.tmp`);
    try {
      writeFileSync(tmp, JSON.stringify({ version: 1, servers }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      renameSync(tmp, this.filePath);
    } finally { rmSync(tmp, { force: true }); }
    if (notify) this.changed();
  }

  async import(input: string, token: string, selectedIds: readonly string[], target: 'both' | 'bridge' = 'both', secrets?: unknown): Promise<{ imported: { id: string; label: string }[] }> {
    return this.exclusive(async () => {
      const current = this.snapshot();
      const preview = this.preview(input);
      if (preview.token !== token) throw new Error('MCP 配置已变化，请重新预览后再确认。');
      const parsed = previewExternalMcpImport(input);
      const selected = new Set(selectedIds);
      if (selected.size < 1 || selected.size > MAX_EXTERNAL_MCP_SERVERS || selectedIds.some(id => typeof id !== 'string')) throw new Error('请选择至少一个有效 MCP 服务。');
      const drafts = parsed.entries.filter(entry => selected.has(entry.id) && preview.entries.some(p => p.id === entry.id));
      if (drafts.length !== selected.size) throw new Error('所选服务无效或已存在，请重新预览。');
      // Values typed into the page's password fields; they override credentials of the same name in the JSON.
      const typed = normalizeImportSecrets(secrets, drafts);
      for (const draft of drafts) {
        const extra = typed.get(draft.id);
        if (!extra) continue;
        if (extra.oauthClientSecret) draft.oauthClientSecret = extra.oauthClientSecret;
        if (draft.transport === 'http') draft.headers = mergeSecretFields('header', draft.headers, extra.headers);
        else draft.env = mergeSecretFields('env', draft.env, extra.env);
      }
      if (current.servers.length + drafts.length > MAX_EXTERNAL_MCP_SERVERS) throw new Error(`最多保存 ${MAX_EXTERNAL_MCP_SERVERS} 个共享 MCP 服务；请先删除不再使用的服务。`);
      const written: string[] = [];
      const storeSecret = async (value: string): Promise<string> => {
        const key = `shuncode.externalMcp.${randomUUID()}`;
        await this.secrets.store(key, value); written.push(key); return key;
      };
      try {
        const added: StoredExternalMcpServer[] = [];
        for (const draft of drafts) added.push(await this.persistDraft(draft, storeSecret, target));
        if (this.snapshot().revision !== current.revision) throw new Error('另一窗口已修改 MCP 配置，请重新预览。');
        this.save([...current.servers, ...added]);
        return { imported: added.map(server => ({ id: server.id, label: server.label })) };
      } catch (error) {
        await Promise.allSettled(written.map(key => this.secrets.delete(key)));
        throw error;
      }
    });
  }

  private async persistDraft(draft: ExternalMcpDraft, saveSecret: (value: string) => Promise<string>, target: 'both' | 'bridge'): Promise<StoredExternalMcpServer> {
    const stored: StoredExternalMcpServer = { id: draft.id, label: draft.label, transport: draft.transport, enabled: true,
      editorEnabled: target === 'both', bridgeEnabled: true,
      ...(draft.httpTransport ? { httpTransport: draft.httpTransport } : {}),
      ...(draft.description ? { description: draft.description } : {}),
      ...(draft.cwd ? { cwd: draft.cwd } : {}),
      ...(draft.timeout !== undefined ? { timeout: draft.timeout } : {}) };
    if (draft.authType === 'oauth') {
      stored.authType = 'oauth'; stored.oauth = draft.oauth;
      stored.oauthRef = await saveSecret(JSON.stringify({ ...(draft.oauthClientSecret ? { clientSecret: draft.oauthClientSecret } : {}) }));
    }
    if (draft.transport === 'http') {
      stored.urlRef = await saveSecret(draft.url!);
      if (draft.headers) {
        const refs: Record<string, string> = Object.create(null);
        for (const [key, value] of Object.entries(draft.headers)) refs[key] = await saveSecret(value);
        stored.headerRefs = refs;
      }
    } else {
      stored.command = draft.command;
      if (draft.args?.length) stored.argsRef = await saveSecret(JSON.stringify(draft.args));
      if (draft.env) {
        const refs: Record<string, string> = Object.create(null);
        for (const [key, value] of Object.entries(draft.env)) refs[key] = await saveSecret(value);
        stored.envRefs = refs;
      }
    }
    return stored;
  }

  /** One secret of `server`, for credential management; never returned to the page. */
  async readSecret(server: StoredExternalMcpServer, key: string): Promise<string> {
    if (!SECRET_REF.test(key)) throw new Error(`MCP ${server.id} 的密钥引用无效。`);
    const value = await this.secrets.get(key);
    if (value === undefined) throw Object.assign(new Error(`MCP ${server.id} 的密钥缺失，请重新导入。`), { missingSecret: true });
    return value;
  }

  /**
   * Credential transaction for one server (R2 §6.1-4): new keys are written first, then the JSON references, then the
   * obsolete keys are deleted, and only then do listeners hear about it. A failure before the save removes the new keys.
   */
  async updateServer(id: string, update: ExternalMcpServerUpdate): Promise<void> {
    await this.exclusive(async () => {
      const { servers } = this.snapshot();
      const server = servers.find(item => item.id === id);
      if (!server) throw new Error('MCP 服务已变化，请刷新。');
      const written: string[] = [];
      let obsolete: string[];
      try {
        obsolete = await update(server, async value => {
          const key = `shuncode.externalMcp.${randomUUID()}`;
          await this.secrets.store(key, value); written.push(key); return key;
        });
        this.save(servers, false);
      } catch (error) {
        await Promise.allSettled(written.map(key => this.secrets.delete(key)));
        throw error;
      }
      await Promise.allSettled(obsolete.filter(key => SECRET_REF.test(key)).map(key => this.secrets.delete(key)));
      this.changed();
    });
  }

  /** Whether every reference resolves, without returning any value: header/env gaps can be fixed from the page. */
  async checkRefs(server: StoredExternalMcpServer): Promise<ExternalMcpRefState> {
    const exists = async (key: string | undefined): Promise<boolean> => !!key && SECRET_REF.test(key) && (await this.secrets.get(key)) !== undefined;
    if (server.transport === 'http' ? !(await exists(server.urlRef)) : !server.command || (server.argsRef !== undefined && !(await exists(server.argsRef)))) return 'broken';
    if (server.authType === 'oauth' && !(await exists(server.oauthRef))) return 'missing-secret';
    for (const key of [...Object.values(server.headerRefs ?? {}), ...Object.values(server.envRefs ?? {}), ...(server.proxyMode === 'custom' ? [server.proxyRef] : [])]) if (!(await exists(key))) return 'missing-secret';
    return 'ok';
  }

  async resolve(server: StoredExternalMcpServer, retried = false): Promise<ResolvedExternalMcpServer> {
    try { return await this.resolveOnce(server); }
    catch (error) {
      // Another window may have rotated a key between our snapshot and this read: re-read the catalog once.
      if (retried || !(error as { missingSecret?: boolean }).missingSecret) throw error;
      const fresh = this.snapshot().servers.find(item => item.id === server.id);
      if (!fresh || JSON.stringify(fresh) === JSON.stringify(server)) throw error;
      return this.resolve(fresh, true);
    }
  }

  private async resolveOnce(server: StoredExternalMcpServer): Promise<ResolvedExternalMcpServer> {
    const resolved: ResolvedExternalMcpServer = { id: server.id, label: server.label, transport: server.transport,
      ...(server.httpTransport ? { httpTransport: server.httpTransport } : {}),
      ...(server.description ? { description: server.description } : {}),
      ...(server.timeout !== undefined ? { timeout: externalMcpTimeout(server.timeout) } : {}) };
    const get = (key: string): Promise<string> => this.readSecret(server, key);
    if (server.transport === 'http') {
      if (!server.urlRef) throw new Error(`MCP ${server.id} 的 URL 引用缺失。`);
      resolved.url = validateExternalMcpUrl(await get(server.urlRef)).toString();
      const headers: Record<string, string> = Object.create(null);
      for (const [key, ref] of Object.entries(server.headerRefs ?? {})) {
        if (['x-shuncode-managed-streamable-http', 'x-shuncode-mcp-timeout-ms', 'x-shuncode-mcp-oauth'].includes(key.toLowerCase())) throw new Error(`MCP ${server.id} 使用了保留的 HTTP 标记。`);
        headers[key] = await get(ref);
      }
      if (server.authType === 'oauth') {
        if (Object.keys(headers).some(key => key.toLowerCase() === 'authorization')) throw new Error('OAuth 与 Authorization 配置冲突。');
        if (!this.oauthProvider) throw new Error('OAuth 凭据管理器尚未就绪。');
        resolved.oauth = this.oauthProvider(server);
      }
      resolved.headers = headers;
      if (this.network) resolved.network = this.network.fingerprint();
    } else {
      if (!server.command) throw new Error(`MCP ${server.id} 的启动命令缺失。`);
      resolved.command = server.command;
      // User-level relative paths are anchored to home on both editor and Bridge, never the active project.
      if (server.cwd) {
        const cwd = server.cwd === '~' ? os.homedir() : /^[~][\\/]/.test(server.cwd) ? path.join(os.homedir(), server.cwd.slice(2)) : server.cwd;
        resolved.cwd = path.resolve(os.homedir(), cwd);
      }
      if (server.argsRef) {
        const args: unknown = JSON.parse(await get(server.argsRef));
        if (!Array.isArray(args) || args.length > 64 || args.some(arg => typeof arg !== 'string')) throw new Error(`MCP ${server.id} 的参数引用无效。`);
        resolved.args = args;
      } else if (server.args?.length) throw new Error(`MCP ${server.id} 的历史参数尚未安全迁移。`);
      else resolved.args = [];
      const env: Record<string, string> = Object.create(null);
      for (const [key, ref] of Object.entries(server.envRefs ?? {})) {
        if (['SHUNCODE_MCP_MANAGED', 'SHUNCODE_MCP_TIMEOUT_MS'].includes(key.toUpperCase())) throw new Error(`MCP ${server.id} 使用了保留的环境变量。`);
        env[key] = await get(ref);
      }
      if (this.network) {
        const custom = server.proxyMode === 'custom' && server.proxyRef ? await get(server.proxyRef) : undefined;
        const proxy = this.network.stdioEnv(server.proxyMode, custom);
        // The user's own env wins over every case variant of a proxy variable it sets.
        const userNames = new Set(Object.keys(env).map(name => name.toLowerCase()));
        for (const [key, value] of Object.entries(proxy.env)) if (!userNames.has(key.toLowerCase())) env[key] = value;
        if (proxy.notice) resolved.proxyNotice = proxy.notice;
        resolved.network = this.network.fingerprint();
      }
      resolved.env = env;
    }
    return resolved;
  }

  /** OAuth transactions share the cross-window catalog lock. Refreshes keep the reference stable; login/logout rotate it. */
  async withOAuthState<T>(id: string, expectedRef: string | undefined, run: (raw: string, server: StoredExternalMcpServer, save: (raw: string, rotate?: boolean) => Promise<void>) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const current = this.snapshot();
      const server = current.servers.find(entry => entry.id === id);
      if (!server || server.authType !== 'oauth' || !server.oauthRef || (expectedRef !== undefined && server.oauthRef !== expectedRef)) throw Object.assign(new Error('OAuth 配置已变化，请重新授权。'), { status: 401 });
      const oldRef = server.oauthRef;
      const raw = await this.readSecret(server, oldRef);
      return run(raw, server, async (next, rotate = false) => {
        if (next.length > 128_000 || this.snapshot().revision !== current.revision) throw new Error('OAuth 状态过大或配置已变化，请重试。');
        if (!rotate) { await this.secrets.store(oldRef, next); return; }
        const ref = `shuncode.externalMcp.${randomUUID()}`;
        await this.secrets.store(ref, next);
        server.oauthRef = ref;
        try { this.save(current.servers, false); }
        catch (error) { await Promise.allSettled([this.secrets.delete(ref)]); throw error; }
        await Promise.allSettled([this.secrets.delete(oldRef)]);
        this.changed();
      });
    }, 45_000);
  }

  async setEnabled(id: string, enabled: boolean, target: 'both' | 'editor' | 'bridge' = 'both'): Promise<void> {
    await this.exclusive(async () => {
      const { servers } = this.snapshot();
      const server = servers.find(item => item.id === id);
      if (!server) throw new Error('MCP 服务已变化，请刷新。');
      if (target === 'both') server.enabled = enabled;
      else if (target === 'editor') server.editorEnabled = enabled;
      else server.bridgeEnabled = enabled;
      this.save(servers);
    });
  }
  async remove(id: string): Promise<void> {
    await this.exclusive(async () => {
      const { servers } = this.snapshot();
      const found = servers.find(server => server.id === id);
      if (!found) throw new Error('MCP 服务已变化，请刷新。');
      this.save(servers.filter(server => server.id !== id));
      await Promise.allSettled(secretKeys(found).map(key => this.secrets.delete(key)));
    });
  }
}
