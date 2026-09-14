import { BridgeMcpTransport } from "./bridge-mcp-transport.js";
import { BridgeToolDispatcher } from "./bridge-tool-dispatcher.js";
import { BRIDGE_SERVER_INSTRUCTIONS, BRIDGE_TOOL_DEFINITIONS, BRIDGE_TOOL_CONCURRENCY_SETTING, resolveBridgeToolConcurrency } from "./bridge-constants.js";
import type { BridgeStatus, BridgeTunnelProvider, BridgeHealthProbe, BridgeHealthReport } from "./bridge-constants.js";
export { SET_TODOS_TOOL, REPORT_PROGRESS_TOOL, BRIDGE_TOOL_DEFINITIONS } from "./bridge-constants.js";
export type { BridgeStatus, BridgeTunnelProvider, BridgeActivity, BridgeTodo, BridgeActivityPresentation, BridgeActivityItem, BridgeDiffFilePreview, BridgeDiffHunkPreview, BridgeDiffLinePreview, BridgeHealthProbe, BridgeHealthReport } from "./bridge-constants.js";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { deleteCustomTool, toggleCustomTool } from "../../../src/custom-tool-admin.js";
import { migrateLegacySkillDirs } from "../../../src/custom-tool-migration.js";
import { generateSkillRunner, importSkill, type SkillImportResult, type SkillRunnerResult } from "../../../src/custom-tool-skill-import.js";
import { diagnoseSkillTools, type SkillLoadDiagnosis } from "../../../src/custom-tool-skill.js";
import {
  CUSTOM_TOOLS_DIR_NAME,
  customToolsFingerprint,
  listEnabledCustomTools,
  loadCustomTools,
  toStatusEntries,
  type CustomToolStatusEntry,
  type CustomToolManifest,
} from "../../../src/custom-tools.js";
import type { IdeToolBroker } from "./ide-tool-broker.js";
import { fetchWithExtensionHostFallbacks, resolveExtensionHostProxy } from "./extension-host-proxy.mjs";
import { acquireBridgeTunnelLease, bridgeTunnelLeaseResources, clearTunnelOwnership, isBridgeTunnelLeaseConflict, reclaimStaleTunnelOwner, recordTunnelOwnership } from "./bridge-tunnel-lease.js";

const execFileAsync = promisify(execFile);
const ROUTE_TOKEN_SECRET = "shuncode.bridge.routeToken";
const NGROK_DOMAIN_SETTING = "bridge.ngrokDomain";
const NGROK_DOMAIN_STATE_KEY = "shuncode.bridge.ngrokDomain";
const CLOUDFLARE_NAMED_DOMAIN_SETTING = "bridge.cloudflareNamedDomain";
const CLOUDFLARE_NAMED_DOMAIN_STATE_KEY = "shuncode.bridge.cloudflareNamedDomain";
const CLOUDFLARE_NAMED_TOKEN_SECRET = "shuncode.bridge.cloudflareNamedTunnelToken";
const CLOUDFLARE_NAMED_LOCAL_PORT_SETTING = "bridge.cloudflareNamedLocalPort";
const TUNNEL_PROVIDER_SETTING = "bridge.tunnelProvider";
const CUSTOM_INSTRUCTIONS_SETTING = "bridge.customInstructions";
const BRIDGE_SKILLS_ENABLED_SETTING = "bridge.skillsEnabled";
const BRIDGE_WORKSPACE_SCOPE_SETTING = "bridge.workspaceScope";
const NGROK_USE_HTTP_PROXY_SETTING = "bridge.ngrokUseHttpProxy";
const DEFAULT_PUBLIC_HEALTH_STARTUP_TIMEOUT_MS = 20_000;
const PUBLIC_HEALTH_STARTUP_TIMEOUT_SETTING = "bridge.startupTimeoutMs";
const PUBLIC_HEALTH_REQUEST_TIMEOUT_MS = 5_000;
const PUBLIC_HEALTH_POLL_INTERVAL_MS = 750;
const PUBLIC_HEALTH_DETERMINISTIC_FAILURE_LIMIT = 3;
const TUNNEL_RESTART_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
const TUNNEL_TERMINATE_GRACE_MS = 1_000;
const TUNNEL_KILL_GRACE_MS = 1_000;
const NGROK_AGENT_API_BASE_URL = "http://127.0.0.1:4040";
const NGROK_AGENT_API_TIMEOUT_MS = 2_000;
// A hard-killed ngrok agent leaves its reserved endpoint online at the ngrok
// edge until the stale session times out (typically 1-5 minutes); a restart
// inside that window fails with ERR_NGROK_334. Retry only that failure, for
// ~3 minutes, before surfacing an actionable error.
const NGROK_ENDPOINT_ONLINE_RETRY_BACKOFF_MS = [5_000, 10_000, 15_000, 20_000, 30_000, 30_000, 30_000, 30_000] as const;
const CLOUDFLARED_WINGET_PACKAGE = "Cloudflare.cloudflared";
const DEFAULT_CLOUDFLARE_NAMED_LOCAL_PORT = 48271;

interface PublicHealthFailure {
  /** Human-readable cause chain surfaced in startup errors and the Bridge UI. */
  readonly reason: string;
  /** Primary error code when Node reported one (e.g. ENOTFOUND, ECONNRESET). */
  readonly code?: string;
  /** HTTP status when a response arrived. */
  readonly status?: number;
  /** True when retrying with the current network configuration cannot succeed. */
  readonly deterministic: boolean;
}

function publicHealthFailure(error: unknown): PublicHealthFailure {
  const messages: string[] = [];
  const codes: string[] = [];
  let current = error;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth++) {
    if (typeof current === "object") {
      const record = current as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
      if (typeof record.code === "string") codes.push(record.code);
      if (typeof record.message === "string") messages.push(record.message);
      current = record.cause;
    } else {
      messages.push(String(current));
      current = undefined;
    }
  }
  const reason = messages.join(": ") || (error instanceof Error ? error.message : String(error));
  const detail = `${codes.join(",")} ${reason}`.toLowerCase();
  const deterministic = codes.some((code) => code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EPIPE")
    || detail.includes("certificate") || detail.includes("self-signed") || detail.includes("tls") || detail.includes("ssl") || detail.includes("wrong version number");
  return { reason, code: codes.length ? codes[0] : undefined, deterministic };
}

function cloudflaredEdgeFailureHint(output: string): string {
  const lower = output.toLowerCase();
  const blocked = ["unable to establish", "dial tcp", "connection refused", "connection reset", "no such host", "i/o timeout", "context deadline", "quic"].some((marker) => lower.includes(marker));
  return blocked
    ? " This usually means cloudflared cannot reach the Cloudflare edge from this network. ShunCode passes a resolvable VS Code/system HTTP proxy to tunnel processes; if that still fails, verify the proxy supports tunnel traffic or use a system/global (TUN) proxy."
    : "";
}

type BridgeWorkspaceScope = "workspace" | "device";

function bridgeWorkspaceScopeInstructions(scope: BridgeWorkspaceScope): string {
  if (scope === "workspace") {
    return "Default operating scope: project files in the folder(s) currently open in ShunCode on this local Windows host. That is the default target, not a hard ban: inspect another local path on this same PC only when the user explicitly identifies it, usually with run_command for read-only discovery first. Do not scan the whole device by default. Workspace file tools remain workspace-scoped.";
  }
  return "Default operating scope: this entire local Windows device. Prioritize the folder(s) currently open in ShunCode whenever they are relevant, but you may inspect other local paths on this same PC without requiring the user to restate the workspace first. Locate the exact path before acting outside the workspace and prefer read-only discovery first when the target is uncertain. Workspace file tools remain workspace-scoped; use run_command for outside-workspace paths.";
}

function normalizeHttpsHostname(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`${label} is not a valid hostname.`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password || url.port) {
    throw new Error(`Enter only the ${label.toLowerCase()}, without a path, query, port, username, or password.`);
  }
  return url.hostname.toLowerCase();
}

function normalizeNgrokDomain(value: string): string {
  return normalizeHttpsHostname(value, "ngrok reserved domain");
}

function normalizeCloudflareNamedDomain(value: string): string {
  return normalizeHttpsHostname(value, "Cloudflare Named Tunnel hostname");
}

function normalizeNamedTunnelLocalPort(value: number): number {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error("Cloudflare Named Tunnel local port must be an integer from 1024 to 65535.");
  }
  return value;
}

function cancellationFromAbortSignal(signal: AbortSignal | undefined): { token?: vscode.CancellationToken; dispose(): void } {
  if (!signal) return { token: undefined, dispose: () => undefined };
  const source = new vscode.CancellationTokenSource();
  const listener = () => source.cancel();
  if (signal.aborted) source.cancel();
  else signal.addEventListener("abort", listener, { once: true });
  return {
    token: source.token,
    dispose: () => {
      signal.removeEventListener("abort", listener);
      source.dispose();
    },
  };
}

export class BridgeManager implements vscode.Disposable {
  private state: BridgeStatus["state"] = "stopped";
  private tunnelProvider: BridgeTunnelProvider = "cloudflare";
  private domain = "";
  private configuredDomain = "";
  private configuredNamedDomain = "";
  private namedTunnelToken = "";
  private namedTunnelLocalPort = DEFAULT_CLOUDFLARE_NAMED_LOCAL_PORT;
  private routeToken = "";
  private tunnelProcess: ChildProcessWithoutNullStreams | undefined;
  private lastError: string | undefined;
  private tunnelInstalled: boolean | undefined;
  private tunnelVersion: string | undefined;
  private tunnelConfigValid: boolean | undefined;
  private cloudflaredExecutable = "cloudflared";
  private ngrokExecutable = "ngrok";
  private revision = 0;
  private customToolsRevision = 0;
  private lastCustomToolsFingerprint = "";
  private lastHealth: BridgeHealthReport | undefined;
  private startPromise: Promise<BridgeStatus> | undefined;
  private tunnelRecoveryPromise: Promise<void> | undefined;
  private tunnelRecoveryGeneration: number | undefined;
  private tunnelGeneration = 0;
  private stoppingResources = false;
  private stopTunnelProcessInFlight: Promise<void> | undefined;
  private releaseTunnelLease: (() => Promise<void>) | undefined;
  private tunnelOwnerResources: string[] | undefined;
  private tunnelOwnerPid: number | undefined;
  private disposed = false;
  private readonly dispatcher: BridgeToolDispatcher;
  private readonly mcpTransport: BridgeMcpTransport;
  private currentLocalPort(): number | undefined { return this.mcpTransport.snapshot().localPort; }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly ideToolBroker: IdeToolBroker,
    private readonly authorizeStart: () => Promise<void>,
  ) {
    this.dispatcher = new BridgeToolDispatcher({
      invokeIdeTool: async (name, args, signal, ownerId) => {
        const cancellation = cancellationFromAbortSignal(signal);
        try { return await this.ideToolBroker.invokeDirect(name, args, cancellation.token, ownerId); }
        finally { cancellation.dispose(); }
      },
      workspaceRoots: () => this.workspaceRoots(),
      skillsEnabled: () => this.skillsEnabled(),
      log: message => this.output.appendLine(message),
    }, resolveBridgeToolConcurrency(vscode.workspace.getConfiguration("shuncode").get<number>(BRIDGE_TOOL_CONCURRENCY_SETTING)));
    this.mcpTransport = new BridgeMcpTransport({
      dispatchToolCall: (name, args, extra) => this.dispatcher.dispatch(name, args, extra),
      beginRemoteConversation: ownerId => this.dispatcher.beginRemoteConversation(ownerId),
      endRemoteConversation: ownerId => this.dispatcher.endRemoteConversation(ownerId),
      releaseCommandOwner: ownerId => this.ideToolBroker.releaseCommandOwner(ownerId),
      serverInstructions: () => this.composeServerInstructions(),
      log: message => this.output.appendLine(message),
      diag: message => this.output.appendLine("[bridge-mcp] " + message),
      listCustomTools: () => {
        try { return listEnabledCustomTools(this.workspaceRoots(), message => this.output.appendLine(message), { skillsEnabled: this.skillsEnabled() }); }
        catch { return []; }
      },
    });
  }

  async initialize(): Promise<void> {
    this.routeToken = await this.context.secrets.get(ROUTE_TOKEN_SECRET) ?? "";
    if (!this.routeToken) {
      this.routeToken = randomBytes(16).toString("hex");
      await this.context.secrets.store(ROUTE_TOKEN_SECRET, this.routeToken);
    }
    this.tunnelProvider = this.readTunnelProvider();
    this.namedTunnelToken = await this.context.secrets.get(CLOUDFLARE_NAMED_TOKEN_SECRET) ?? "";
    this.namedTunnelLocalPort = this.readNamedTunnelLocalPort();
    await this.restorePersistedDomain();
    await this.restorePersistedNamedDomain();
    this.domain = this.configuredDomainForProvider(this.tunnelProvider);
  }

  getStatus(): BridgeStatus {
    if (this.state !== "running" && this.state !== "starting") {
      this.tunnelProvider = this.readTunnelProvider();
      this.restoreConfiguredDomain();
      this.restoreConfiguredNamedDomain();
      this.namedTunnelLocalPort = this.readNamedTunnelLocalPort();
      this.domain = this.configuredDomainForProvider(this.tunnelProvider);
    }
    const localUrl = this.currentLocalPort() && this.routeToken ? `http://127.0.0.1:${this.currentLocalPort()}/mcp/${this.routeToken}` : undefined;
    const publicUrl = this.domain && this.routeToken ? `https://${this.domain}/mcp/${this.routeToken}` : undefined;
    const customTools = this.snapshotCustomTools();
    const transport = this.mcpTransport.snapshot();
    const activity = this.dispatcher.snapshotActivity();
    return {
      state: this.state,
      transport: "streamable-http",
      tunnelProvider: this.tunnelProvider,
      domain: this.domain,
      configuredDomain: this.configuredDomain,
      configuredNamedDomain: this.configuredNamedDomain,
      namedTunnelTokenConfigured: Boolean(this.namedTunnelToken),
      namedTunnelLocalPort: this.namedTunnelLocalPort,
      namedTunnelOriginUrl: `http://127.0.0.1:${this.namedTunnelLocalPort}`,
      localUrl,
      publicUrl,
      localPort: this.currentLocalPort(),
      tunnelInstalled: this.tunnelInstalled,
      tunnelVersion: this.tunnelVersion,
      tunnelConfigValid: this.tunnelConfigValid,
      lastError: this.lastError,
      toolNames: BRIDGE_TOOL_DEFINITIONS.map((tool) => tool.name),
      toolCount: BRIDGE_TOOL_DEFINITIONS.length,
      customTools,
      activeRequests: transport.activeRequests,
      connected: transport.connected,
      revision: this.revision + transport.revision + this.dispatcher.revision + this.customToolsRevision,
      stats: activity.stats,
      todos: this.dispatcher.snapshotTodos(),
      activities: activity.activities,
      health: this.lastHealth,
    };
  }

  private snapshotCustomTools(): CustomToolStatusEntry[] {
    let tools: CustomToolManifest[];
    try {
      tools = loadCustomTools(this.workspaceRoots(), (message) => this.output.appendLine(message), { skillsEnabled: this.skillsEnabled() });
    } catch {
      return [];
    }
    const fingerprint = customToolsFingerprint(tools);
    if (fingerprint !== this.lastCustomToolsFingerprint) {
      this.lastCustomToolsFingerprint = fingerprint;
      this.customToolsRevision += 1;
    }
    return toStatusEntries(tools);
  }

  async importSkill(source: string): Promise<{ status: BridgeStatus; result: SkillImportResult }> {
    const [root] = this.workspaceRoots();
    const result = importSkill(root, source, (message) => this.output.appendLine(message));
    return { status: this.getStatus(), result };
  }

  async diagnoseSkills(): Promise<{ status: BridgeStatus; diagnoses: SkillLoadDiagnosis[] }> {
    const [root] = this.workspaceRoots();
    const log = (message: string) => this.output.appendLine(message);
    migrateLegacySkillDirs(root, log);
    const skillsEnabled = this.skillsEnabled();
    let diagnoses = diagnoseSkillTools(root, log, { skillsEnabled });
    if (skillsEnabled) {
      const loadedNames = new Set(loadCustomTools(this.workspaceRoots(), log, { skillsEnabled }).map((tool) => tool.name));
      diagnoses = diagnoses.map((diagnosis): SkillLoadDiagnosis => {
        if (!diagnosis.loaded || !diagnosis.name || loadedNames.has(diagnosis.name)) return diagnosis;
        return {
          dirName: diagnosis.dirName,
          name: diagnosis.name,
          loaded: false,
          reasonCode: "duplicate-name",
          reason: "该名称已被同目录的 JSON 工具占用。",
          fix: "open-folder",
        };
      });
    }
    return { status: this.getStatus(), diagnoses };
  }

  async generateSkillRunner(name?: string): Promise<{ status: BridgeStatus; result: SkillRunnerResult }> {
    const [root] = this.workspaceRoots();
    const target = (name ?? "").trim();
    if (!target) throw new Error("Skill name must be a non-empty string.");
    const result = generateSkillRunner(root, target, (message) => this.output.appendLine(message));
    return { status: this.getStatus(), result };
  }

  async toggleCustomTool(name?: string): Promise<BridgeStatus> {
    const target = name ?? await this.pickCustomToolName("toggle");
    if (!target) return this.getStatus();
    toggleCustomTool(this.workspaceRoots(), target, (message) => this.output.appendLine(message));
    return this.getStatus();
  }

  async deleteCustomTool(name?: string): Promise<BridgeStatus> {
    const target = name ?? await this.pickCustomToolName("delete");
    if (!target) return this.getStatus();
    const zh = vscode.env.language.startsWith("zh");
    const confirm = await vscode.window.showWarningMessage(
      zh
        ? `永久删除自定义工具 “${target}”？其技能子文件夹或 JSON 清单会被删除，不可恢复。`
        : `Permanently delete custom tool "${target}"? Its skill subfolder or JSON manifest is removed.`,
      { modal: true },
      { title: zh ? "删除" : "Delete" } as vscode.MessageItem,
    );
    if (!confirm) return this.getStatus();
    deleteCustomTool(this.workspaceRoots(), target, (message) => this.output.appendLine(message));
    return this.getStatus();
  }

  /** Command-palette entry point: choose one of the workspace's custom tools. */
  private async pickCustomToolName(action: "toggle" | "delete"): Promise<string | undefined> {
    let tools: CustomToolManifest[];
    try {
      tools = loadCustomTools(this.workspaceRoots(), (message) => this.output.appendLine(message), { skillsEnabled: this.skillsEnabled() });
    } catch {
      tools = [];
    }
    const zh = vscode.env.language.startsWith("zh");
    if (tools.length === 0) {
      void vscode.window.showInformationMessage(
        zh
          ? `未发现自定义工具：把 skill 文件夹或 JSON 清单放入 ${CUSTOM_TOOLS_DIR_NAME}，或先使用“导入 Skill”。`
          : `No custom tools yet: drop a skill folder or JSON manifest into ${CUSTOM_TOOLS_DIR_NAME}, or import one.`,
      );
      return undefined;
    }
    const items = tools.map((tool) => ({
      label: `${tool.enabled ? "✓" : "⊘"}  ${tool.title || tool.name}`,
      description: tool.name,
      detail: tool.skillDir ? "skill" : "JSON manifest",
      pickedTool: tool.name,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      title: action === "toggle"
        ? (zh ? "选择要启用/停用的自定义工具" : "Select a custom tool to enable or disable")
        : (zh ? "选择要删除的自定义工具" : "Select a custom tool to delete"),
      placeHolder: zh ? "✓ 已启用　⊘ 已停用" : "✓ enabled　⊘ disabled",
    });
    return pick?.pickedTool;
  }

  private readConfiguredDomain(): string {
    return vscode.workspace.getConfiguration("shuncode").get<string>(NGROK_DOMAIN_SETTING, "").trim();
  }

  private readConfiguredNamedDomain(): string {
    return vscode.workspace.getConfiguration("shuncode").get<string>(CLOUDFLARE_NAMED_DOMAIN_SETTING, "").trim();
  }

  private readNamedTunnelLocalPort(): number {
    const value = vscode.workspace.getConfiguration("shuncode").get<number>(CLOUDFLARE_NAMED_LOCAL_PORT_SETTING, DEFAULT_CLOUDFLARE_NAMED_LOCAL_PORT);
    try {
      return normalizeNamedTunnelLocalPort(value);
    } catch {
      return DEFAULT_CLOUDFLARE_NAMED_LOCAL_PORT;
    }
  }

  private configuredDomainForProvider(provider: BridgeTunnelProvider): string {
    return provider === "ngrok" ? this.configuredDomain : provider === "cloudflare-named" ? this.configuredNamedDomain : "";
  }

  private readTunnelProvider(): BridgeTunnelProvider {
    const provider = vscode.workspace.getConfiguration("shuncode").get<BridgeTunnelProvider>(TUNNEL_PROVIDER_SETTING, "cloudflare");
    return provider === "ngrok" || provider === "cloudflare-named" ? provider : "cloudflare";
  }

  private readCustomInstructions(): string {
    return vscode.workspace.getConfiguration("shuncode").get<string>(CUSTOM_INSTRUCTIONS_SETTING, "").trim();
  }

  private readWorkspaceScope(): BridgeWorkspaceScope {
    return vscode.workspace.getConfiguration("shuncode").get<string>(BRIDGE_WORKSPACE_SCOPE_SETTING, "device") === "workspace" ? "workspace" : "device";
  }

  /**
   * Built-in Bridge instructions plus the optional user-defined text configured through
   * shuncode.bridge.customInstructions. Custom text is appended (never replacing the
   * built-in tool and task-coordination rules) and composed per session, so edits apply
   * to the next remote connection without restarting the Bridge.
   */
  private composeServerInstructions(): string {
    const custom = this.readCustomInstructions();
    const builtIn = `${BRIDGE_SERVER_INSTRUCTIONS}\n\n${bridgeWorkspaceScopeInstructions(this.readWorkspaceScope())}`;
    return custom ? `${builtIn}\n\n${custom}` : builtIn;
  }

  private readPersistedDomain(): string {
    return this.context.globalState.get<string>(NGROK_DOMAIN_STATE_KEY, "").trim();
  }

  private readPersistedNamedDomain(): string {
    return this.context.globalState.get<string>(CLOUDFLARE_NAMED_DOMAIN_STATE_KEY, "").trim();
  }

  /**
   * Restore the Bridge domain from either VS Code configuration or the extension's own
   * persistent memento. The memento is intentionally a second source of truth because
   * carrier/user-data migrations can temporarily present an empty configuration value on
   * startup. Whichever store still has the domain repairs the other one.
   */
  private async restorePersistedDomain(): Promise<void> {
    const configured = this.readConfiguredDomain();
    const persisted = this.readPersistedDomain();
    const candidate = configured || persisted;
    if (!candidate) return;

    this.configuredDomain = normalizeNgrokDomain(candidate);
    if (persisted !== this.configuredDomain) {
      await this.context.globalState.update(NGROK_DOMAIN_STATE_KEY, this.configuredDomain);
    }
    if (configured !== this.configuredDomain) {
      try {
        await vscode.workspace.getConfiguration("shuncode").update(NGROK_DOMAIN_SETTING, this.configuredDomain, vscode.ConfigurationTarget.Global);
      } catch (error) {
        this.output.appendLine(`[bridge] could not repair ngrok domain setting: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private restoreConfiguredDomain(): void {
    const candidate = this.readConfiguredDomain() || this.readPersistedDomain();
    if (!candidate) return;
    try {
      this.configuredDomain = normalizeNgrokDomain(candidate);
    } catch {
      // Keep the last known-good in-memory value. Invalid external settings should not erase it.
    }
  }

  private async persistDomain(domain: string): Promise<void> {
    const trimmed = domain.trim();
    this.configuredDomain = trimmed ? normalizeNgrokDomain(trimmed) : "";
    if (this.tunnelProvider === "ngrok") this.domain = this.configuredDomain;

    // Persist to the extension memento first so a configuration write failure cannot make the
    // domain disappear after a restart. An explicit empty value is also persisted to both
    // stores, so clearing the field is durable instead of reviving an older memento value.
    await this.context.globalState.update(NGROK_DOMAIN_STATE_KEY, this.configuredDomain);
    try {
      await vscode.workspace.getConfiguration("shuncode").update(NGROK_DOMAIN_SETTING, this.configuredDomain, vscode.ConfigurationTarget.Global);
    } catch (error) {
      this.output.appendLine(`[bridge] ngrok domain saved to extension state, but settings.json update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async configure(domain: string): Promise<BridgeStatus> {
    if (this.state === "running" || this.state === "starting") {
      throw new Error("Stop the Bridge before changing its ngrok domain.");
    }
    await this.persistDomain(domain);
    this.lastError = undefined;
    return this.getStatus();
  }

  private async restorePersistedNamedDomain(): Promise<void> {
    const configured = this.readConfiguredNamedDomain();
    const persisted = this.readPersistedNamedDomain();
    const candidate = configured || persisted;
    if (!candidate) return;

    this.configuredNamedDomain = normalizeCloudflareNamedDomain(candidate);
    if (persisted !== this.configuredNamedDomain) {
      await this.context.globalState.update(CLOUDFLARE_NAMED_DOMAIN_STATE_KEY, this.configuredNamedDomain);
    }
    if (configured !== this.configuredNamedDomain) {
      try {
        await vscode.workspace.getConfiguration("shuncode").update(CLOUDFLARE_NAMED_DOMAIN_SETTING, this.configuredNamedDomain, vscode.ConfigurationTarget.Global);
      } catch (error) {
        this.output.appendLine(`[bridge] could not repair Cloudflare Named Tunnel hostname setting: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private restoreConfiguredNamedDomain(): void {
    const candidate = this.readConfiguredNamedDomain() || this.readPersistedNamedDomain();
    if (!candidate) return;
    try {
      this.configuredNamedDomain = normalizeCloudflareNamedDomain(candidate);
    } catch {
      // Keep the last known-good in-memory value. Invalid external settings should not erase it.
    }
  }

  async configureNamedTunnel(input: { domain: string; token?: string; localPort: number }): Promise<BridgeStatus> {
    if (this.state === "running" || this.state === "starting") {
      throw new Error("Stop the Bridge before changing its Cloudflare Named Tunnel configuration.");
    }
    const domain = normalizeCloudflareNamedDomain(input.domain);
    const localPort = normalizeNamedTunnelLocalPort(input.localPort);
    const token = input.token?.trim();
    if (token !== undefined && !token) throw new Error("Cloudflare Tunnel Token cannot be empty.");

    this.configuredNamedDomain = domain;
    this.namedTunnelLocalPort = localPort;
    await this.context.globalState.update(CLOUDFLARE_NAMED_DOMAIN_STATE_KEY, domain);
    await vscode.workspace.getConfiguration("shuncode").update(CLOUDFLARE_NAMED_DOMAIN_SETTING, domain, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration("shuncode").update(CLOUDFLARE_NAMED_LOCAL_PORT_SETTING, localPort, vscode.ConfigurationTarget.Global);
    if (token !== undefined) {
      this.namedTunnelToken = token;
      await this.context.secrets.store(CLOUDFLARE_NAMED_TOKEN_SECRET, token);
    }
    if (this.tunnelProvider === "cloudflare-named") this.domain = domain;
    this.tunnelConfigValid = undefined;
    this.lastError = undefined;
    return await this.checkNamedTunnel();
  }

  async clearNamedTunnelToken(): Promise<BridgeStatus> {
    if (this.state === "running" || this.state === "starting") {
      throw new Error("Stop the Bridge before clearing its Cloudflare Tunnel Token.");
    }
    this.namedTunnelToken = "";
    await this.context.secrets.delete(CLOUDFLARE_NAMED_TOKEN_SECRET);
    this.tunnelConfigValid = false;
    this.lastError = "Cloudflare Named Tunnel Token is not configured.";
    return this.getStatus();
  }

  async setTunnelProvider(provider: string): Promise<BridgeStatus> {
    if (this.state === "running" || this.state === "starting") {
      throw new Error("Stop the Bridge before changing its tunnel provider.");
    }
    if (provider !== "cloudflare" && provider !== "cloudflare-named" && provider !== "ngrok") {
      throw new Error("Bridge tunnel provider must be cloudflare, cloudflare-named, or ngrok.");
    }
    this.tunnelProvider = provider;
    this.domain = this.configuredDomainForProvider(provider);
    this.tunnelInstalled = undefined;
    this.tunnelVersion = undefined;
    this.tunnelConfigValid = undefined;
    this.lastError = undefined;
    await vscode.workspace.getConfiguration("shuncode").update(TUNNEL_PROVIDER_SETTING, provider, vscode.ConfigurationTarget.Global);
    return this.getStatus();
  }

  async rotateEndpoint(): Promise<BridgeStatus> {
    if (this.state === "running" || this.state === "starting") {
      throw new Error("Stop the Bridge before rotating its endpoint URL.");
    }
    this.routeToken = randomBytes(16).toString("hex");
    await this.context.secrets.store(ROUTE_TOKEN_SECRET, this.routeToken);
    return this.getStatus();
  }

  async checkTunnel(): Promise<BridgeStatus> {
    this.tunnelProvider = this.readTunnelProvider();
    return this.tunnelProvider === "ngrok"
      ? await this.checkNgrok()
      : this.tunnelProvider === "cloudflare-named"
        ? await this.checkNamedTunnel()
        : await this.checkCloudflared();
  }

  /**
   * Clears the tool-call timeline and resets the call statistics. Calls that are
   * still running are kept so their completion is still recorded consistently.
   * Todos are the remote agent's task list and are intentionally left untouched.
   */
  clearActivityLog(): BridgeStatus {
    const removed = this.dispatcher.clearActivity();
    this.output.appendLine(`[bridge] tool activity log cleared: ${removed} entries removed`);
    return this.getStatus();
  }

  /**
   * Probes the Bridge end to end: local HTTP server, public tunnel endpoint,
   * tunnel process liveness and active MCP sessions. The report is kept on the
   * status so the Bridge panel can show the latest result.
   */
  async checkHealth(): Promise<BridgeStatus> {
    const startedAt = Date.now();
    const running = this.state === "running";
    const [local, publicProbe] = await Promise.all([
      this.probeLocalHealth(),
      running && this.domain && this.routeToken ? this.probePublicHealth() : Promise.resolve(undefined),
    ]);
    const tunnel = this.tunnelProcess;
    const tunnelProcessAlive = Boolean(tunnel && tunnel.exitCode === null && tunnel.signalCode === null);
    const transport = this.mcpTransport.snapshot();
    const lastSessionActivity = transport.lastSessionActivityAt;
    const ok = running && local.ok && publicProbe?.ok === true && tunnelProcessAlive;
    const problems: string[] = [];
    if (!running) problems.push(`Bridge is ${this.state}`);
    if (!local.ok) problems.push(`local: ${local.error ?? "failed"}`);
    if (running && !publicProbe) problems.push("public endpoint not assigned");
    if (publicProbe && !publicProbe.ok) problems.push(`public: ${publicProbe.error ?? "failed"}`);
    if (running && !tunnelProcessAlive) problems.push("tunnel process not running");
    const summary = ok
      ? `healthy · local ${local.latencyMs ?? 0} ms · public ${publicProbe?.latencyMs ?? 0} ms · ${transport.sessions} MCP session(s)`
      : `unhealthy · ${problems.join("; ")}`;
    const report: BridgeHealthReport = {
      at: new Date().toISOString(),
      ok,
      state: this.state,
      durationMs: Date.now() - startedAt,
      local,
      public: publicProbe,
      tunnelProcessAlive,
      sessions: transport.sessions,
      activeRequests: transport.activeRequests,
      lastSessionActivityAt: lastSessionActivity ? new Date(lastSessionActivity).toISOString() : undefined,
      summary,
    };
    this.lastHealth = report;
    this.output.appendLine(`[bridge] health check: ${summary}`);
    return this.getStatus();
  }

  private async probeLocalHealth(): Promise<BridgeHealthProbe> {
    if (!this.currentLocalPort() || !this.routeToken) {
      return { ok: false, error: this.state === "running" ? "local HTTP port unavailable" : "Bridge is not running" };
    }
    const url = `http://127.0.0.1:${this.currentLocalPort()}/healthz/${this.routeToken}`;
    const started = Date.now();
    try {
      const response = await fetch(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(3_000) });
      const latencyMs = Date.now() - started;
      if (!response.ok) return { ok: false, url, latencyMs, error: `HTTP ${response.status}` };
      const payload = await response.json().catch(() => undefined) as { ok?: unknown } | undefined;
      return payload?.ok === true
        ? { ok: true, url, latencyMs }
        : { ok: false, url, latencyMs, error: "health response did not confirm ok" };
    } catch (error) {
      return { ok: false, url, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async probePublicHealth(): Promise<BridgeHealthProbe> {
    const url = this.publicHealthUrl();
    const started = Date.now();
    const result = await this.requestPublicHealth(PUBLIC_HEALTH_REQUEST_TIMEOUT_MS * 2);
    const latencyMs = Date.now() - started;
    return result.ok
      ? { ok: true, url, latencyMs }
      : { ok: false, url, latencyMs, error: result.failure.reason };
  }

  async checkNgrok(): Promise<BridgeStatus> {
    let lastError: unknown;
    for (const executable of this.ngrokExecutableCandidates()) {
      try {
        const version = await execFileAsync(executable, ["version"], { windowsHide: true, timeout: 10_000 });
        this.ngrokExecutable = executable;
        this.tunnelInstalled = true;
        this.tunnelVersion = String(version.stdout || version.stderr).trim().split(/\r?\n/)[0] || "ngrok";
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!this.tunnelInstalled || lastError) {
      this.tunnelInstalled = false;
      this.tunnelConfigValid = false;
      this.tunnelVersion = undefined;
      this.lastError = `ngrok was not found: ${lastError instanceof Error ? lastError.message : String(lastError ?? "not installed")}`;
      return this.getStatus();
    }

    try {
      await execFileAsync(this.ngrokExecutable, ["config", "check"], { windowsHide: true, timeout: 10_000 });
      this.tunnelConfigValid = true;
      this.lastError = undefined;
    } catch (error) {
      this.tunnelConfigValid = false;
      this.lastError = `ngrok config check failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    return this.getStatus();
  }

  private async checkCloudflared(): Promise<BridgeStatus> {
    let lastError: unknown;
    for (const executable of this.cloudflaredExecutableCandidates()) {
      try {
        const version = await execFileAsync(executable, ["--version"], { windowsHide: true, timeout: 10_000 });
        this.cloudflaredExecutable = executable;
        this.tunnelInstalled = true;
        this.tunnelVersion = String(version.stdout || version.stderr).trim().split(/\r?\n/)[0] || "cloudflared";
        this.tunnelConfigValid = true;
        this.lastError = undefined;
        return this.getStatus();
      } catch (error) {
        lastError = error;
      }
    }
    this.tunnelInstalled = false;
    this.tunnelConfigValid = false;
    this.tunnelVersion = undefined;
    this.lastError = `cloudflared was not found: ${lastError instanceof Error ? lastError.message : String(lastError ?? "not installed")}`;
    return this.getStatus();
  }

  private async checkNamedTunnel(): Promise<BridgeStatus> {
    await this.checkCloudflared();
    if (!this.tunnelInstalled) return this.getStatus();

    this.namedTunnelToken = await this.context.secrets.get(CLOUDFLARE_NAMED_TOKEN_SECRET) ?? "";
    this.restoreConfiguredNamedDomain();
    this.namedTunnelLocalPort = this.readNamedTunnelLocalPort();
    this.domain = this.configuredNamedDomain;

    if (!this.namedTunnelToken) {
      this.tunnelConfigValid = false;
      this.lastError = "Cloudflare Named Tunnel Token is not configured.";
      return this.getStatus();
    }
    if (!this.configuredNamedDomain) {
      this.tunnelConfigValid = false;
      this.lastError = "Cloudflare Named Tunnel hostname is not configured.";
      return this.getStatus();
    }
    try {
      this.namedTunnelLocalPort = normalizeNamedTunnelLocalPort(this.namedTunnelLocalPort);
    } catch (error) {
      this.tunnelConfigValid = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      return this.getStatus();
    }

    this.tunnelConfigValid = true;
    this.lastError = undefined;
    return this.getStatus();
  }

  private cloudflaredExecutableCandidates(): string[] {
    const candidates = [this.cloudflaredExecutable, "cloudflared"];
    if (process.platform === "win32") {
      if (process.env.LOCALAPPDATA) {
        candidates.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "cloudflared.exe"));
        candidates.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "cloudflared.exe"));
      }
      if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, "cloudflared", "cloudflared.exe"));
      if (process.env["ProgramFiles(x86)"]) candidates.push(path.join(process.env["ProgramFiles(x86)"]!, "cloudflared", "cloudflared.exe"));
    }
    return [...new Set(candidates.filter(Boolean))];
  }

  private ngrokExecutableCandidates(): string[] {
    const candidates = [this.ngrokExecutable, "ngrok"];
    if (process.platform === "win32") {
      if (process.env.LOCALAPPDATA) {
        candidates.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "ngrok.exe"));
        candidates.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "ngrok.exe"));
      }
      if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, "ngrok", "ngrok.exe"));
      if (process.env["ProgramFiles(x86)"]) candidates.push(path.join(process.env["ProgramFiles(x86)"]!, "ngrok", "ngrok.exe"));
    }
    return [...new Set(candidates.filter(Boolean))];
  }

  async installCloudflared(): Promise<BridgeStatus> {
    if (this.state === "running" || this.state === "starting") {
      throw new Error("Stop the Bridge before installing cloudflared.");
    }
    this.tunnelProvider = this.readTunnelProvider();
    if (this.tunnelProvider !== "cloudflare" && this.tunnelProvider !== "cloudflare-named") {
      throw new Error("Select a Cloudflare tunnel mode before installing cloudflared.");
    }
    const existing = await this.checkCloudflared();
    if (existing.tunnelInstalled) return this.tunnelProvider === "cloudflare-named" ? await this.checkNamedTunnel() : existing;
    if (process.platform !== "win32") {
      throw new Error("One-click cloudflared installation is currently supported on Windows with Winget.");
    }

    this.output.appendLine(`[bridge] installing cloudflared with Winget package ${CLOUDFLARED_WINGET_PACKAGE}...`);
    try {
      const result = await execFileAsync("winget", [
        "install",
        "--id", CLOUDFLARED_WINGET_PACKAGE,
        "--exact",
        "--source", "winget",
        "--silent",
        "--disable-interactivity",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ], {
        windowsHide: false,
        timeout: 10 * 60 * 1000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const output = String(result.stdout || result.stderr).trim();
      if (output) this.output.appendLine(`[winget] ${output}`);
    } catch (error) {
      const details = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
      const output = [details.message, String(details.stdout ?? "").trim(), String(details.stderr ?? "").trim()].filter(Boolean).join("\n");
      this.lastError = `cloudflared installation failed: ${output}`;
      throw new Error(this.lastError);
    }

    const installed = await this.checkCloudflared();
    if (!installed.tunnelInstalled) {
      this.lastError = "cloudflared installation completed, but ShunCode could not locate the executable. Restart ShunCode and check the tunnel again.";
      throw new Error(this.lastError);
    }
    this.output.appendLine(`[bridge] cloudflared installation verified: ${installed.tunnelVersion ?? "installed"}`);
    return this.tunnelProvider === "cloudflare-named" ? await this.checkNamedTunnel() : installed;
  }

  async start(domain?: string): Promise<BridgeStatus> {
    if (this.disposed) throw new Error("Bridge has been disposed; reopen the workspace before starting it again.");
    if (this.state === "running") return this.getStatus();
    if (this.startPromise) return this.startPromise;
    // During automatic tunnel recovery the local HTTP/MCP runtime is intentionally kept alive.
    // A manual Start click must not create a second listener/tunnel while that recovery owns it.
    if (this.state === "starting" && this.mcpTransport.isListening()) return this.getStatus();
    this.startPromise = this.startInternal(domain);
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  /** Development-only transport smoke: opens the exact local Streamable HTTP MCP server without a public tunnel. */
  async startLocalSmoke(): Promise<BridgeStatus> {
    if (this.disposed) throw new Error("Bridge has been disposed; reopen the workspace before starting it again.");
    if (this.context.extensionMode !== vscode.ExtensionMode.Development || process.env.SHUNCODE_BRIDGE_SMOKE_LOCAL !== "1") {
      throw new Error("Local Bridge smoke mode is available only in an Extension Development Host with SHUNCODE_BRIDGE_SMOKE_LOCAL=1.");
    }
    if (this.state === "running") return this.getStatus();
    if (!this.routeToken) await this.initialize();
    if (!vscode.workspace.workspaceFolders?.length) throw new Error("Open a workspace folder before starting the Bridge smoke server.");
    this.state = "starting";
    this.lastError = undefined;
    try {
      await this.mcpTransport.start({
      provider: this.tunnelProvider,
      routeToken: this.routeToken,
      namedTunnelLocalPort: this.namedTunnelLocalPort,
    });
      await this.verifyLocalHealth();
      this.state = "running";
      this.output.appendLine(`[bridge-smoke] local Streamable HTTP server running on 127.0.0.1:${this.currentLocalPort()}`);
      return this.getStatus();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.state = "error";
      await this.stopResources(false);
      throw error;
    }
  }

  /**
   * Reserve this window's tunnel endpoint across ShunCode windows/instances.
   * ngrok is singleton per machine and a fixed domain/named credential cannot
   * be shared; when the configured provider is already held by another window,
   * a second window automatically falls back to provider #1 (cloudflare quick
   * tunnel, which needs no lease) instead of failing to start. Only this
   * window's in-memory provider changes — the configured provider in settings
   * is left untouched, so a later start retries it (and succeeds once the
   * other window releases it).
   */
  private async acquireTunnelLeaseOrFallbackToCloudflare(): Promise<void> {
    try {
      this.releaseTunnelLease = await acquireBridgeTunnelLease(this.currentTunnelLeaseResources());
      return;
    } catch (error) {
      if (this.tunnelProvider === "cloudflare" || !isBridgeTunnelLeaseConflict(error)) throw error;
    }
    const configured = this.tunnelProvider;
    this.output.appendLine(`[bridge] ${configured} is already in use by another ShunCode window; this window falls back to cloudflare.`);
    void vscode.window.showWarningMessage(`Bridge provider "${configured}" is already used by another ShunCode window; this window uses cloudflare instead.`);
    this.tunnelProvider = "cloudflare";
    this.domain = "";
    this.tunnelInstalled = undefined;
    this.tunnelVersion = undefined;
    this.tunnelConfigValid = undefined;
    const tunnel = await this.checkCloudflared();
    if (!tunnel.tunnelInstalled) throw new Error(this.lastError ?? "cloudflare tunnel client is not installed.");
    if (!tunnel.tunnelConfigValid) throw new Error(this.lastError ?? "cloudflare tunnel configuration is invalid.");
    this.releaseTunnelLease = await acquireBridgeTunnelLease([]);
  }
  /** Lease resources for the currently configured provider (one definition shared by acquire/spawn/stop/reclaim). */
  private currentTunnelLeaseResources(): string[] {
    return bridgeTunnelLeaseResources({
      provider: this.tunnelProvider,
      configuredDomain: this.configuredDomain,
      configuredNamedDomain: this.configuredNamedDomain,
      namedTunnelToken: this.namedTunnelToken,
    });
  }

  /** Tunnel binary image name for orphan identity verification (e.g. `ngrok.exe`). */
  private currentTunnelImage(): string {
    const isCloudflare = this.tunnelProvider === "cloudflare" || this.tunnelProvider === "cloudflare-named";
    const image = path.basename(isCloudflare ? this.cloudflaredExecutable : this.ngrokExecutable);
    return process.platform === "win32" && !image.toLowerCase().endsWith(".exe") ? `${image}.exe` : image;
  }

  /** Remember our tunnel child for the next holder's reclaim (singleton scopes only). */
  private recordOwnedTunnel(pid: number | undefined): void {
    const resources = this.currentTunnelLeaseResources();
    const localPort = this.currentLocalPort();
    if (!resources.length || pid === undefined || !localPort) {
      this.tunnelOwnerResources = undefined;
      this.tunnelOwnerPid = undefined;
      return;
    }
    this.tunnelOwnerResources = resources;
    this.tunnelOwnerPid = pid;
    recordTunnelOwnership(resources, {
      pid,
      image: this.currentTunnelImage(),
      provider: this.tunnelProvider === "cloudflare-named" ? "cloudflare-named" : "ngrok",
      domain: (this.tunnelProvider === "ngrok" ? this.configuredDomain : this.configuredNamedDomain).trim().toLowerCase(),
      localPort,
      startedAt: Date.now(),
    });
  }

  /** Forget our tunnel child (it exited or was stopped); never touches a successor's record. */
  private clearOwnedTunnelRecord(): void {
    if (this.tunnelOwnerResources?.length && this.tunnelOwnerPid !== undefined) {
      clearTunnelOwnership(this.tunnelOwnerResources, this.tunnelOwnerPid);
      this.tunnelOwnerResources = undefined;
      this.tunnelOwnerPid = undefined;
    }
  }

  /**
   * Reclaim a crashed previous holder's tunnel child; fail fast when the
   * survivor cannot be stopped (spawning a duelling second agent for the same
   * reserved endpoint would fail at the edge anyway).
   */
  private async reclaimPreviousTunnelOwner(): Promise<void> {
    const resources = this.currentTunnelLeaseResources();
    if (!resources.length) return;
    const outcome = await reclaimStaleTunnelOwner(resources, this.currentTunnelImage());
    if (outcome.action === "reclaimed") {
      this.output.appendLine(`[bridge] reclaimed the previous ${this.tunnelProvider} tunnel (pid ${outcome.pid}) left behind by an unclean shutdown.`);
    } else if (outcome.action === "failed") {
      throw new Error(`Previous ${this.tunnelProvider} tunnel (pid ${outcome.pid}) is still running and could not be stopped: ${outcome.reason}. Stop it manually and retry.`);
    } else if (outcome.reason !== "no ownership record") {
      this.output.appendLine(`[bridge] previous-tunnel reclaim skipped (${outcome.reason}).`);
    }
  }


  private async startInternal(domain?: string): Promise<BridgeStatus> {
    // Final defense-in-depth boundary. Authorization happens before state changes,
    // local TCP listeners, MCP sessions, or tunnel processes are created.
    try {
      await this.authorizeStart();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.state = "error";
      throw error;
    }
    this.stoppingResources = false;
    this.state = "starting";
    this.lastError = undefined;
    try {
      if (!this.routeToken) await this.initialize();
      this.tunnelProvider = this.readTunnelProvider();
      if (this.tunnelProvider === "ngrok") {
        const resolvedDomain = domain ?? (this.configuredDomain || this.readConfiguredDomain() || this.readPersistedDomain());
        await this.persistDomain(resolvedDomain);
      } else if (this.tunnelProvider === "cloudflare-named") {
        this.namedTunnelToken = await this.context.secrets.get(CLOUDFLARE_NAMED_TOKEN_SECRET) ?? "";
        this.restoreConfiguredNamedDomain();
        this.namedTunnelLocalPort = this.readNamedTunnelLocalPort();
        this.domain = this.configuredNamedDomain;
      } else {
        this.domain = "";
      }

      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) throw new Error("Open a workspace folder before starting the Bridge.");

      const tunnel = await this.checkTunnel();
      if (!tunnel.tunnelInstalled) throw new Error(this.lastError ?? `${this.tunnelProvider} tunnel client is not installed.`);
      if (!tunnel.tunnelConfigValid) throw new Error(this.lastError ?? `${this.tunnelProvider} tunnel configuration is invalid.`);

      // Reserve fixed endpoints across windows and instances before opening
      // listeners or spawning a connector. A second window whose configured
      // provider is held elsewhere falls back to provider #1 (cloudflare)
      // instead of failing; see acquireTunnelLeaseOrFallbackToCloudflare.
      await this.acquireTunnelLeaseOrFallbackToCloudflare();

      await this.mcpTransport.start({
      provider: this.tunnelProvider,
      routeToken: this.routeToken,
      namedTunnelLocalPort: this.namedTunnelLocalPort,
    });
      await this.verifyLocalHealth();
      // The lease is held and the local port is known: a previous holder that
      // died without cleanup (crash, hard kill) may have left its tunnel
      // child behind. Reclaim it before spawning ours (singleton scopes only;
      // a cloudflare fallback is a no-op here).
      await this.reclaimPreviousTunnelOwner();
      await this.startTunnelOnce();

      this.state = "running";
      const publicUrl = this.getStatus().publicUrl;
      this.output.appendLine(`[bridge] running ${publicUrl} -> 127.0.0.1:${this.currentLocalPort()}`);
      return this.getStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.state = "error";
      await this.stopResources(false);
      throw error;
    }
  }


  private async verifyLocalHealth(): Promise<void> {
    if (!this.currentLocalPort()) throw new Error("Bridge local HTTP port is unavailable after startup.");
    const url = new URL(`http://127.0.0.1:${this.currentLocalPort()}/healthz/${this.routeToken}`);
    let response: Response;
    try {
      response = await fetch(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(3_000) });
    } catch (error) {
      throw new Error(`Bridge local HTTP health check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new Error(`Bridge local HTTP health check returned HTTP ${response.status}.`);
    const payload = await response.json().catch(() => undefined) as { ok?: unknown } | undefined;
    if (payload?.ok !== true) throw new Error("Bridge local HTTP health check did not confirm readiness.");
    this.output.appendLine(`[bridge] local health verified: ${url}`);
  }

  private tunnelProcessEnvironment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (this.tunnelProvider === "ngrok") {
      return this.ngrokProcessEnvironment(env);
    }
    const httpConfiguration = vscode.workspace.getConfiguration("http");
    const proxySupport = httpConfiguration.get<string>("proxySupport");
    const configuredProxy = httpConfiguration.get<string>("proxy")?.trim();
    if (proxySupport !== "off") {
      const proxyUrl = resolveExtensionHostProxy(new URL("https://www.cloudflare.com/"), configuredProxy);
      if (proxyUrl) {
        const forceConfiguredProxy = Boolean(configuredProxy);
        const hasAllProxy = Boolean(env.ALL_PROXY || env.all_proxy);
        if (forceConfiguredProxy || (!env.HTTPS_PROXY && !env.https_proxy && !hasAllProxy)) env.HTTPS_PROXY = proxyUrl;
        if (forceConfiguredProxy || (!env.HTTP_PROXY && !env.http_proxy && !hasAllProxy)) env.HTTP_PROXY = proxyUrl;
        this.output.appendLine("[bridge] tunnel process will use configured/system HTTP proxy settings.");
      }
    }
    if (this.tunnelProvider === "cloudflare-named") env.TUNNEL_TOKEN = this.namedTunnelToken;
    return env;
  }

  /**
   * ngrok Free rejects agents that connect through an HTTP/S proxy with
   * ERR_NGROK_9009, so the ngrok process runs in direct mode by default and
   * inherited proxy variables are stripped (both case variants). Users with
   * an ngrok Pay-as-you-go plan can opt into the resolved proxy explicitly
   * via shuncode.bridge.ngrokUseHttpProxy.
   */
  private ngrokProcessEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    if (this.ngrokUseHttpProxyEnabled()) {
      const httpConfiguration = vscode.workspace.getConfiguration("http");
      const configuredProxy = httpConfiguration.get<string>("proxy")?.trim();
      const proxyUrl = httpConfiguration.get<string>("proxySupport") === "off"
        ? undefined
        : resolveExtensionHostProxy(new URL("https://www.cloudflare.com/"), configuredProxy);
      if (proxyUrl) {
        env.HTTPS_PROXY = proxyUrl;
        env.HTTP_PROXY = proxyUrl;
        this.output.appendLine("[bridge] ngrok process will use the resolved HTTP proxy (shuncode.bridge.ngrokUseHttpProxy); this requires an ngrok Pay-as-you-go plan.");
      } else {
        this.output.appendLine("[bridge] shuncode.bridge.ngrokUseHttpProxy is enabled, but no HTTP proxy was resolved; the ngrok process will connect directly.");
      }
      return env;
    }
    for (const key of Object.keys(env)) {
      if (/^(https?|all)_proxy$/i.test(key)) delete env[key];
    }
    this.output.appendLine("[bridge] ngrok process will connect directly; inherited proxy variables were removed (ngrok Free rejects HTTP proxies with ERR_NGROK_9009).");
    return env;
  }

  private ngrokUseHttpProxyEnabled(): boolean {
    return vscode.workspace.getConfiguration("shuncode").get<boolean>(NGROK_USE_HTTP_PROXY_SETTING, false) === true;
  }

  private startTunnelProcess(): ChildProcessWithoutNullStreams {
    if (this.stoppingResources || this.stopTunnelProcessInFlight) {
      throw new Error("Bridge is stopping; refusing to start a new tunnel process.");
    }
    if (this.tunnelProcess) {
      throw new Error("A Bridge tunnel process is still active; wait for it to exit before starting another.");
    }
    if (!this.currentLocalPort()) throw new Error("Bridge local HTTP port is unavailable.");
    const isCloudflare = this.tunnelProvider === "cloudflare" || this.tunnelProvider === "cloudflare-named";
    const command = isCloudflare ? this.cloudflaredExecutable : this.ngrokExecutable;
    const commandLabel = isCloudflare ? "cloudflared" : "ngrok";
    const args = this.tunnelProvider === "cloudflare"
      ? ["tunnel", "--url", `http://127.0.0.1:${this.currentLocalPort()}`]
      : this.tunnelProvider === "cloudflare-named"
        ? ["tunnel", "run"]
        : ["http", String(this.currentLocalPort()), "--url", `https://${this.configuredDomain}`, "--log=stdout", "--log-format=json"];
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: this.tunnelProcessEnvironment(),
    });
    this.tunnelProcess = child;
    this.recordOwnedTunnel(child.pid);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.output.append(`[${commandLabel}] ${String(chunk)}`));
    child.stderr.on("data", (chunk) => this.output.append(`[${commandLabel}] ${String(chunk)}`));
    child.on("error", (error) => {
      if (this.tunnelProcess !== child || this.stopTunnelProcessInFlight) return;
      this.output.appendLine(`[${commandLabel}] process error: ${error.message}`);
      this.lastError = error.message;
      if (!this.stoppingResources && this.mcpTransport.isListening() && this.state === "running") {
        if (this.tunnelProvider === "cloudflare") this.domain = "";
        this.state = "starting";
        this.revision += 1;
        const generation = this.tunnelGeneration;
        void this.stopTunnelProcess().then(() => {
          if (generation === this.tunnelGeneration && !this.stoppingResources && this.mcpTransport.isListening()) this.beginTunnelRecovery();
        }).catch((stopError: unknown) => {
          if (generation !== this.tunnelGeneration || this.stoppingResources) return;
          this.state = "error";
          this.lastError = stopError instanceof Error ? stopError.message : String(stopError);
          this.revision += 1;
        });
      }
    });
    child.on("exit", (code, signal) => {
      if (this.tunnelProcess !== child || this.stopTunnelProcessInFlight) return;
      this.tunnelProcess = undefined;
      if (!this.stoppingResources && this.mcpTransport.isListening() && this.state === "running") {
        const message = `${commandLabel} exited unexpectedly (code=${String(code)}, signal=${String(signal)}); reconnecting without stopping the local MCP server.`;
        this.output.appendLine(`[bridge] ${message}`);
        this.lastError = message;
        if (this.tunnelProvider === "cloudflare") this.domain = "";
        this.state = "starting";
        this.revision += 1;
        this.beginTunnelRecovery();
      }
    });
    return child;
  }

  private async waitForTunnelStartup(child: ChildProcessWithoutNullStreams): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let output = "";
      let quickTunnelUrlReceived = false;
      let quickTunnelEdgeRegistered = false;
      const cleanup = () => {
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("error", onError);
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error); else resolve();
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        const detail = output.trim().slice(-4_000);
        finish(new Error(`${this.tunnelProvider} tunnel exited during startup (code=${String(code)}, signal=${String(signal)}).${detail ? ` ${detail}` : ""}`));
      };
      const onError = (error: Error) => finish(error);
      const onData = (chunk: Buffer | string) => {
        output = `${output}${String(chunk)}`.slice(-16_000);
        const lower = output.toLowerCase();
        if (this.tunnelProvider === "cloudflare") {
          const matches = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/ig);
          const tunnelUrl = matches?.find((candidate) => new URL(candidate).hostname.toLowerCase() !== "api.trycloudflare.com");
          if (tunnelUrl) {
            this.domain = new URL(tunnelUrl).hostname.toLowerCase();
            this.revision += 1;
            quickTunnelUrlReceived = true;
          }
          if (lower.includes("registered tunnel connection") || lower.includes("connection registered")) {
            quickTunnelEdgeRegistered = true;
          }
          if (quickTunnelUrlReceived && quickTunnelEdgeRegistered) {
            finish();
          }
          return;
        }
        if (this.tunnelProvider === "cloudflare-named") {
          if (lower.includes("invalid tunnel token") || lower.includes("failed to parse token") || lower.includes("authentication failed") || lower.includes("unauthorized")) {
            finish(new Error(`Cloudflare Named Tunnel authentication failed. Rotate or recopy the Tunnel Token. ${output.trim().slice(-4_000)}`));
            return;
          }
          if (lower.includes("registered tunnel connection") || lower.includes("connection registered") || lower.includes("initial protocol")) {
            finish();
          }
          return;
        }
        if (lower.includes('"msg":"started tunnel"') && lower.includes(this.configuredDomain.toLowerCase())) {
          finish();
          return;
        }
        if (lower.includes("err_ngrok_9009") || lower.includes("pay-as-you-go")) {
          finish(new Error(`ngrok cannot run through an HTTP/S proxy on the Free plan (ERR_NGROK_9009). Bridge starts ngrok with proxy variables removed, so check the ngrok config file (for example %LOCALAPPDATA%\\ngrok\\ngrok.yml) for a proxy_url entry and remove it, switch the proxy client to TUN mode with the system proxy off, or upgrade ngrok to a Pay-as-you-go plan and set shuncode.bridge.ngrokUseHttpProxy to reuse this proxy. ${output.trim().slice(-2_000)}`));
          return;
        }
        if (lower.includes("err_ngrok_") || lower.includes("endpoint is already online") || lower.includes("failed to start tunnel")) {
          finish(new Error(`ngrok failed to establish the reserved domain. ${output.trim().slice(-4_000)}`));
        }
      };
      child.once("exit", onExit);
      child.once("error", onError);
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      // Quick Tunnel is ready only after cloudflared both allocates its hostname and registers an
      // edge connection. Public HTTPS health is intentionally not a startup gate because this PC's
      // outbound proxy/VPN path can differ from the remote MCP client's path to the public endpoint.
      const timer = setTimeout(() => {
        if (this.tunnelProvider === "cloudflare") {
          const reason = quickTunnelUrlReceived
            ? "cloudflared created a trycloudflare.com URL but did not register a Cloudflare edge connection within 120 seconds"
            : "cloudflared did not provide a trycloudflare.com URL within 120 seconds";
          finish(new Error(`${reason}.${cloudflaredEdgeFailureHint(output)} ${output.trim().slice(-4_000)}`));
        } else {
          finish();
        }
      }, this.tunnelProvider === "cloudflare" ? 120_000 : 5_000);
    });
  }

  private publicHealthUrl(): string {
    return `https://${this.domain}/healthz/${this.routeToken}`;
  }

  private async requestPublicHealth(totalTimeoutMs = PUBLIC_HEALTH_REQUEST_TIMEOUT_MS * 3): Promise<{ ok: true } | { ok: false; failure: PublicHealthFailure }> {
    try {
      const url = new URL(this.publicHealthUrl());
      const headers = this.tunnelProvider === "ngrok" ? { "ngrok-skip-browser-warning": "true" } : undefined;
      const httpConfiguration = vscode.workspace.getConfiguration("http");
      const configuredProxy = httpConfiguration.get<string>("proxy")?.trim();
      const proxySupport = httpConfiguration.get<string>("proxySupport");
      const proxyUrl = proxySupport === "off" ? undefined : resolveExtensionHostProxy(url, configuredProxy);
      const boundedTimeoutMs = Math.max(1_000, Math.min(totalTimeoutMs, PUBLIC_HEALTH_REQUEST_TIMEOUT_MS * 3));
      const response = await fetchWithExtensionHostFallbacks(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(boundedTimeoutMs),
        proxyUrl,
        rejectUnauthorized: httpConfiguration.get<boolean>("proxyStrictSSL", true),
        useElectron: proxySupport !== "off",
        attemptTimeoutMs: Math.min(PUBLIC_HEALTH_REQUEST_TIMEOUT_MS, boundedTimeoutMs),
      });
      if (!response.ok) {
        return { ok: false, failure: { reason: `HTTP ${response.status} ${response.statusText ?? ""}`.trim(), code: `HTTP_${response.status}`, status: response.status, deterministic: false } };
      }
      const payload = await response.json().catch(() => undefined) as { ok?: unknown } | undefined;
      return payload?.ok === true
        ? { ok: true }
        : { ok: false, failure: { reason: "health response did not confirm ok", status: response.status, deterministic: false } };
    } catch (error) {
      return { ok: false, failure: publicHealthFailure(error) };
    }
  }

  private async waitForPublicHealth(child: ChildProcessWithoutNullStreams): Promise<void> {
    const configuredTimeout = vscode.workspace.getConfiguration("shuncode").get<number>(PUBLIC_HEALTH_STARTUP_TIMEOUT_SETTING, DEFAULT_PUBLIC_HEALTH_STARTUP_TIMEOUT_MS);
    const timeoutMs = typeof configuredTimeout === "number" && Number.isFinite(configuredTimeout)
      ? Math.min(Math.max(configuredTimeout, 5_000), 120_000)
      : DEFAULT_PUBLIC_HEALTH_STARTUP_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    let consecutiveDeterministicFailures = 0;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null || this.tunnelProcess !== child) {
        throw new Error(`${this.tunnelProvider} tunnel exited before the public Bridge health endpoint became reachable.`);
      }
      const result = await this.requestPublicHealth(Math.max(1_000, deadline - Date.now()));
      if (result.ok) return;
      consecutiveDeterministicFailures = result.failure.deterministic ? consecutiveDeterministicFailures + 1 : 0;
      if (result.failure.deterministic && consecutiveDeterministicFailures >= PUBLIC_HEALTH_DETERMINISTIC_FAILURE_LIMIT) {
        throw new Error(this.publicHealthUnreachableMessage(result.failure));
      }
      await new Promise<void>((resolve) => setTimeout(resolve, PUBLIC_HEALTH_POLL_INTERVAL_MS));
    }
    if (this.tunnelProvider === "cloudflare-named") {
      throw new Error(`Cloudflare Named Tunnel connected, but ${this.publicHealthUrl()} could not reach Bridge. In Cloudflare Tunnels, set the published application hostname to ${this.configuredNamedDomain} and its Service URL to http://127.0.0.1:${this.namedTunnelLocalPort}.`);
    }
    throw new Error(`Public Bridge health check timed out after ${Math.round(timeoutMs / 1000)} seconds: ${this.publicHealthUrl()}`);
  }

  private publicHealthUnreachableMessage(failure: PublicHealthFailure): string {
    const httpConfiguration = vscode.workspace.getConfiguration("http");
    const hasProxy = Boolean(httpConfiguration.get<string>("proxy")?.trim()
      || process.env.HTTPS_PROXY || process.env.https_proxy
      || process.env.HTTP_PROXY || process.env.http_proxy);
    const guidance = hasProxy
      ? "The health request was routed through the configured HTTP proxy and still failed. Verify the proxy can reach Cloudflare, or enable a system/global (TUN) proxy."
      : "This machine cannot reach the public endpoint directly. Set http.proxy to a working HTTP proxy or enable a system/global (TUN) proxy so the health check can route around the block.";
    return `Public Bridge health endpoint unreachable: ${this.publicHealthUrl()} (${failure.reason}). ${guidance}`;
  }

  /** True only for ngrok's "endpoint is already online" (stale edge session after a restart). */
  private isEndpointAlreadyOnlineFailure(error: unknown): boolean {
    if (this.tunnelProvider !== "ngrok") return false;
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return message.includes("err_ngrok_334") || message.includes("is already online");
  }

  private async startTunnelOnce(): Promise<void> {
    const generation = this.tunnelGeneration;
    for (let attempt = 0; ; attempt++) {
      const child = this.startTunnelProcess();
      try {
        await this.waitForTunnelStartup(child);
        // Quick Tunnel and ngrok can be reachable by the remote MCP client even when this PC cannot
        // hairpin through its own proxy/VPN to the public hostname. Only the user-managed Cloudflare
        // Named Tunnel keeps public health as a fatal startup gate because its hostname/service route
        // is actionable configuration.
        if (this.tunnelProvider === "cloudflare") {
          this.output.appendLine(`[bridge] quick tunnel URL received and Cloudflare edge connection registered; local health is ready and public health is not used as a startup gate: ${this.publicHealthUrl()}`);
        } else if (this.tunnelProvider === "ngrok") {
          this.output.appendLine(`[bridge] ngrok reserved endpoint started; local health is ready and public health is not used as a startup gate: ${this.publicHealthUrl()}`);
        } else {
          await this.waitForPublicHealth(child);
          this.output.appendLine(`[bridge] public health verified: ${this.publicHealthUrl()}`);
        }
        if (this.tunnelProcess !== child) throw new Error(`${this.tunnelProvider} tunnel changed before health verification completed.`);
        return;
      } catch (error) {
        if (this.tunnelProcess === child) await this.stopTunnelProcess();
        else this.clearOwnedTunnelRecord();
        if (!this.isEndpointAlreadyOnlineFailure(error) || attempt >= NGROK_ENDPOINT_ONLINE_RETRY_BACKOFF_MS.length) {
          if (this.isEndpointAlreadyOnlineFailure(error)) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(`${detail} The ngrok endpoint is still held by another agent session; check https://dashboard.ngrok.com/endpoints and stop the other agent, then retry.`);
          }
          throw error;
        }
        if (generation !== this.tunnelGeneration || this.stoppingResources || this.disposed) throw error;
        const delayMs = NGROK_ENDPOINT_ONLINE_RETRY_BACKOFF_MS[attempt] ?? 30_000;
        const total = NGROK_ENDPOINT_ONLINE_RETRY_BACKOFF_MS.length + 1;
        this.lastError = `${error instanceof Error ? error.message : String(error)} Retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 2}/${total}).`;
        this.revision += 1;
        this.output.appendLine(`[bridge] ngrok endpoint is still online (a previous agent session has not timed out yet); retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 2}/${total}).`);
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        if (generation !== this.tunnelGeneration || this.stoppingResources || this.disposed) throw error;
      }
    }
  }

  /** Wait for the exact owned tunnel child to exit before releasing ownership. */
  private async stopTunnelProcess(): Promise<void> {
    if (this.stopTunnelProcessInFlight) return this.stopTunnelProcessInFlight;
    const child = this.tunnelProcess;
    if (!child) {
      // No live child (it already exited on its own): our ownership record —
      // if any — names a dead pid, so drop it without touching the kill path.
      this.clearOwnedTunnelRecord();
      return;
    }
    const run = Promise.resolve().then(() => this.terminateOwnedTunnelProcess(child));
    this.stopTunnelProcessInFlight = run;
    try {
      await run;
      if (this.tunnelProcess === child) this.tunnelProcess = undefined;
      // Only on success: a failed kill retains ownership (and the record) so
      // no replacement is started and the next holder reclaims the survivor.
      this.clearOwnedTunnelRecord();
    } finally {
      if (this.stopTunnelProcessInFlight === run) this.stopTunnelProcessInFlight = undefined;
    }
  }

  /**
   * Close only OUR ngrok tunnels via the local agent API, matched by local
   * port (a foreign agent on 4040 is left alone). Never throws: any failure
   * falls through to process termination.
   */
  private async closeOwnedNgrokTunnelsGracefully(): Promise<void> {
    const localPort = this.currentLocalPort();
    if (!localPort) return;
    let tunnels: unknown[];
    try {
      const response = await fetch(`${NGROK_AGENT_API_BASE_URL}/api/tunnels`, { signal: AbortSignal.timeout(NGROK_AGENT_API_TIMEOUT_MS) });
      if (!response.ok) return;
      const payload = await response.json().catch(() => undefined) as { tunnels?: unknown } | undefined;
      tunnels = Array.isArray(payload?.tunnels) ? payload.tunnels : [];
    } catch {
      return;
    }
    for (const entry of tunnels) {
      const tunnel = entry as { name?: unknown; config?: { addr?: unknown } } | null | undefined;
      const name = typeof tunnel?.name === "string" ? tunnel.name : "";
      const addr = typeof tunnel?.config?.addr === "string" ? tunnel.config.addr : "";
      if (!name || (addr !== String(localPort) && !addr.includes(`:${localPort}`))) continue;
      try {
        await fetch(`${NGROK_AGENT_API_BASE_URL}/api/tunnels/${encodeURIComponent(name)}`, { method: "DELETE", signal: AbortSignal.timeout(NGROK_AGENT_API_TIMEOUT_MS) });
        this.output.appendLine(`[bridge] closed ngrok tunnel '${name}' gracefully before shutdown.`);
      } catch {
        /* fall through to process termination */
      }
    }
  }

  private async terminateOwnedTunnelProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
    // A hard-killed ngrok leaves its endpoint online at the edge (stale
    // session → ERR_NGROK_334 on the next start), so close our tunnels
    // gracefully first. Best-effort: the SIGTERM/taskkill escalation below
    // still owns completion.
    if (this.tunnelProvider === "ngrok") {
      try {
        await this.closeOwnedNgrokTunnelsGracefully();
      } catch {
        /* escalation below owns completion */
      }
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let terminateTimer: ReturnType<typeof setTimeout> | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (terminateTimer) clearTimeout(terminateTimer);
        if (killTimer) clearTimeout(killTimer);
        child.off("exit", onExit);
        child.off("close", onExit);
        child.off("error", onError);
        if (error) reject(error); else resolve();
      };
      const onExit = () => finish();
      const onError = (error: Error) => finish(error);
      const forceKill = () => {
        if (child.exitCode !== null || child.signalCode !== null) { finish(); return; }
        if (process.platform === "win32" && child.pid) {
          void execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: TUNNEL_KILL_GRACE_MS }).catch(() => {
            try { child.kill("SIGKILL"); } catch { /* exit listener owns completion */ }
          });
        } else {
          try { child.kill("SIGKILL"); } catch { /* exit listener owns completion */ }
        }
        killTimer = setTimeout(() => {
          finish(new Error("Bridge tunnel process did not exit after graceful termination and force kill; its ownership is retained and a replacement will not be started."));
        }, TUNNEL_KILL_GRACE_MS);
        killTimer.unref?.();
      };
      child.once("exit", onExit);
      child.once("close", onExit);
      child.once("error", onError);
      terminateTimer = setTimeout(forceKill, TUNNEL_TERMINATE_GRACE_MS);
      terminateTimer.unref?.();
      try { child.kill("SIGTERM"); } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private isDeterministicTunnelFailure(message: string): boolean {
    if (this.tunnelProvider !== "ngrok") return false;
    const lower = message.toLowerCase();
    return lower.includes("err_ngrok_9009") || lower.includes("pay-as-you-go") || lower.includes("authentication failed");
  }

  private beginTunnelRecovery(): void {
    if (this.stoppingResources || !this.mcpTransport.isListening()) return;
    if (this.tunnelRecoveryPromise && this.tunnelRecoveryGeneration === this.tunnelGeneration) return;
    const generation = this.tunnelGeneration;
    const recovery = (async () => {
      let attempt = 0;
      while (!this.stoppingResources && this.mcpTransport.isListening() && generation === this.tunnelGeneration) {
        const delayMs = TUNNEL_RESTART_BACKOFF_MS[Math.min(attempt, TUNNEL_RESTART_BACKOFF_MS.length - 1)];
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        if (this.stoppingResources || !this.mcpTransport.isListening() || generation !== this.tunnelGeneration) return;
        try {
          this.output.appendLine(`[bridge] ${this.tunnelProvider} reconnect attempt ${attempt + 1}...`);
          await this.startTunnelOnce();
          if (generation !== this.tunnelGeneration || this.stoppingResources) return;
          this.state = "running";
          this.lastError = undefined;
          this.revision += 1;
          this.output.appendLine(`[bridge] ${this.tunnelProvider} tunnel recovered: ${this.getStatus().publicUrl}`);
          return;
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
          this.output.appendLine(`[bridge] ${this.tunnelProvider} reconnect attempt ${attempt + 1} failed: ${this.lastError}`);
          if (this.isDeterministicTunnelFailure(this.lastError)) {
            this.output.appendLine(`[bridge] ${this.tunnelProvider} stopped reconnecting: this failure is deterministic and will not resolve by retrying.`);
            return;
          }
          attempt += 1;
        }
      }
    });
    let trackedRecovery!: Promise<void>;
    trackedRecovery = recovery().finally(() => {
      if (this.tunnelRecoveryPromise === trackedRecovery) {
        this.tunnelRecoveryPromise = undefined;
        this.tunnelRecoveryGeneration = undefined;
      }
    });
    this.tunnelRecoveryGeneration = generation;
    this.tunnelRecoveryPromise = trackedRecovery;
  }

  takeToolCallsSinceLastReport(): number {
    return this.dispatcher.takeToolCallsSinceLastReport();
  }

  returnToolCallsSinceLastReport(count: number): void {
    this.dispatcher.returnToolCallsSinceLastReport(count);
  }

  /** Master switch for Agent Skills; JSON manifests are never affected. */
  private skillsEnabled(): boolean {
    return vscode.workspace.getConfiguration("shuncode").get<boolean>(BRIDGE_SKILLS_ENABLED_SETTING, true);
  }

  private workspaceRoots(): string[] {
    const roots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
    if (!roots.length) throw new Error("No workspace folder is open.");
    return roots;
  }

  async stop(): Promise<BridgeStatus> {
    await this.stopResources(true);
    return this.getStatus();
  }

  private async stopResources(markStopped: boolean): Promise<void> {
    if (!this.stoppingResources) this.tunnelGeneration += 1;
    this.stoppingResources = true;
    try {
      // Session teardown must never skip the tunnel kill below: a throw here
      // used to orphan the ngrok/cloudflared child on quit. Log and continue.
      try {
        this.mcpTransport.destroySessionsAndStopPruning();
      } catch (error) {
        this.output.appendLine(`[bridge] session teardown failed during stop (continuing to tunnel shutdown): ${error instanceof Error ? error.message : String(error)}`);
      }
      await this.stopTunnelProcess();
      await this.mcpTransport.closeListener();
      if (this.releaseTunnelLease) {
        const release = this.releaseTunnelLease;
        this.releaseTunnelLease = undefined;
        try {
          await release();
        } catch (error) {
          this.output.appendLine(`[bridge] tunnel lease release failed during stop (continuing): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (this.tunnelProvider === "cloudflare") this.domain = "";
      if (markStopped) {
        this.state = "stopped";
        this.lastError = undefined;
        this.output.appendLine("[bridge] stopped");
      }
    } catch (error) {
      this.state = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.stoppingResources = false;
    }
  }

  async disposeAsync(): Promise<void> {
    this.disposed = true;
    await this.stopResources(true);
  }

  dispose(): void {
    this.disposed = true;
    void this.stopResources(true).catch((error) => {
      this.output.appendLine(`[bridge] shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

