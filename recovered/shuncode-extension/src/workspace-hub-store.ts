import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { acquireBridgeTunnelLease } from "./bridge-tunnel-lease.js"; // Linux abstract socket / macOS path socket / Windows named pipe, same contract
import { HUB_MAX_CHAT_BYTES, HUB_REQUEST_TTL_MS, HUB_WINDOW_TTL_MS, type HubChat, type HubChatFrame, type HubChatSummary, type HubOpenRequest, type HubWindow, type HubWorkspace } from "./workspace-hub-types.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const safeKey = (value: string) => /^[a-f0-9]{64}$/.test(value);
const safeWindowId = (value: string) => /^[a-f0-9-]{36}$/.test(value);
const busy = "SHUNCODE_CHAT_WRITE_BUSY";
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const hubChatKey = (workspaceId: string, sessionResource: string) => digest(`${workspaceId}\n${sessionResource}`);

export function validHubWorkspace(value: unknown): value is HubWorkspace {
  if (!record(value) || typeof value.id !== "string" || !(safeKey(value.id) || value.id === "empty") || typeof value.name !== "string" || value.name.length > 300 || !Array.isArray(value.folders) || value.folders.length > 100 || value.folders.some(f => typeof f !== "string" || f.length > 8192)) return false;
  if (!["folder", "workspace", "empty"].includes(String(value.kind))) return false;
  return value.kind === "empty" ? value.uri === undefined : typeof value.uri === "string" && /^file:\/\//.test(value.uri) && value.uri.length <= 8192 && !/[\r\n]/.test(value.uri);
}
function parseFrame(frame: HubChatFrame): Record<string, unknown> {
  if (typeof frame.sessionId !== "string" || !frame.sessionId || frame.sessionId.length > 256 || /[\/\\\0]/.test(frame.sessionId)) throw new Error("Invalid chat session ID.");
  if (typeof frame.sessionResource !== "string" || !/^vscode-chat-session:\/\/local\/[A-Za-z0-9_=-]+$/.test(frame.sessionResource)) throw new Error("Only native local chat sessions can be shared.");
  if (!Number.isSafeInteger(frame.sequence) || frame.sequence < 0 || typeof frame.serialized !== "string" || Buffer.byteLength(frame.serialized) > HUB_MAX_CHAT_BYTES) throw new Error("Chat snapshot is invalid or exceeds 32 MiB. The original history is retained.");
  const canonicalResource = `vscode-chat-session://local/${Buffer.from(frame.sessionId).toString("base64url")}`;
  if (frame.sessionResource !== canonicalResource) throw new Error("Chat resource does not match its session ID.");
  const data: unknown = JSON.parse(frame.serialized);
  if (!record(data) || data.sessionId !== frame.sessionId || !Array.isArray(data.requests)) throw new Error("Invalid serialized chat snapshot.");
  // Viewing/restoring history must not enqueue unsent prompts or copy a draft.
  delete data.inputState;
  delete data.pendingRequests;
  return data;
}
function titleOf(data: Record<string, unknown>): string {
  const first = (data.requests as Record<string, unknown>[])[0];
  const message = record(first?.message) ? first.message.text : first?.message;
  return String(data.customTitle || message || "新对话").replace(/\s+/g, " ").slice(0, 180);
}
function messageTime(data: Record<string, unknown>, fallback: number): number {
  const last = (data.requests as Record<string, unknown>[]).at(-1);
  const modelState = record(last?.modelState) ? last.modelState : {};
  const values = [data.creationDate, data.lastMessageDate, last?.timestamp, last?.responseTimestamp, modelState.completedAt].filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  return values.length ? Math.max(...values) : fallback;
}
/** Stable semantic prefix check, ignoring transient timing/input bookkeeping. */
export function chatHistorySignature(data: Record<string, unknown> | null, omitLast = false): string {
  const rows = Array.isArray(data?.requests) ? data.requests as Record<string, unknown>[] : [];
  return JSON.stringify((omitLast ? rows.slice(0, -1) : rows).map(r => ({ id: r.requestId, message: r.message, response: r.response, result: r.result })));
}

/** One file per record, private permissions, atomic replace and per-record
 * cross-process transactions. No whole-history index shared by multiple writers.
 */
export class WorkspaceHubStore {
  readonly root: string;
  private readonly namespace: string;
  private closing = false;
  private readonly generations = new Map<string, { id: string; release: () => Promise<void> }>();
  private readonly summaryCache = new Map<string, { mtime: number; ctime: number; ino: number; size: number; value: HubChatSummary }>();
  constructor(root: string, readonly windowId: string, readonly workspace: HubWorkspace, private readonly now: () => number = Date.now) {
    if (!safeWindowId(windowId) || !validHubWorkspace(workspace)) throw new Error("Invalid workspace hub identity.");
    this.root = path.resolve(root); this.namespace = digest(this.root);
  }
  async initialize(): Promise<void> {
    for (const folder of [this.root, ...["windows", "chats", "requests"].map(p => path.join(this.root, p))]) await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  }
  private file(area: string, key: string): string {
    if (!(safeKey(key) || safeWindowId(key))) throw new Error("Invalid hub record key.");
    return path.join(this.root, area, `${key}.json`);
  }
  private async readJson(file: string): Promise<unknown> {
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > HUB_MAX_CHAT_BYTES + 64 * 1024) throw new Error("Invalid shared record file.");
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (e) { if (missing(e)) return undefined; throw e; }
  }
  private async atomic(file: string, value: unknown): Promise<void> {
    if (this.closing) throw new Error("Workspace hub is closing.");
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
      if (this.closing) throw new Error("Workspace hub is closing.");
      await fs.rename(temporary, file);
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }
  private async transaction<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let release: (() => Promise<void>) | undefined;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { release = await acquireBridgeTunnelLease([`chat-write:${this.namespace}:${key}`], busy); break; }
      catch (e) { if (!(e instanceof Error) || e.message !== busy) throw e; await new Promise(resolve => setTimeout(resolve, 25)); }
    }
    if (!release) throw new Error("共享聊天正在保存，请稍后重试。");
    try { if (this.closing) throw new Error("Workspace hub is closing."); return await fn(); } finally { await release(); }
  }
  async publishWindow(value: HubWindow): Promise<void> {
    if (value.windowId !== this.windowId || value.workspace.id !== this.workspace.id) throw new Error("Window ownership mismatch.");
    // Build a whitelist; URLs containing route tokens are never written here.
    const safe: HubWindow = {
      version: 1, windowId: this.windowId, workspace: this.workspace, updatedAt: this.now(),
      bridge: { state: value.bridge.state, provider: value.bridge.provider, domain: value.bridge.domain, localPort: value.bridge.localPort, connected: value.bridge.connected,
        todos: value.bridge.todos.slice(0, 24).map(t => ({ id: t.id, title: t.title.replace(/\/mcp\/[a-f0-9]{32}/gi, "/mcp/••••").slice(0, 400), status: t.status })) },
      activeChats: [...this.generations.keys()], syncError: value.syncError,
      // Multi-instance registry fields (informational; never trusted for authority).
      instanceId: typeof value.instanceId === "string" ? value.instanceId.slice(0, 64) : undefined,
      userDataDir: typeof value.userDataDir === "string" ? value.userDataDir.slice(0, 4096) : undefined,
      pid: Number.isSafeInteger(value.pid) && (value.pid as number) > 0 ? value.pid : undefined,
    };
    await this.atomic(this.file("windows", this.windowId), safe);
  }
  async listWindows(): Promise<HubWindow[]> {
    const entries = await fs.readdir(path.join(this.root, "windows"));
    const values = await Promise.all(entries.filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).map(async n => {
      try {
        const v = await this.readJson(path.join(this.root, "windows", n));
        if (!record(v) || v.version !== 1 || v.windowId !== n.slice(0, -5) || !validHubWorkspace(v.workspace) || !record(v.bridge) || !["running", "stopped", "starting", "error"].includes(String(v.bridge.state)) || typeof v.bridge.domain !== "string" || v.bridge.domain.length > 253 || !Array.isArray(v.bridge.todos) || !Array.isArray(v.activeChats) || v.activeChats.some(k => typeof k !== "string" || !safeKey(k)) || typeof v.updatedAt !== "number" || this.now() - v.updatedAt > HUB_WINDOW_TTL_MS || v.updatedAt > this.now() + 5000) return undefined;
        if ((v.instanceId !== undefined && typeof v.instanceId !== "string") || (v.userDataDir !== undefined && typeof v.userDataDir !== "string") || (v.pid !== undefined && !Number.isSafeInteger(v.pid))) return undefined;
        return v as unknown as HubWindow;
      } catch { return undefined; }
    }));
    return values.filter((v): v is HubWindow => !!v);
  }
  async readChat(key: string): Promise<HubChat | undefined> {
    const v = await this.readJson(this.file("chats", key));
    if (v === undefined) return undefined;
    if (!record(v) || v.version !== 1 || !validHubWorkspace(v.workspace) || typeof v.sessionResource !== "string" || v.key !== key || hubChatKey(v.workspace.id, v.sessionResource) !== key || typeof v.revision !== "number" || typeof v.ownerWindowId !== "string" || (!v.deleted && !record(v.data))) throw new Error("Invalid shared chat record.");
    return v as unknown as HubChat;
  }
  async listChats(windows?: HubWindow[]): Promise<HubChatSummary[]> {
    const live = new Map((windows ?? await this.listWindows()).map(w => [w.windowId, w]));
    const names = (await fs.readdir(path.join(this.root, "chats"))).filter(n => /^[a-f0-9]{64}\.json$/.test(n));
    const result: HubChatSummary[] = [];
    for (const name of names) {
      const key = name.slice(0, -5);
      try {
        const stat = await fs.stat(this.file("chats", key));
        let cached = this.summaryCache.get(key);
        if (!cached || cached.mtime !== stat.mtimeMs || cached.ctime !== stat.ctimeMs || cached.ino !== stat.ino || cached.size !== stat.size) {
          const value = await this.readChat(key);
          if (!value || value.deleted) { this.summaryCache.delete(key); continue; }
          const { data: _data, ...metadata } = value;
          cached = { mtime: stat.mtimeMs, ctime: stat.ctimeMs, ino: stat.ino, size: stat.size, value: { ...metadata, status: "idle" } };
          this.summaryCache.set(key, cached);
        }
        const owner = live.get(cached.value.ownerWindowId);
        const running = !!owner?.activeChats.includes(key);
        result.push({ ...cached.value, status: running ? "running" : cached.value.active ? "interrupted" : "idle" });
      } catch { /* One corrupt record does not hide the remaining history. */ }
    }
    for (const key of this.summaryCache.keys()) if (!names.includes(`${key}.json`)) this.summaryCache.delete(key);
    return result.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }
  private makeChat(frame: HubChatFrame, data: Record<string, unknown>, previous?: HubChat): HubChat {
    const key = hubChatKey(this.workspace.id, frame.sessionResource);
    return { version: 1, key, workspace: this.workspace, sessionId: frame.sessionId, sessionResource: frame.sessionResource, ownerWindowId: this.windowId,
      revision: (previous?.revision ?? 0) + 1, sourceSequence: frame.sequence, generation: this.generations.get(key)?.id ?? frame.generation,
      active: this.generations.has(key), deleted: false, updatedAt: this.now(), lastMessageAt: messageTime(data, this.now()), title: titleOf(data), data };
  }
  async publishChat(frame: HubChatFrame, importing = false): Promise<boolean> {
    const data = parseFrame(frame), key = hubChatKey(this.workspace.id, frame.sessionResource);
    return this.transaction(key, async () => {
      const previous = await this.readChat(key);
      if (previous?.deleted || (importing && previous)) return false;
      if (previous && (previous.ownerWindowId !== this.windowId || frame.sequence <= previous.sourceSequence || (previous.generation && frame.generation !== previous.generation))) return false;
      await this.atomic(this.file("chats", key), this.makeChat(frame, data, previous));
      return true;
    });
  }
  async beginGeneration(frame: HubChatFrame): Promise<string> {
    const data = parseFrame(frame), key = hubChatKey(this.workspace.id, frame.sessionResource);
    if (this.generations.has(key)) throw new Error("这个聊天仍在生成，请等待完成后再继续。");
    const release = await acquireBridgeTunnelLease([`chat-generation:${this.namespace}:${key}`], "另一个窗口正在生成这个聊天，当前窗口只可查看。");
    try {
      return await this.transaction(key, async () => {
        const previous = await this.readChat(key);
        if (previous?.deleted) throw new Error("这条共享记录已删除，请新建聊天。");
        if (previous && previous.ownerWindowId !== this.windowId) {
          const live = (await this.listWindows()).some(w => w.windowId === previous.ownerWindowId);
          if (live) throw new Error("这个聊天属于另一个窗口，请从“共享聊天”进入原窗口继续。");
          if (chatHistorySignature(previous.data) !== chatHistorySignature(data, true)) throw new Error("当前窗口的记录已过期，请从“共享聊天”恢复最新记录后继续。");
        }
        const id = randomUUID(); this.generations.set(key, { id, release });
        await this.atomic(this.file("chats", key), this.makeChat({ ...frame, generation: id }, data, previous));
        return id;
      });
    } catch (e) { this.generations.delete(key); await release(); throw e; }
  }
  async finishGeneration(frame: HubChatFrame): Promise<void> {
    const key = hubChatKey(this.workspace.id, frame.sessionResource), owned = this.generations.get(key);
    if (!owned || owned.id !== frame.generation) return;
    try {
      const data = parseFrame(frame);
      await this.transaction(key, async () => {
        const previous = await this.readChat(key);
        if (!previous || previous.deleted || previous.ownerWindowId !== this.windowId || previous.generation !== owned.id) return;
        const value = frame.sequence >= previous.sourceSequence ? this.makeChat(frame, data, previous) : { ...previous, updatedAt: this.now(), revision: previous.revision + 1 };
        value.active = false;
        await this.atomic(this.file("chats", key), value);
      });
    } finally { if (this.generations.get(key) === owned) this.generations.delete(key); await owned.release(); }
  }
  async prepareContinuation(key: string): Promise<HubChat> {
    const release = await acquireBridgeTunnelLease([`chat-generation:${this.namespace}:${key}`], "聊天仍在生成，不能从另一个窗口继续。");
    try {
      return await this.transaction(key, async () => {
        const value = await this.readChat(key);
        if (!value || value.deleted || value.workspace.id !== this.workspace.id) throw new Error("必须在对话所属的工作区继续，不能在当前项目执行。");
        if (value.ownerWindowId !== this.windowId && (await this.listWindows()).some(w => w.windowId === value.ownerWindowId)) throw new Error("请在拥有此聊天的窗口继续。");
        if (value.ownerWindowId !== this.windowId) { value.ownerWindowId = this.windowId; value.sourceSequence = 0; value.generation = undefined; }
        value.active = false; value.updatedAt = this.now(); value.revision++;
        await this.atomic(this.file("chats", key), value); return value;
      });
    } finally { await release(); }
  }
  async deleteChat(sessionResource: string): Promise<void> {
    const key = hubChatKey(this.workspace.id, sessionResource);
    // Heartbeats are display state, not authority: a foreign generation may
    // already hold its lease before its next window snapshot is published.
    const release = this.generations.has(key) ? undefined : await acquireBridgeTunnelLease([`chat-generation:${this.namespace}:${key}`], "请先在原窗口停止生成，再删除共享记录。");
    try {
      await this.transaction(key, async () => {
        const value = await this.readChat(key); if (!value) return;
        await this.atomic(this.file("chats", key), { ...value, deleted: true, active: false, data: null, title: "", updatedAt: this.now(), revision: value.revision + 1 });
      });
    } finally { await release?.(); }
  }
  /** Tombstone one record by its key, whatever workspace it belongs to. Used by
   * the management UI (after an explicit user confirmation) and by the
   * superseded-record sweep. The native service path keeps using the
   * workspace-scoped `deleteChat`.
   */
  async deleteChatByKey(key: string): Promise<void> {
    if (!safeKey(key)) throw new Error("Invalid chat key.");
    const release = this.generations.has(key) ? undefined : await acquireBridgeTunnelLease([`chat-generation:${this.namespace}:${key}`], "请先在原窗口停止生成，再删除共享记录。");
    try {
      await this.transaction(key, async () => {
        const value = await this.readChat(key); if (!value || value.deleted) return;
        await this.atomic(this.file("chats", key), { ...value, deleted: true, active: false, data: null, title: "", updatedAt: this.now(), revision: value.revision + 1 });
      });
    } finally { await release?.(); }
  }
  /** One-time-per-startup migration: early hub builds keyed records by a
   * per-window workspace id, so one native session could leave several
   * records behind (one per window incarnation). Native session ids are
   * unique, so records sharing a sessionResource are the same conversation:
   * keep the newest, tombstone the rest. Idempotent and safe to run on every
   * window start; records that are still generating are skipped.
   */
  async sweepSupersededChatRecords(): Promise<number> {
    const chats = await this.listChats();
    const byResource = new Map<string, HubChatSummary[]>();
    for (const chat of chats) {
      const rows = byResource.get(chat.sessionResource) ?? [];
      rows.push(chat);
      byResource.set(chat.sessionResource, rows);
    }
    let swept = 0;
    for (const rows of byResource.values()) {
      if (rows.length < 2) continue;
      const ordered = [...rows].sort((a, b) => b.updatedAt - a.updatedAt || b.revision - a.revision);
      for (const loser of ordered.slice(1)) {
        try { await this.deleteChatByKey(loser.key); swept++; }
        catch { /* Still generating elsewhere; retried on a later start. */ }
      }
    }
    return swept;
  }
  async requestContinuation(chat: HubChat, targetWindowId?: string): Promise<void> {
    const request: HubOpenRequest = { version: 1, id: randomUUID(), kind: "continue", chatKey: chat.key, workspaceId: chat.workspace.id, targetWindowId, createdAt: this.now() };
    await this.atomic(this.file("requests", request.id), request);
  }
  /** Multi-instance: ask one live window (possibly in another process) to act. */
  async requestWindowAction(target: HubWindow, kind: "focus" | "copy-address"): Promise<void> {
    const request: HubOpenRequest = { version: 1, id: randomUUID(), kind, chatKey: "", workspaceId: target.workspace.id, targetWindowId: target.windowId, createdAt: this.now() };
    await this.atomic(this.file("requests", request.id), request);
  }
  async consumeRequests(open: (key: string) => Promise<void>, act?: (kind: "focus" | "copy-address") => Promise<void>): Promise<void> {
    for (const name of await fs.readdir(path.join(this.root, "requests"))) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const file = path.join(this.root, "requests", name);
      let request: HubOpenRequest;
      try { request = await this.readJson(file) as HubOpenRequest; } catch { continue; }
      if (!request || request.version !== 1 || request.workspaceId !== this.workspace.id || (request.targetWindowId && request.targetWindowId !== this.windowId)) continue;
      const kind = request.kind ?? "continue";
      if (kind === "continue" ? !safeKey(request.chatKey) : !((kind === "focus" || kind === "copy-address") && request.targetWindowId === this.windowId)) continue;
      if (!Number.isFinite(request.createdAt) || this.now() - request.createdAt > HUB_REQUEST_TTL_MS || request.createdAt > this.now() + 5000) { await fs.unlink(file).catch(() => {}); continue; }
      const claimed = `${file}.${this.windowId}.claimed`;
      try { await fs.rename(file, claimed); } catch (e) { if (missing(e)) continue; throw e; }
      try { if (kind === "continue") await open(request.chatKey); else await act?.(kind); } finally { await fs.unlink(claimed).catch(() => {}); }
    }
  }
  async dispose(): Promise<void> {
    this.closing = true;
    const owned = [...this.generations.values()]; this.generations.clear();
    // Best-effort: a single lease-release failure (file locks are contended
    // on Windows shutdown) must not reject dispose and abort the rest of the
    // extension shutdown chain.
    await Promise.all(owned.map(v => v.release().catch(() => {})));
    await fs.unlink(this.file("windows", this.windowId)).catch(() => {});
  }
}
