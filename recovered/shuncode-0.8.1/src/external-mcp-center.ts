import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { watchFile, unwatchFile, type Stats } from 'node:fs';
import { ExternalMcpCatalog, type StoredExternalMcpServer } from './external-mcp-catalog.js';
import { forgetNativeConfig, recallNativeConfig, redactedNativeView, rememberNativeConfig } from './external-mcp-native-refs.js';
import { registerExternalMcpSecretCommands } from './external-mcp-secret-commands.js';
import { createExternalMcpOAuth } from './external-mcp-oauth-commands.js';
import type { ExternalMcpOAuth } from './external-mcp-oauth.js';
import { ExternalMcpNetwork } from './external-mcp-network.js';
import { managedStdioEnvironment } from './external-mcp-stdio-env.js';
import { registerExternalMcpNetworkCommands } from './external-mcp-network-commands.js';
import { bridgeStatusOf, editorStateOf, legacyEditorStatus, type ExternalMcpRefState } from './external-mcp-status.js';
import type { BridgeManager } from './bridge-server.js';

const PROVIDER_ID = 'shuncode.external-mcp';
function providerLabel(server: StoredExternalMcpServer): string { return `ShunCode · ${server.label} [${server.id}]`; }
function providerId(definition: vscode.McpServerDefinition): string | undefined {
  const match = /\[([a-z][a-z0-9_]{1,16})\]$/.exec(definition.label);
  return match?.[1];
}

/** Extension-host interface to the one user catalog; Code-OSS's native MCP remains a separate client. */
export class ExternalMcpCenter implements vscode.Disposable {
  readonly catalog: ExternalMcpCatalog;
  private readonly oauth: ExternalMcpOAuth;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private bridge: BridgeManager | undefined;
  private knownRevision = '';
  private readonly ready: Promise<void>;
  private disposed = false;
  private readonly fileListener = (_current: Stats, _previous: Stats) => this.onCatalogChange(true);
  /** Reference checks are cached per catalog revision and SecretStorage change, not re-resolved every 2 s. */
  private refCache: { key: string; states: Map<string, ExternalMcpRefState> } | undefined;
  private secretEpoch = 0;
  /** One network decision for both surfaces (R2 §7.3); its fingerprint versions every definition. */
  private readonly network = new ExternalMcpNetwork();
  private readonly bundledBinDir: string;

  constructor(context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {
    this.bundledBinDir = context.asAbsolutePath("runtime/bin");
    this.catalog = new ExternalMcpCatalog(context.secrets);
    this.catalog.setNetworkProvider(this.network);
    const authentication = createExternalMcpOAuth(this.catalog, () => {
      if (this.disposed) return;
      this.refCache = undefined; this.changed.fire();
      if (vscode.workspace.isTrusted) this.refreshBridge();
    });
    this.oauth = authentication.oauth; this.disposables.push(...authentication.disposables);
    this.disposables.push(this.network, this.network.onDidChange(() => {
      // New definition versions make the editor reconnect; the Bridge reconnects with the new proxy variables.
      this.output.appendLine('[external-mcp] network settings changed; reconnecting shared servers');
      this.changed.fire();
      if (vscode.workspace.isTrusted) this.refreshBridge();
    }));
    this.ready = this.catalog.migrateLegacyArgs();
    void this.ready.catch(() => this.output.appendLine('[external-mcp] legacy argument migration unavailable')); 
    this.disposables.push(vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: this.changed.event,
      provideMcpServerDefinitions: () => this.provideDefinitions(),
      resolveMcpServerDefinition: definition => this.resolveDefinition(definition),
    }));
    this.disposables.push({ dispose: this.catalog.onDidChange(() => this.onCatalogChange(false)) });
    if (context.secrets.onDidChange) this.disposables.push(context.secrets.onDidChange(() => { this.secretEpoch++; }));
    watchFile(this.catalog.filePath, { interval: 2000 }, this.fileListener);
    const command = (id: string, run: (...args: any[]) => unknown) => this.disposables.push(vscode.commands.registerCommand(id, run));
    command('shuncode.mcp.open', () => vscode.commands.executeCommand('aiCustomization.openManagementEditor', 'skillCenter'));
    command('shuncode.mcp.getCatalog', () => this.getCatalog());
    command('shuncode.mcp.preview', (raw: unknown, options?: unknown) => {
      const native = (options as { native?: unknown } | undefined)?.native;
      if (native !== undefined) {
        // Native configs arrive over IPC only; the page gets a reference and a redacted view (R2 §6.1-3).
        if (!native || typeof native !== 'object' || Array.isArray(native)) throw new Error('原生 MCP 配置无效。');
        const json = JSON.stringify({ mcpServers: native });
        if (json.length > 64_000) throw new Error('原生 MCP 配置超过 64 KB。');
        return { ...this.catalog.preview(json), nativeRef: rememberNativeConfig(json), nativeView: redactedNativeView(native as Record<string, unknown>) };
      }
      if (typeof raw !== 'string') throw new Error('请粘贴 MCP URL、命令或 JSON。');
      return this.catalog.preview(raw);
    });
    command('shuncode.mcp.import', async (source: unknown, token: unknown, selectedIds: unknown, target: unknown = 'both', secrets?: unknown) => {
      await this.ready;
      const nativeRef = source && typeof source === 'object' ? (source as { nativeRef?: unknown }).nativeRef : undefined;
      const raw = nativeRef !== undefined ? recallNativeConfig(nativeRef) : source;
      if (typeof raw !== 'string' || typeof token !== 'string' || !Array.isArray(selectedIds) || !selectedIds.every(x => typeof x === 'string')) throw new Error('MCP 导入预览已失效，请重新确认。');
      if (target !== 'both' && target !== 'bridge') throw new Error('MCP 目标范围无效。');
      if (target === 'bridge') {
        if (!vscode.workspace.isTrusted) throw new Error('请先信任工作区，再将已有原生服务开放给 Bridge。');
        const choice = await vscode.window.showWarningMessage('将已有原生 MCP 的配置复制到用户目录，开放给远程 Bridge 调用。原生配置不会删除或修改；工作区来源会变成全局可用，请确认其命令、地址及权限。', { modal: true }, '确认开放');
        if (choice !== '确认开放') return { cancelled: true };
      }
      const result = await this.catalog.import(raw, token, selectedIds, target, secrets);
      if (typeof nativeRef === 'string') forgetNativeConfig(nativeRef);
      if (vscode.workspace.isTrusted) this.refreshBridge();
      return result;
    });
    command('shuncode.mcp.setEnabled', async (id: unknown, enabled: unknown, target: unknown) => {
      if (typeof id !== 'string' || typeof enabled !== 'boolean' || !['both', 'editor', 'bridge'].includes(String(target))) throw new Error('MCP 启停参数无效。');
      await this.catalog.setEnabled(id, enabled, target as 'both' | 'editor' | 'bridge');
      this.oauth.cancelUnavailable();
      if (vscode.workspace.isTrusted) this.refreshBridge();
    });
    command('shuncode.mcp.remove', async (id: unknown) => {
      if (typeof id !== 'string') throw new Error('MCP 服务 ID 无效。');
      const server = this.catalog.snapshot().servers.find(item => item.id === id);
      if (!server) throw new Error('MCP 服务已移除，请刷新。');
      const confirm = await vscode.window.showWarningMessage(`永久移除 MCP 服务「${server.label}」？编辑器与远程 Bridge 都会停止使用它。`, { modal: true }, '移除');
      if (confirm !== '移除') return { cancelled: true };
      this.oauth.cancel(id);
      await this.catalog.remove(id);
      return { removed: id };
    });
    // With a server id the page keeps its other rows usable; healthy connections are reused either way.
    command('shuncode.mcp.retry', async (serverId?: unknown) => {
      if (serverId !== undefined && typeof serverId !== 'string') throw new Error('MCP 服务 ID 无效。');
      await this.bridge?.refreshExternalMcp();
      return { retried: serverId ?? 'global' };
    });
    this.disposables.push(...registerExternalMcpNetworkCommands(this.catalog, this.network, this.output));
    this.disposables.push(...registerExternalMcpSecretCommands(this.catalog, () => { this.refCache = undefined; if (vscode.workspace.isTrusted) this.refreshBridge(); }));
    this.disposables.push(vscode.workspace.onDidGrantWorkspaceTrust(() => { this.changed.fire(); this.refreshBridge(); }));
    // The extension API only signals trust grants, not revocation. Ensure editor definitions
    // are removed promptly when a trusted workspace becomes restricted.
    let wasTrusted = vscode.workspace.isTrusted;
    const trustTimer = setInterval(() => {
      const trusted = vscode.workspace.isTrusted;
      if (wasTrusted === trusted) return;
      wasTrusted = trusted;
      if (!trusted) this.oauth.cancelAll();
      this.changed.fire();
      this.refreshBridge();
    }, 1000);
    this.disposables.push({ dispose: () => clearInterval(trustTimer) });
  }

  attachBridge(bridge: BridgeManager): void { this.bridge = bridge; }
  private refreshBridge(): void {
    void this.bridge?.refreshExternalMcp().catch(() => this.output.appendLine('[external-mcp] Bridge refresh unavailable'));
  }
  private onCatalogChange(fromOtherWindow: boolean): void {
    if (this.disposed) return;
    try {
      const revision = this.catalog.snapshot().revision;
      if (revision === this.knownRevision) return;
      this.knownRevision = revision;
      this.oauth.cancelUnavailable();
      this.changed.fire();
      if (fromOtherWindow) this.refreshBridge();
      this.output.appendLine('[external-mcp] catalog changed');
    } catch {
      // Do not publish stale definitions when a user edits malformed JSON.
      this.changed.fire();
      if (fromOtherWindow) this.refreshBridge();
    }
  }
  private async provideDefinitions(): Promise<vscode.McpServerDefinition[]> {
    if (!vscode.workspace.isTrusted) return [];
    try { await this.ready; } catch { return []; }
    if (!vscode.workspace.isTrusted) return [];
    let servers: StoredExternalMcpServer[];
    try { servers = this.catalog.snapshot().servers.filter(server => server.enabled && server.editorEnabled); }
    catch { return []; }
    return servers.map(server => {
      const label = providerLabel(server);
      if (server.transport === 'stdio') return new vscode.McpStdioServerDefinition(label, server.command ?? '', [], {}, this.definitionVersion(server));
      // The credential-bearing URL is only resolved at launch; even discovery will not show it.
      return new vscode.McpHttpServerDefinition(label, vscode.Uri.parse(`https://shuncode.invalid/${server.id}`), {}, this.definitionVersion(server));
    });
  }
  private async resolveDefinition(definition: vscode.McpServerDefinition): Promise<vscode.McpServerDefinition | undefined> {
    if (!vscode.workspace.isTrusted) return undefined;
    await this.ready;
    const id = providerId(definition);
    const server = this.catalog.snapshot().servers.find(item => item.id === id && item.enabled && item.editorEnabled);
    if (!server || definition.label !== providerLabel(server)) return undefined;
    const runtime = await this.catalog.resolve(server);
    if (!vscode.workspace.isTrusted) return undefined;
    const timeout = runtime.timeout === undefined ? undefined : String(Math.round(runtime.timeout * 1000));
    if (runtime.transport === 'stdio') {
      const resolved = new vscode.McpStdioServerDefinition(definition.label, runtime.command!, runtime.args, { ...managedStdioEnvironment(runtime.env, process.env, process.platform, this.bundledBinDir), SHUNCODE_MCP_MANAGED: '1',
        ...(timeout ? { SHUNCODE_MCP_TIMEOUT_MS: timeout } : {}) }, this.definitionVersion(server));
      if (runtime.cwd) resolved.cwd = vscode.Uri.file(runtime.cwd);
      return resolved;
    }
    return new vscode.McpHttpServerDefinition(definition.label, vscode.Uri.parse(runtime.url!), { ...runtime.headers,
      'X-ShunCode-Managed-Streamable-HTTP': runtime.httpTransport ?? '1',
      ...(server.authType === 'oauth' ? { 'X-ShunCode-MCP-OAuth': await this.oauth.issueEditorHandle(server) } : {}),
      ...(timeout ? { 'X-ShunCode-MCP-Timeout-MS': timeout } : {}) }, this.definitionVersion(server));
  }
  /** Entry revision + network fingerprint (R2 §7.3.1): VS Code restarts a definition when either changes. */
  private definitionVersion(server: StoredExternalMcpServer): string {
    return `${createHash('sha256').update(JSON.stringify([server, 'bundled-stdio-v1', server.transport === 'stdio' ? this.bundledBinDir : undefined])).digest('hex').slice(0, 12)}:${this.network.fingerprint()}`;
  }

  private async getCatalog(): Promise<unknown> {
    try { await this.ready; } catch { return { error: '历史 MCP 参数迁移失败，请检查用户配置与安全存储。', entries: [], trusted: vscode.workspace.isTrusted }; }
    const runtime = this.bridge?.externalMcpHealth() ?? [];
    let servers: StoredExternalMcpServer[];
    try { servers = this.catalog.snapshot().servers; }
    catch (error) { return { error: error instanceof Error ? error.message : '用户 MCP 配置无效。', entries: [], trusted: vscode.workspace.isTrusted }; }
    // Missing keys must be visible rather than an endless “connecting” state; references are checked, never returned.
    const refs = await this.refStates(servers);
    const oauthStates = new Map(await Promise.all(servers.filter(server => server.authType === 'oauth').map(async server => [server.id, await this.oauth.status(server)] as const)));
    const trusted = vscode.workspace.isTrusted, bridgeRunning = this.bridge?.getStatus().state === 'running';
    const networkNotice = this.network.lastChange && Date.now() - this.network.lastChange < 60_000 ? '网络设置已变化，已重连共享 MCP 服务。' : undefined;
    return { trusted, bridgeRunning, ...(networkNotice ? { networkNotice } : {}),
      entries: servers.map(server => {
        const health = runtime.find(item => item.id === server.id), referenceState = refs.get(server.id) ?? 'ok';
        const oauthState = oauthStates.get(server.id);
        const state = referenceState === 'ok' && oauthState && oauthState !== 'authorized' ? 'missing-secret' : referenceState;
        const editorState = editorStateOf(server, { trusted, refs: state, health });
        const bridge = bridgeStatusOf(server, { bridgeRunning, refs: state, health });
        if (server.authType === 'oauth' && bridge.status === 'needs-auth') bridge.reason = oauthState === 'authorizing' ? '正在等待浏览器授权。' : '请点击 OAuth 授权或重新授权。';
        return {
        id: server.id, label: server.label, source: 'ShunCode 用户目录', transport: server.transport,
        authType: server.authType, oauthState,
        httpTransport: server.httpTransport, description: server.description, cwd: server.cwd, timeout: server.timeout,
        enabled: server.enabled, editorEnabled: server.editorEnabled, bridgeEnabled: server.bridgeEnabled,
        editorStatus: legacyEditorStatus(editorState), editorState, bridge,
        ...(server.transport === 'stdio' ? { proxyMode: server.proxyMode ?? 'inherit', proxyNotice: server.proxyMode === 'custom' ? undefined : this.network.stdioEnv(server.proxyMode).notice } : {}),
        bridgeStatus: state !== 'ok' ? { state: 'error', toolCount: 0, error: bridge.reason ?? '配置或凭据缺失，请重新导入。' }
          : health ?? { state: 'off', toolCount: 0 },
        // A URL can carry a token in its path or query. Never return it, even to the UI.
        detail: (server.transport === 'http'
          ? `${server.httpTransport === 'sse' ? 'SSE' : server.httpTransport === 'auto' ? '自动（HTTP / SSE）' : 'Streamable HTTP'}（地址仅在本机安全存储）`
          : `stdio · ${server.command ?? ''}${server.cwd ? ` · 工作目录：${server.cwd}` : ''}`)
          + (server.timeout !== undefined ? ` · 超时 ${server.timeout} 秒` : '') + (server.description ? ` · ${server.description}` : ''),
      }; }),
    };
  }
  private async refStates(servers: StoredExternalMcpServer[]): Promise<Map<string, ExternalMcpRefState>> {
    const key = `${this.catalog.snapshot().revision}:${this.secretEpoch}`;
    if (this.refCache?.key === key) return this.refCache.states;
    const states = new Map<string, ExternalMcpRefState>(await Promise.all(servers.map(async server =>
      [server.id, server.enabled ? await this.catalog.checkRefs(server).catch((): ExternalMcpRefState => 'broken') : 'ok'] as const)));
    this.refCache = { key, states };
    return states;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    unwatchFile(this.catalog.filePath, this.fileListener);
    this.changed.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    this.bridge = undefined;
  }
}
