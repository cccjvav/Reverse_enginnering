import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import { WorkspaceHubStore, hubChatKey } from "./workspace-hub-store.js";
import type { HubChatFrame, HubWindow, HubWorkspace } from "./workspace-hub-types.js";
import type { BridgeManager } from "./bridge-server.js";
import { applicationBundleOf, applicationExecutableOf, devExecutableOverride, instanceIdentity, launchInstance, nextUserDataDirectory, seedInstanceSettings, userDataDirectoryOf } from "./instance-launcher.js";

/** The hub is machine-wide so that independent `--user-data-dir`
 * instances share one catalog. The root follows the carrier's
 * `appSharedDataHome` rule (`--shared-data-dir` > `$VSCODE_PORTABLE/shared-data`
 * > `~/.shuncode-shared`); the carrier main process exports the resolved
 * `--shared-data-dir` to every child (Extension Host included) as
 * `SHUNCODE_SHARED_DATA_HOME` (vscode-main/src/vs/code/electron-main/main.ts,
 * `patchEnvironment`), and `openNewInstance` forwards it to spawned instances.
 */
export function workspaceHubRoot(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const explicit = env.SHUNCODE_SHARED_DATA_HOME?.trim();
  if (explicit) return path.join(path.resolve(explicit), "workspace-hub");
  const portable = env.VSCODE_PORTABLE?.trim();
  if (portable) return path.join(path.resolve(portable), "shared-data", "workspace-hub");
  return path.join(home, ".shuncode-shared", "workspace-hub");
}

/** Code-OSS stores extension workspace state under
 * `<user-data-dir>/User/workspaceStorage/<workspaceId>/<extension.id>`.
 * `<workspaceId>` is derived from the folder/workspace file only (see
 * `vscode-main/src/vs/platform/workspaces/node/workspaces.ts`), so it is the
 * identity that stays equal for the same project across windows, reloads and
 * `--user-data-dir` instances.
 */
function workspaceStorageIdentity(storageUri: vscode.Uri): string {
  const segments = storageUri.path.split("/").filter(Boolean);
  const workspaceId = segments.at(-2);
  if (segments.length >= 3 && segments.at(-3) === "workspaceStorage" && workspaceId) return workspaceId;
  return storageUri.toString();
}

/** Hub workspace identity: workspace-stable across windows, reloads and
 * instances. This is deliberately NOT the per-window Bridge identity: mixing
 * the window session into the hub id orphaned every record on reload (each
 * reload re-imported the same chats under fresh keys) and rejected
 * cross-window continuation on the same folder.
 */
export function hubWorkspaceId(storageUri: vscode.Uri | undefined): string {
  if (!storageUri) return "empty";
  return createHash("sha256").update(`shuncode-hub-workspace-v1::${workspaceStorageIdentity(storageUri)}`).digest("hex");
}

function currentWorkspace(context: vscode.ExtensionContext): HubWorkspace {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const file = vscode.workspace.workspaceFile;
  const uri = file?.scheme === "file" ? file : folders.length === 1 && folders[0].uri.scheme === "file" ? folders[0].uri : undefined;
  return { id: hubWorkspaceId(context.storageUri), name: vscode.workspace.name ?? "未打开项目", uri: uri?.toString(), kind: uri ? file ? "workspace" : "folder" : "empty", folders: folders.map(f => f.uri.toString()) };
}
function frame(value: unknown): HubChatFrame {
  if (!value || typeof value !== "object") throw new Error("Invalid chat sync frame.");
  return value as HubChatFrame; // The store performs full bounds/schema checks.
}

/** Local-only command surface. None of these commands is added to public MCP. */
export class WorkspaceHubController implements vscode.Disposable {
  readonly store: WorkspaceHubStore;
  readonly userDataDir: string;
  readonly instanceId: string;
  private readonly ready: Promise<void>;
  private readonly subscriptions: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private ticking: Promise<void> | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private disposed = false;
  private syncError: string | undefined;
  private selectedChat: string | undefined;
  private desiredTab: "workspaces" | "chats" = "workspaces";
  private lastPanelSnapshot = "";
  private lastPanelChatRevision = "";

  constructor(private readonly context: vscode.ExtensionContext, private readonly bridge: BridgeManager, private readonly output: vscode.OutputChannel) {
    this.userDataDir = userDataDirectoryOf(context.globalStorageUri.fsPath);
    this.instanceId = instanceIdentity(this.userDataDir);
    this.store = new WorkspaceHubStore(workspaceHubRoot(), randomUUID(), currentWorkspace(context));
    this.ready = this.store.initialize();
    const register = (name: string, callback: (...args: any[]) => unknown) => this.subscriptions.push(vscode.commands.registerCommand(`shuncode.workspaceHub.${name}`, callback));
    register("open", () => this.open());
    register("openChats", () => this.open("chats"));
    register("snapshot", () => this.snapshot());
    register("beginChat", async value => { await this.ensure(); const id = await this.store.beginGeneration(frame(value)); await this.publishWindow().catch(e => this.output.appendLine(`[workspace-hub] heartbeat: ${String(e)}`)); return id; });
    register("publishChat", async (value, importing = false) => {
      await this.ensure();
      try { const result = await this.store.publishChat(frame(value), importing === true); this.syncError = undefined; return result; }
      catch (e) { this.syncError = "共享记录同步失败，请查看本窗口 ShunCode 日志。"; throw e; }
    });
    register("finishChat", async value => { await this.ready; await this.store.finishGeneration(frame(value)); await this.publishWindow(); });
    register("deleteChat", async (resource: unknown) => { await this.ensure(); if (typeof resource !== "string") throw new Error("Invalid session resource."); await this.store.deleteChat(resource); });
    register("prepareContinuation", async (key: unknown) => {
      await this.ensure(); if (typeof key !== "string") throw new Error("Invalid chat key.");
      const before = await this.store.readChat(key);
      const chat = await this.store.prepareContinuation(key);
      return { key, wasOwner: before?.ownerWindowId === this.store.windowId, workspace: chat.workspace, sessionResource: chat.sessionResource, data: chat.data };
    });
    register("importedKeys", async () => { await this.ensure(); return (await this.store.listChats()).filter(c => c.workspace.id === this.store.workspace.id).map(c => c.key); });
    register("chatKey", (resource: string) => hubChatKey(this.store.workspace.id, resource));
    register("readChat", async (key: string) => { await this.ensure(); return this.store.readChat(key); });
    this.subscriptions.push(vscode.commands.registerCommand("shuncode.openNewInstance", (args?: { folderUri?: string | vscode.Uri; fileUri?: string | vscode.Uri }) => this.openNewInstance(args)));
    this.ready.then(() => {
      if (this.disposed) return;
      void this.sweepSupersededRecords();
      void this.refresh();
      void Promise.resolve(vscode.commands.executeCommand("shuncode.chat.ensureSharedSync")).catch(() => { this.syncError = "聊天同步组件未加载，请使用包含本功能的完整 ShunCode 构建。"; });
      this.timer = setInterval(() => { void this.refresh(); }, 1000);
      this.timer.unref();
    }, e => this.output.appendLine(`[workspace-hub] initialization failed: ${String(e)}`));
  }
  private async ensure(): Promise<void> {
    await this.ready;
    if (this.disposed) throw new Error("Workspace hub is closed.");
    if (currentWorkspace(this.context).id !== this.store.workspace.id) throw new Error("工作区已变化，请重新加载窗口后使用共享聊天。");
  }
  /** Tombstone duplicate records left by the old per-window workspace identity.
   * Idempotent; records that are still generating are skipped and retried on a
   * later start.
   */
  private async sweepSupersededRecords(): Promise<void> {
    try {
      await this.ensure();
      const swept = await this.store.sweepSupersededChatRecords();
      if (swept > 0) this.output.appendLine(`[workspace-hub] removed ${swept} superseded shared chat record(s) from the previous workspace identity.`);
    } catch (e) {
      this.output.appendLine(`[workspace-hub] migration sweep skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  private async publishWindow(): Promise<void> {
    if (this.disposed) return;
    await this.ensure();
    const status = this.bridge.getStatus();
    const value: HubWindow = { version: 1, windowId: this.store.windowId, workspace: this.store.workspace, updatedAt: Date.now(),
      bridge: { state: status.state, provider: status.tunnelProvider, domain: status.domain, localPort: status.localPort, connected: status.connected, todos: status.todos },
      activeChats: [], syncError: this.syncError, instanceId: this.instanceId, userDataDir: this.userDataDir, pid: process.pid };
    await this.store.publishWindow(value);
  }
  private async snapshot() {
    await this.ensure();
    const windows = await this.store.listWindows();
    // `ownPublicUrl` is in-memory only, for this window's own panel: the full
    // URL (with route token) never leaves the owning window and is never
    // written to the shared hub directory.
    const ownPublicUrl = this.bridge.getStatus().publicUrl ?? "";
    return { currentWindowId: this.store.windowId, currentInstanceId: this.instanceId, workspaceId: this.store.workspace.id, dataFolder: this.store.root, ownPublicUrl, syncEnabled: vscode.workspace.getConfiguration("shuncode").get<boolean>("chat.sharedHistory", true), windows, chats: await this.store.listChats(windows) };
  }
  private refresh(): Promise<void> {
    if (this.ticking || this.disposed) return this.ticking ?? Promise.resolve();
    this.ticking = (async () => {
      await this.publishWindow();
      await this.store.consumeRequests(
        async key => { await vscode.commands.executeCommand("shuncode.chat.openSharedSession", key); },
        async kind => {
          if (kind === "copy-address") { await this.copyOwnAddress(); return; }
          await vscode.commands.executeCommand("shuncode.chat.focusWindow");
        },
      );
      if (this.panel) {
        const snapshot = await this.snapshot();
        // Heartbeats are for liveness, not a reason to rebuild the whole DOM.
        const stable = JSON.stringify(snapshot, (key, value) => key === "updatedAt" ? undefined : value);
        if (stable !== this.lastPanelSnapshot) { this.lastPanelSnapshot = stable; await this.panel.webview.postMessage({ type: "snapshot", value: snapshot }); }
        if (this.selectedChat) {
          const key = this.selectedChat;
          const value = await this.store.readChat(key);
          if (key !== this.selectedChat) return;
          const revision = `${key}:${value?.revision ?? "missing"}:${value?.deleted}`;
          if (revision !== this.lastPanelChatRevision) {
            this.lastPanelChatRevision = revision;
            await this.panel.webview.postMessage({ type: "chat", key, value: value?.deleted ? undefined : value });
          }
        }
      }
    })().catch(e => { this.output.appendLine(`[workspace-hub] ${String(e)}`); }).finally(() => { this.ticking = undefined; });
    return this.ticking;
  }
  /** The route token lives in the owning window's Bridge state. Only the
   * owning window itself can copy its full address, so a copy for any other
   * window is delegated to it through a hub request; the token is never
   * re-derived from SecretStorage here and never crosses windows.
   */
  private async copyAddress(windowId: string): Promise<string> {
    const item = (await this.store.listWindows()).find(w => w.windowId === windowId);
    if (!item || item.bridge.state !== "running" || !item.bridge.domain) throw new Error("此窗口没有可用的 Bridge 地址。");
    if (item.windowId === this.store.windowId) return this.copyOwnPublicUrl();
    await this.store.requestWindowAction(item, "copy-address");
    return "已请求所属窗口复制地址；该窗口会把完整地址写入剪贴板。";
  }
  private async copyOwnPublicUrl(): Promise<string> {
    const status = this.bridge.getStatus();
    if (status.state !== "running" || !status.publicUrl) throw new Error("本窗口的 Bridge 未运行。");
    await vscode.env.clipboard.writeText(status.publicUrl);
    return "已复制完整地址，请像密码一样保管。";
  }
  private async copyOwnAddress(): Promise<void> {
    await this.copyOwnPublicUrl();
    void vscode.window.showInformationMessage("已按其他 ShunCode 窗口的请求复制本工作区的 Bridge 地址，请像密码一样保管。");
  }
  /** Last hop of continuation: no live window owns the workspace, so
   * a new independent instance is launched for that folder and the request is
   * left for whichever window of that workspace appears within the request TTL.
   */
  private async continueChat(key: string): Promise<void> {
    if (!vscode.workspace.getConfiguration("shuncode").get<boolean>("chat.sharedHistory", true)) throw new Error("共享聊天同步已关闭，请启用并重新加载窗口后继续。");
    const chat = await this.store.readChat(key);
    if (!chat || chat.deleted) throw new Error("共享记录不存在或已删除。");
    const windows = await this.store.listWindows(), owner = windows.find(w => w.windowId === chat.ownerWindowId);
    if (owner?.activeChats.includes(key)) throw new Error("原窗口仍在生成；其他窗口可以同步查看，完成后再继续。");
    if (owner?.windowId === this.store.windowId || (!owner && chat.workspace.id === this.store.workspace.id)) {
      await vscode.commands.executeCommand("shuncode.chat.openSharedSession", key); return;
    }
    if (owner) { await this.store.requestContinuation(chat, owner.windowId); return; }
    const existingWorkspace = windows.find(w => w.workspace.id === chat.workspace.id);
    if (existingWorkspace) { await this.store.requestContinuation(chat, existingWorkspace.windowId); return; }
    if (chat.workspace.uri) {
      await this.store.requestContinuation(chat);
      const target = chat.workspace.kind === "workspace" ? { fileUri: chat.workspace.uri } : { folderUri: chat.workspace.uri };
      await this.openNewInstance(target);
    } else if (chat.workspace.id === "empty") {
      await this.store.requestContinuation(chat);
      await vscode.commands.executeCommand("workbench.action.newWindow");
    } else throw new Error("原对话来自未保存的多根工作区。请先打开原工作区再继续，不能改在当前项目执行。");
  }
  /** `shuncode.openNewInstance`: a separate ShunCode process with its own
   * `--user-data-dir`. Live instances are read from the hub window registry.
   */
  async openNewInstance(args?: { folderUri?: string | vscode.Uri; fileUri?: string | vscode.Uri }): Promise<string> {
    await this.ready;
    const live = (await this.store.listWindows()).map(w => w.userDataDir).filter((v): v is string => typeof v === "string");
    const { directory, ordinal } = nextUserDataDirectory(this.userDataDir, live);
    const asString = (value: string | vscode.Uri | undefined) => value instanceof vscode.Uri ? value.toString() : typeof value === "string" ? value : undefined;
    const folderUri = asString(args?.folderUri), fileUri = asString(args?.fileUri);
    if (folderUri && fileUri) throw new Error("不能同时在新实例中打开文件夹和文件。");
    if (folderUri && !/^file:\/\//.test(folderUri)) throw new Error("只能在新实例中打开本地文件夹。");
    if (fileUri && !/^file:\/\//.test(fileUri)) throw new Error("只能在新实例中打开本地文件。");
    if (await seedInstanceSettings(directory, ordinal)) this.output.appendLine(`[workspace-hub] seeded ${directory} with Named Tunnel local port ${48271 + ordinal - 1}`);
    const environment: Record<string, string> = {};
    for (const key of ["SHUNCODE_SHARED_DATA_HOME", "VSCODE_PORTABLE", "SHUNCODE_AGENT_HOST_ENTRY", "VSCODE_DEV", "NODE_ENV"]) {
      const value = process.env[key]; if (value) environment[key] = value;
    }
    const developmentAppRoot = process.env.VSCODE_DEV ? vscode.env.appRoot : undefined;
    const target = folderUri ?? fileUri;
    // Awaited: launchInstance rejects when the launcher refuses the target. Without
    // this the webview reported success while nothing had started.
    const devExecutable = devExecutableOverride();
    if (devExecutable || process.platform === "win32") {
      const executable = devExecutable ?? applicationExecutableOf(process.execPath);
      if (!executable) throw new Error("无法定位 ShunCode 可执行文件，无法新开实例。");
      await launchInstance({ executable, userDataDir: directory, ordinal, folderUri, fileUri, environment });
    } else {
      const bundle = applicationBundleOf(process.execPath);
      if (!bundle) throw new Error("无法定位 ShunCode.app，无法新开实例。");
      await launchInstance({ bundle, userDataDir: directory, ordinal, folderUri, fileUri, developmentAppRoot, environment });
    }
    this.output.appendLine(`[workspace-hub] launched instance ${instanceIdentity(directory)} (${directory})${target ? ` for ${target}` : ""}`);
    return directory;
  }
  async open(tab: "workspaces" | "chats" = "workspaces"): Promise<void> {
    await this.ensure();
    this.desiredTab = tab;
    if (this.panel) { this.panel.reveal(); await this.panel.webview.postMessage({ type: "tab", value: tab }); return; }
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const panel = this.panel = vscode.window.createWebviewPanel("shuncode.workspaceHub", "工作区与共享聊天", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] });
    const nonce = randomBytes(18).toString("base64");
    const html = await readFile(vscode.Uri.joinPath(media, "workspace-hub.html").fsPath, "utf8");
    panel.webview.html = html.replaceAll("{{cspSource}}", panel.webview.cspSource).replaceAll("{{nonce}}", nonce)
      .replaceAll("{{scriptUri}}", panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "workspace-hub.js")).toString())
      .replaceAll("{{styleUri}}", panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "workspace-hub.css")).toString());
    panel.onDidDispose(() => { if (this.panel === panel) this.panel = undefined; this.selectedChat = undefined; this.lastPanelSnapshot = ""; this.lastPanelChatRevision = ""; });
    panel.webview.onDidReceiveMessage(async message => {
      try {
        await this.ensure();
        if (!message || typeof message.type !== "string") return;
        switch (message.type) {
          case "ready": this.lastPanelSnapshot = ""; await panel.webview.postMessage({ type: "tab", value: this.desiredTab }); await this.refresh(); break;
          case "selectChat":
            if (typeof message.key !== "string" || !/^[a-f0-9]{64}$/.test(message.key)) throw new Error("Invalid chat key.");
            this.selectedChat = message.key; this.lastPanelChatRevision = ""; await this.refresh(); break;
          case "continueChat": if (typeof message.key === "string") { await this.continueChat(message.key); await panel.webview.postMessage({ type: "notice", text: "已请求在所属工作区打开；不会自动发送消息。" }); } break;
          case "deleteChat": {
            if (typeof message.key !== "string" || !/^[a-f0-9]{64}$/.test(message.key)) throw new Error("Invalid chat key.");
            const target = await this.store.readChat(message.key);
            if (!target || target.deleted) throw new Error("共享记录不存在或已删除。");
            const pick = await vscode.window.showWarningMessage(`删除共享记录「${target.title || "未命名"}」（${target.workspace.name}）？原工作区的本地历史不受影响。`, { modal: true }, "删除");
            if (pick !== "删除") break;
            await this.store.deleteChatByKey(message.key);
            if (this.selectedChat === message.key) { this.selectedChat = undefined; this.lastPanelChatRevision = ""; }
            await panel.webview.postMessage({ type: "notice", text: "已删除共享记录。" });
            await this.refresh(); break;
          }
          case "copyAddress": if (typeof message.windowId === "string") { const text = await this.copyAddress(message.windowId); await panel.webview.postMessage({ type: "notice", text }); } break;
          case "focusWindow": {
            const item = (await this.store.listWindows()).find(w => w.windowId === message.windowId);
            if (!item) throw new Error("该窗口已不在线。");
            if (item.windowId === this.store.windowId) { await vscode.commands.executeCommand("shuncode.chat.focusWindow"); break; }
            await this.store.requestWindowAction(item, "focus"); break;
          }
          case "openWorkspace": {
            const item = (await this.store.listWindows()).find(w => w.windowId === message.windowId);
            if (!item?.workspace.uri) throw new Error("请先保存工作区，再从其他窗口打开。");
            if (item.workspace.kind !== "folder" && item.workspace.kind !== "workspace") throw new Error("多根工作区请在原实例中打开。");
            const target = item.workspace.kind === "workspace" ? { fileUri: item.workspace.uri } : { folderUri: item.workspace.uri };
            await this.openNewInstance(target);
            await panel.webview.postMessage({ type: "notice", text: "正在以独立实例打开该项目。" }); break;
          }
          case "chooseWorkspace": {
            const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: "在新实例打开" });
            if (selected?.[0]) { await this.openNewInstance({ folderUri: selected[0] }); await panel.webview.postMessage({ type: "notice", text: "已在独立实例中打开该项目。" }); } break;
          }
          case "newInstance": await this.openNewInstance(); await panel.webview.postMessage({ type: "notice", text: "已启动新的 ShunCode 实例。" }); break;
          case "openDataFolder": await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(this.store.root)); break;
        }
      } catch (e) { await panel.webview.postMessage({ type: "error", text: e instanceof Error ? e.message : String(e) }); }
    });
    this.lastPanelSnapshot = ""; await this.refresh();
  }
  async disposeAsync(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.panel?.dispose();
    for (const item of this.subscriptions) item.dispose();
    await this.ready.catch(() => {});
    await this.ticking;
    await this.store.dispose();
  }
  dispose(): void { void this.disposeAsync().catch(e => this.output.appendLine(`[workspace-hub] shutdown: ${String(e)}`)); }
}
