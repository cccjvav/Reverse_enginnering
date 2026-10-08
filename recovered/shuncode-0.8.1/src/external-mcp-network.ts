import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { resolveExtensionHostProxy } from './extension-host-proxy.mjs';
import { diagnosisRoute } from './external-mcp-diagnose.js';
import { stdioProxyEnvironment, type ExternalMcpProxyMode } from './external-mcp-stdio-env.js';

/**
 * Network settings as they affect shared MCP servers (R2 §7.3.1, §7.3.3). Both surfaces read the same decision:
 * a change of http.proxy / http.noProxy / http.proxySupport / http.proxyStrictSSL (or the extra CA file) changes the
 * fingerprint, which is part of every definition version and resolved config, so the editor and the Bridge reconnect.
 * Settings that need a window reload (http.systemCertificates) get a reload prompt instead.
 */
const WATCHED = ['http.proxy', 'http.noProxy', 'http.proxySupport', 'http.proxyStrictSSL', 'shuncode.mcp.extraCaCertificates'];
const RELOAD = ['http.systemCertificates'];
/** Representative HTTPS target for the proxy decision, as R2 §7.3.3 prescribes. */
const PROBE = new URL('https://registry.npmjs.org/');

export interface ExternalMcpNetworkState { proxySupport: string; proxy?: string; noProxy: string[]; strictSsl: boolean; extraCaCertificates?: string }

function withoutCredentials(proxy: string | undefined): string {
  if (!proxy) return '';
  try { const url = new URL(proxy); return `${url.protocol}//${url.host}${url.username || url.password ? ' (with credentials)' : ''}`; }
  catch { return '(invalid)'; }
}

export class ExternalMcpNetwork implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subscription: vscode.Disposable;
  /** Shown once in the Skill page's MCP list after a change: 「网络设置已变化，已重连」. */
  lastChange: number | undefined;

  constructor() {
    this.subscription = vscode.workspace.onDidChangeConfiguration(event => {
      if (WATCHED.some(key => event.affectsConfiguration(key))) { this.lastChange = Date.now(); this.emitter.fire(); }
      if (RELOAD.some(key => event.affectsConfiguration(key))) {
        void vscode.window.showInformationMessage('证书相关的网络设置需要重新加载窗口后，共享 MCP 服务才会使用新设置。', '重新加载窗口').then(choice => {
          if (choice) void vscode.commands.executeCommand('workbench.action.reloadWindow');
        });
      }
    });
  }

  state(): ExternalMcpNetworkState {
    const http = vscode.workspace.getConfiguration('http');
    const proxySupport = String(http.get<string>('proxySupport') ?? 'override');
    const configured = http.get<string>('proxy') || undefined;
    // resolveExtensionHostProxy returns an authority URL ('http://host:port/'); env consumers expect no trailing slash.
    const proxy = proxySupport === 'off' ? undefined : resolveExtensionHostProxy(PROBE, configured)?.replace(/\/$/, '');
    const noProxy = (http.get<string[]>('noProxy') ?? []).filter((entry): entry is string => typeof entry === 'string');
    const extra = vscode.workspace.getConfiguration('shuncode').get<string>('mcp.extraCaCertificates')?.trim() || undefined;
    return { proxySupport, proxy, noProxy, strictSsl: http.get<boolean>('proxyStrictSSL') !== false, extraCaCertificates: extra };
  }

  /** Stable across windows; carries no credential (only whether the proxy has one). */
  fingerprint(state = this.state()): string {
    const material = JSON.stringify([state.proxySupport, withoutCredentials(state.proxy), state.noProxy, state.strictSsl, state.extraCaCertificates ?? '']);
    return createHash('sha256').update(material).digest('hex').slice(0, 16);
  }

  /** Proxy variables for a stdio server, by its proxy mode (the custom URL comes from SecretStorage). */
  stdioEnv(mode: ExternalMcpProxyMode | undefined, customProxy?: string): { env: Record<string, string>; notice?: string } {
    const state = this.state();
    return stdioProxyEnvironment({ mode: mode ?? 'inherit', proxySupport: state.proxySupport, resolvedProxy: state.proxy, customProxy, noProxy: state.noProxy, extraCaCertificates: state.extraCaCertificates });
  }

  /** Route for the diagnosis of one address: decided by that address, as for real connections. */
  routeFor(target: URL): { proxy?: string; proxySupport: string } {
    const state = this.state();
    const configuredProxy = vscode.workspace.getConfiguration('http').get<string>('proxy') || undefined;
    return diagnosisRoute(target, { proxySupport: state.proxySupport, configuredProxy, noProxy: state.noProxy }, resolveExtensionHostProxy);
  }

  dispose(): void { this.subscription.dispose(); this.emitter.dispose(); }
}
