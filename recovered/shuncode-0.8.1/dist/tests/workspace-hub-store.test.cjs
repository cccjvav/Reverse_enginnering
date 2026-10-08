"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// extensions/shuncode/test/workspace-hub-store.test.ts
var import_strict = __toESM(require("node:assert/strict"));
var import_node_crypto3 = require("node:crypto");
var fs2 = __toESM(require("node:fs/promises"));
var import_node_os2 = __toESM(require("node:os"));
var import_node_path3 = __toESM(require("node:path"));
var import_node_test = __toESM(require("node:test"));

// extensions/shuncode/src/workspace-hub-store.ts
var import_node_crypto2 = require("node:crypto");
var fs = __toESM(require("node:fs/promises"));
var import_node_path2 = __toESM(require("node:path"));

// extensions/shuncode/src/bridge-tunnel-lease.ts
var import_node_child_process = require("node:child_process");
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_node_net = require("node:net");
var import_node_os = __toESM(require("node:os"));
var import_node_path = __toESM(require("node:path"));
var import_node_util = require("node:util");
var execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
var hash = (value) => (0, import_node_crypto.createHash)("sha256").update(value).digest("hex");
function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
  });
}
var uid = () => typeof process.getuid === "function" ? process.getuid() : 0;
function linuxLeaseAddress(resource) {
  return `\0shuncode-bridge-v1-${uid()}-${hash(resource).slice(0, 48)}`;
}
function win32LeaseName(resource) {
  return `\\\\?\\pipe\\shuncode-bridge-v1-${uid()}-${hash(resource).slice(0, 48)}`;
}
function pathLeaseDirectory() {
  const name = `shuncode-lease-${uid()}`;
  const preferred = import_node_path.default.join(import_node_os.default.tmpdir(), name);
  return Buffer.byteLength(preferred) + 1 + 24 + 5 < 104 ? preferred : import_node_path.default.join("/tmp", name);
}
function ensurePrivateDirectory(directory) {
  (0, import_node_fs.mkdirSync)(directory, { recursive: true, mode: 448 });
  if (process.platform === "win32") {
    return;
  }
  const stat3 = (0, import_node_fs.lstatSync)(directory);
  if (!stat3.isDirectory() || stat3.isSymbolicLink()) throw new Error(`Bridge lease directory ${directory} is not a private directory.`);
  if (stat3.uid !== uid()) throw new Error(`Bridge lease directory ${directory} is owned by another user.`);
  if ((stat3.mode & 63) !== 0) (0, import_node_fs.chmodSync)(directory, 448);
}
function pathLeaseSocket(resource) {
  return import_node_path.default.join(pathLeaseDirectory(), `${hash(resource).slice(0, 24)}.sock`);
}
function pathLeaseAddress(resource) {
  ensurePrivateDirectory(pathLeaseDirectory());
  return pathLeaseSocket(resource);
}
function listenOnce(server, address) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(address);
  });
}
function probeAlive(address) {
  return new Promise((resolve) => {
    const socket = (0, import_node_net.connect)(address);
    const done = (alive) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(alive);
    };
    socket.once("connect", () => done(true));
    socket.once("error", (error) => done(!(error.code === "ECONNREFUSED" || error.code === "ENOENT")));
    socket.setTimeout(2e3, () => done(true));
  });
}
function fileIdentity(address) {
  try {
    const stat3 = (0, import_node_fs.lstatSync)(address);
    return `${stat3.dev}:${stat3.ino}:${stat3.birthtimeMs}:${stat3.ctimeMs}`;
  } catch {
    return void 0;
  }
}
async function listenPathLease(server, address, conflictMessage) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await listenOnce(server, address);
      return;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || attempt === 1) {
        throw error.code === "EADDRINUSE" ? new BridgeTunnelLeaseConflictError(conflictMessage) : error;
      }
      const identity = fileIdentity(address);
      if (await probeAlive(address)) throw new BridgeTunnelLeaseConflictError(conflictMessage);
      if (identity !== void 0 && fileIdentity(address) === identity) {
        try {
          (0, import_node_fs.unlinkSync)(address);
        } catch (unlinkError) {
          if (unlinkError.code !== "ENOENT") throw unlinkError;
        }
      }
    }
  }
}
var BridgeTunnelLeaseConflictError = class extends Error {
  isBridgeTunnelLeaseConflict = true;
  constructor(message) {
    super(message);
    this.name = "BridgeTunnelLeaseConflictError";
  }
};
async function acquireBridgeTunnelLease(resources, conflictMessage = "This fixed Bridge endpoint or Named Tunnel credential is already in use by another ShunCode window. Use a different domain/tunnel, or stop its owning Bridge first. No other process was stopped.") {
  const held = [];
  const kernelReleased = process.platform === "linux" || process.platform === "win32";
  try {
    for (const resource of [...new Set(resources)].sort()) {
      const server = (0, import_node_net.createServer)((socket) => socket.destroy());
      if (kernelReleased) {
        const address = process.platform === "win32" ? win32LeaseName(resource) : linuxLeaseAddress(resource);
        try {
          await listenOnce(server, address);
        } catch (error) {
          throw error.code === "EADDRINUSE" ? new BridgeTunnelLeaseConflictError(conflictMessage) : error;
        }
      } else {
        await listenPathLease(server, pathLeaseAddress(resource), conflictMessage);
      }
      server.unref();
      held.push(server);
    }
  } catch (error) {
    await Promise.all(held.map(closeServer));
    throw error;
  }
  let releasing;
  return () => releasing ??= Promise.all(held.map(closeServer)).then(() => void 0);
}

// extensions/shuncode/src/workspace-hub-types.ts
var HUB_WINDOW_TTL_MS = 2e4;
var HUB_REQUEST_TTL_MS = 12e4;
var HUB_MAX_CHAT_BYTES = 32 * 1024 * 1024;

// extensions/shuncode/src/workspace-hub-store.ts
var digest = (value) => (0, import_node_crypto2.createHash)("sha256").update(value).digest("hex");
var safeKey = (value) => /^[a-f0-9]{64}$/.test(value);
var safeWindowId = (value) => /^[a-f0-9-]{36}$/.test(value);
var busy = "SHUNCODE_CHAT_WRITE_BUSY";
var missing = (error) => error?.code === "ENOENT";
var record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var hubChatKey = (workspaceId, sessionResource) => digest(`${workspaceId}
${sessionResource}`);
function validHubWorkspace(value) {
  if (!record(value) || typeof value.id !== "string" || !(safeKey(value.id) || value.id === "empty") || typeof value.name !== "string" || value.name.length > 300 || !Array.isArray(value.folders) || value.folders.length > 100 || value.folders.some((f) => typeof f !== "string" || f.length > 8192)) return false;
  if (!["folder", "workspace", "empty"].includes(String(value.kind))) return false;
  return value.kind === "empty" ? value.uri === void 0 : typeof value.uri === "string" && /^file:\/\//.test(value.uri) && value.uri.length <= 8192 && !/[\r\n]/.test(value.uri);
}
function parseFrame(frame2) {
  if (typeof frame2.sessionId !== "string" || !frame2.sessionId || frame2.sessionId.length > 256 || /[\/\\\0]/.test(frame2.sessionId)) throw new Error("Invalid chat session ID.");
  if (typeof frame2.sessionResource !== "string" || !/^vscode-chat-session:\/\/local\/[A-Za-z0-9_=-]+$/.test(frame2.sessionResource)) throw new Error("Only native local chat sessions can be shared.");
  if (!Number.isSafeInteger(frame2.sequence) || frame2.sequence < 0 || typeof frame2.serialized !== "string" || Buffer.byteLength(frame2.serialized) > HUB_MAX_CHAT_BYTES) throw new Error("Chat snapshot is invalid or exceeds 32 MiB. The original history is retained.");
  const canonicalResource = `vscode-chat-session://local/${Buffer.from(frame2.sessionId).toString("base64url")}`;
  if (frame2.sessionResource !== canonicalResource) throw new Error("Chat resource does not match its session ID.");
  const data = JSON.parse(frame2.serialized);
  if (!record(data) || data.sessionId !== frame2.sessionId || !Array.isArray(data.requests)) throw new Error("Invalid serialized chat snapshot.");
  delete data.inputState;
  delete data.pendingRequests;
  return data;
}
function titleOf(data) {
  const first = data.requests[0];
  const message = record(first?.message) ? first.message.text : first?.message;
  return String(data.customTitle || message || "\u65B0\u5BF9\u8BDD").replace(/\s+/g, " ").slice(0, 180);
}
function messageTime(data, fallback) {
  const last = data.requests.at(-1);
  const modelState = record(last?.modelState) ? last.modelState : {};
  const values = [data.creationDate, data.lastMessageDate, last?.timestamp, last?.responseTimestamp, modelState.completedAt].filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
  return values.length ? Math.max(...values) : fallback;
}
function chatHistorySignature(data, omitLast = false) {
  const rows = Array.isArray(data?.requests) ? data.requests : [];
  return JSON.stringify((omitLast ? rows.slice(0, -1) : rows).map((r) => ({ id: r.requestId, message: r.message, response: r.response, result: r.result })));
}
var WorkspaceHubStore = class {
  constructor(root, windowId, workspace2, now = Date.now) {
    this.windowId = windowId;
    this.workspace = workspace2;
    this.now = now;
    if (!safeWindowId(windowId) || !validHubWorkspace(workspace2)) throw new Error("Invalid workspace hub identity.");
    this.root = import_node_path2.default.resolve(root);
    this.namespace = digest(this.root);
  }
  windowId;
  workspace;
  now;
  root;
  namespace;
  closing = false;
  generations = /* @__PURE__ */ new Map();
  summaryCache = /* @__PURE__ */ new Map();
  async initialize() {
    for (const folder of [this.root, ...["windows", "chats", "requests"].map((p) => import_node_path2.default.join(this.root, p))]) await fs.mkdir(folder, { recursive: true, mode: 448 });
  }
  file(area, key) {
    if (!(safeKey(key) || safeWindowId(key))) throw new Error("Invalid hub record key.");
    return import_node_path2.default.join(this.root, area, `${key}.json`);
  }
  async readJson(file) {
    try {
      const stat3 = await fs.lstat(file);
      if (!stat3.isFile() || stat3.isSymbolicLink() || stat3.size > HUB_MAX_CHAT_BYTES + 64 * 1024) throw new Error("Invalid shared record file.");
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (e) {
      if (missing(e)) return void 0;
      throw e;
    }
  }
  async atomic(file, value) {
    if (this.closing) throw new Error("Workspace hub is closing.");
    const temporary = `${file}.${(0, import_node_crypto2.randomUUID)()}.tmp`;
    try {
      const handle = await fs.open(temporary, "wx", 384);
      try {
        await handle.writeFile(JSON.stringify(value));
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (this.closing) throw new Error("Workspace hub is closing.");
      await fs.rename(temporary, file);
    } finally {
      await fs.unlink(temporary).catch(() => {
      });
    }
  }
  async transaction(key, fn) {
    let release;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        release = await acquireBridgeTunnelLease([`chat-write:${this.namespace}:${key}`], busy);
        break;
      } catch (e) {
        if (!(e instanceof Error) || e.message !== busy) throw e;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    if (!release) throw new Error("\u5171\u4EAB\u804A\u5929\u6B63\u5728\u4FDD\u5B58\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
    try {
      if (this.closing) throw new Error("Workspace hub is closing.");
      return await fn();
    } finally {
      await release();
    }
  }
  async publishWindow(value) {
    if (value.windowId !== this.windowId || value.workspace.id !== this.workspace.id) throw new Error("Window ownership mismatch.");
    const safe = {
      version: 1,
      windowId: this.windowId,
      workspace: this.workspace,
      updatedAt: this.now(),
      bridge: {
        state: value.bridge.state,
        provider: value.bridge.provider,
        domain: value.bridge.domain,
        localPort: value.bridge.localPort,
        connected: value.bridge.connected,
        todos: value.bridge.todos.slice(0, 24).map((t) => ({ id: t.id, title: t.title.replace(/\/mcp\/[a-f0-9]{32}/gi, "/mcp/\u2022\u2022\u2022\u2022").slice(0, 400), status: t.status }))
      },
      activeChats: [...this.generations.keys()],
      syncError: value.syncError,
      // Multi-instance registry fields (informational; never trusted for authority).
      instanceId: typeof value.instanceId === "string" ? value.instanceId.slice(0, 64) : void 0,
      userDataDir: typeof value.userDataDir === "string" ? value.userDataDir.slice(0, 4096) : void 0,
      pid: Number.isSafeInteger(value.pid) && value.pid > 0 ? value.pid : void 0
    };
    await this.atomic(this.file("windows", this.windowId), safe);
  }
  async listWindows() {
    const entries = await fs.readdir(import_node_path2.default.join(this.root, "windows"));
    const values = await Promise.all(entries.filter((n) => /^[a-f0-9-]{36}\.json$/.test(n)).map(async (n) => {
      try {
        const v = await this.readJson(import_node_path2.default.join(this.root, "windows", n));
        if (!record(v) || v.version !== 1 || v.windowId !== n.slice(0, -5) || !validHubWorkspace(v.workspace) || !record(v.bridge) || !["running", "stopped", "starting", "error"].includes(String(v.bridge.state)) || typeof v.bridge.domain !== "string" || v.bridge.domain.length > 253 || !Array.isArray(v.bridge.todos) || !Array.isArray(v.activeChats) || v.activeChats.some((k) => typeof k !== "string" || !safeKey(k)) || typeof v.updatedAt !== "number" || this.now() - v.updatedAt > HUB_WINDOW_TTL_MS || v.updatedAt > this.now() + 5e3) return void 0;
        if (v.instanceId !== void 0 && typeof v.instanceId !== "string" || v.userDataDir !== void 0 && typeof v.userDataDir !== "string" || v.pid !== void 0 && !Number.isSafeInteger(v.pid)) return void 0;
        return v;
      } catch {
        return void 0;
      }
    }));
    return values.filter((v) => !!v);
  }
  async readChat(key) {
    const v = await this.readJson(this.file("chats", key));
    if (v === void 0) return void 0;
    if (!record(v) || v.version !== 1 || !validHubWorkspace(v.workspace) || typeof v.sessionResource !== "string" || v.key !== key || hubChatKey(v.workspace.id, v.sessionResource) !== key || typeof v.revision !== "number" || typeof v.ownerWindowId !== "string" || !v.deleted && !record(v.data)) throw new Error("Invalid shared chat record.");
    return v;
  }
  async listChats(windows) {
    const live = new Map((windows ?? await this.listWindows()).map((w) => [w.windowId, w]));
    const names = (await fs.readdir(import_node_path2.default.join(this.root, "chats"))).filter((n) => /^[a-f0-9]{64}\.json$/.test(n));
    const result = [];
    for (const name of names) {
      const key = name.slice(0, -5);
      try {
        const stat3 = await fs.stat(this.file("chats", key));
        let cached = this.summaryCache.get(key);
        if (!cached || cached.mtime !== stat3.mtimeMs || cached.ctime !== stat3.ctimeMs || cached.ino !== stat3.ino || cached.size !== stat3.size) {
          const value = await this.readChat(key);
          if (!value || value.deleted) {
            this.summaryCache.delete(key);
            continue;
          }
          const { data: _data, ...metadata } = value;
          cached = { mtime: stat3.mtimeMs, ctime: stat3.ctimeMs, ino: stat3.ino, size: stat3.size, value: { ...metadata, status: "idle" } };
          this.summaryCache.set(key, cached);
        }
        const owner = live.get(cached.value.ownerWindowId);
        const running = !!owner?.activeChats.includes(key);
        result.push({ ...cached.value, status: running ? "running" : cached.value.active ? "interrupted" : "idle" });
      } catch {
      }
    }
    for (const key of this.summaryCache.keys()) if (!names.includes(`${key}.json`)) this.summaryCache.delete(key);
    return result.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }
  makeChat(frame2, data, previous) {
    const key = hubChatKey(this.workspace.id, frame2.sessionResource);
    return {
      version: 1,
      key,
      workspace: this.workspace,
      sessionId: frame2.sessionId,
      sessionResource: frame2.sessionResource,
      ownerWindowId: this.windowId,
      revision: (previous?.revision ?? 0) + 1,
      sourceSequence: frame2.sequence,
      generation: this.generations.get(key)?.id ?? frame2.generation,
      active: this.generations.has(key),
      deleted: false,
      updatedAt: this.now(),
      lastMessageAt: messageTime(data, this.now()),
      title: titleOf(data),
      data
    };
  }
  async publishChat(frame2, importing = false) {
    const data = parseFrame(frame2), key = hubChatKey(this.workspace.id, frame2.sessionResource);
    return this.transaction(key, async () => {
      const previous = await this.readChat(key);
      if (previous?.deleted || importing && previous) return false;
      if (previous && (previous.ownerWindowId !== this.windowId || frame2.sequence <= previous.sourceSequence || previous.generation && frame2.generation !== previous.generation)) return false;
      await this.atomic(this.file("chats", key), this.makeChat(frame2, data, previous));
      return true;
    });
  }
  async beginGeneration(frame2) {
    const data = parseFrame(frame2), key = hubChatKey(this.workspace.id, frame2.sessionResource);
    if (this.generations.has(key)) throw new Error("\u8FD9\u4E2A\u804A\u5929\u4ECD\u5728\u751F\u6210\uFF0C\u8BF7\u7B49\u5F85\u5B8C\u6210\u540E\u518D\u7EE7\u7EED\u3002");
    const release = await acquireBridgeTunnelLease([`chat-generation:${this.namespace}:${key}`], "\u53E6\u4E00\u4E2A\u7A97\u53E3\u6B63\u5728\u751F\u6210\u8FD9\u4E2A\u804A\u5929\uFF0C\u5F53\u524D\u7A97\u53E3\u53EA\u53EF\u67E5\u770B\u3002");
    try {
      return await this.transaction(key, async () => {
        const previous = await this.readChat(key);
        if (previous?.deleted) throw new Error("\u8FD9\u6761\u5171\u4EAB\u8BB0\u5F55\u5DF2\u5220\u9664\uFF0C\u8BF7\u65B0\u5EFA\u804A\u5929\u3002");
        if (previous && previous.ownerWindowId !== this.windowId) {
          const live = (await this.listWindows()).some((w) => w.windowId === previous.ownerWindowId);
          if (live) throw new Error("\u8FD9\u4E2A\u804A\u5929\u5C5E\u4E8E\u53E6\u4E00\u4E2A\u7A97\u53E3\uFF0C\u8BF7\u4ECE\u201C\u5171\u4EAB\u804A\u5929\u201D\u8FDB\u5165\u539F\u7A97\u53E3\u7EE7\u7EED\u3002");
          if (chatHistorySignature(previous.data) !== chatHistorySignature(data, true)) throw new Error("\u5F53\u524D\u7A97\u53E3\u7684\u8BB0\u5F55\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u4ECE\u201C\u5171\u4EAB\u804A\u5929\u201D\u6062\u590D\u6700\u65B0\u8BB0\u5F55\u540E\u7EE7\u7EED\u3002");
        }
        const id = (0, import_node_crypto2.randomUUID)();
        this.generations.set(key, { id, release });
        await this.atomic(this.file("chats", key), this.makeChat({ ...frame2, generation: id }, data, previous));
        return id;
      });
    } catch (e) {
      this.generations.delete(key);
      await release();
      throw e;
    }
  }
  async finishGeneration(frame2) {
    const key = hubChatKey(this.workspace.id, frame2.sessionResource), owned = this.generations.get(key);
    if (!owned || owned.id !== frame2.generation) return;
    try {
      const data = parseFrame(frame2);
      await this.transaction(key, async () => {
        const previous = await this.readChat(key);
        if (!previous || previous.deleted || previous.ownerWindowId !== this.windowId || previous.generation !== owned.id) return;
        const value = frame2.sequence >= previous.sourceSequence ? this.makeChat(frame2, data, previous) : { ...previous, updatedAt: this.now(), revision: previous.revision + 1 };
        value.active = false;
        await this.atomic(this.file("chats", key), value);
      });
    } finally {
      if (this.generations.get(key) === owned) this.generations.delete(key);
      await owned.release();
    }
  }
  async prepareContinuation(key) {
    const release = await acquireBridgeTunnelLease([`chat-generation:${this.namespace}:${key}`], "\u804A\u5929\u4ECD\u5728\u751F\u6210\uFF0C\u4E0D\u80FD\u4ECE\u53E6\u4E00\u4E2A\u7A97\u53E3\u7EE7\u7EED\u3002");
    try {
      return await this.transaction(key, async () => {
        const value = await this.readChat(key);
        if (!value || value.deleted || value.workspace.id !== this.workspace.id) throw new Error("\u5FC5\u987B\u5728\u5BF9\u8BDD\u6240\u5C5E\u7684\u5DE5\u4F5C\u533A\u7EE7\u7EED\uFF0C\u4E0D\u80FD\u5728\u5F53\u524D\u9879\u76EE\u6267\u884C\u3002");
        if (value.ownerWindowId !== this.windowId && (await this.listWindows()).some((w) => w.windowId === value.ownerWindowId)) throw new Error("\u8BF7\u5728\u62E5\u6709\u6B64\u804A\u5929\u7684\u7A97\u53E3\u7EE7\u7EED\u3002");
        if (value.ownerWindowId !== this.windowId) {
          value.ownerWindowId = this.windowId;
          value.sourceSequence = 0;
          value.generation = void 0;
        }
        value.active = false;
        value.updatedAt = this.now();
        value.revision++;
        await this.atomic(this.file("chats", key), value);
        return value;
      });
    } finally {
      await release();
    }
  }
  async deleteChat(sessionResource) {
    const key = hubChatKey(this.workspace.id, sessionResource);
    const release = this.generations.has(key) ? void 0 : await acquireBridgeTunnelLease([`chat-generation:${this.namespace}:${key}`], "\u8BF7\u5148\u5728\u539F\u7A97\u53E3\u505C\u6B62\u751F\u6210\uFF0C\u518D\u5220\u9664\u5171\u4EAB\u8BB0\u5F55\u3002");
    try {
      await this.transaction(key, async () => {
        const value = await this.readChat(key);
        if (!value) return;
        await this.atomic(this.file("chats", key), { ...value, deleted: true, active: false, data: null, title: "", updatedAt: this.now(), revision: value.revision + 1 });
      });
    } finally {
      await release?.();
    }
  }
  /** Tombstone one record by its key, whatever workspace it belongs to. Used by
   * the management UI (after an explicit user confirmation) and by the
   * superseded-record sweep. The native service path keeps using the
   * workspace-scoped `deleteChat`.
   */
  async deleteChatByKey(key) {
    if (!safeKey(key)) throw new Error("Invalid chat key.");
    const release = this.generations.has(key) ? void 0 : await acquireBridgeTunnelLease([`chat-generation:${this.namespace}:${key}`], "\u8BF7\u5148\u5728\u539F\u7A97\u53E3\u505C\u6B62\u751F\u6210\uFF0C\u518D\u5220\u9664\u5171\u4EAB\u8BB0\u5F55\u3002");
    try {
      await this.transaction(key, async () => {
        const value = await this.readChat(key);
        if (!value || value.deleted) return;
        await this.atomic(this.file("chats", key), { ...value, deleted: true, active: false, data: null, title: "", updatedAt: this.now(), revision: value.revision + 1 });
      });
    } finally {
      await release?.();
    }
  }
  /** One-time-per-startup migration: early hub builds keyed records by a
   * per-window workspace id, so one native session could leave several
   * records behind (one per window incarnation). Native session ids are
   * unique, so records sharing a sessionResource are the same conversation:
   * keep the newest, tombstone the rest. Idempotent and safe to run on every
   * window start; records that are still generating are skipped.
   */
  async sweepSupersededChatRecords() {
    const chats = await this.listChats();
    const byResource = /* @__PURE__ */ new Map();
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
        try {
          await this.deleteChatByKey(loser.key);
          swept++;
        } catch {
        }
      }
    }
    return swept;
  }
  async requestContinuation(chat, targetWindowId) {
    const request = { version: 1, id: (0, import_node_crypto2.randomUUID)(), kind: "continue", chatKey: chat.key, workspaceId: chat.workspace.id, targetWindowId, createdAt: this.now() };
    await this.atomic(this.file("requests", request.id), request);
  }
  /** Multi-instance: ask one live window (possibly in another process) to act. */
  async requestWindowAction(target, kind) {
    const request = { version: 1, id: (0, import_node_crypto2.randomUUID)(), kind, chatKey: "", workspaceId: target.workspace.id, targetWindowId: target.windowId, createdAt: this.now() };
    await this.atomic(this.file("requests", request.id), request);
  }
  async consumeRequests(open2, act) {
    for (const name of await fs.readdir(import_node_path2.default.join(this.root, "requests"))) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const file = import_node_path2.default.join(this.root, "requests", name);
      let request;
      try {
        request = await this.readJson(file);
      } catch {
        continue;
      }
      if (!request || request.version !== 1 || request.workspaceId !== this.workspace.id || request.targetWindowId && request.targetWindowId !== this.windowId) continue;
      const kind = request.kind ?? "continue";
      if (kind === "continue" ? !safeKey(request.chatKey) : !((kind === "focus" || kind === "copy-address") && request.targetWindowId === this.windowId)) continue;
      if (!Number.isFinite(request.createdAt) || this.now() - request.createdAt > HUB_REQUEST_TTL_MS || request.createdAt > this.now() + 5e3) {
        await fs.unlink(file).catch(() => {
        });
        continue;
      }
      const claimed = `${file}.${this.windowId}.claimed`;
      try {
        await fs.rename(file, claimed);
      } catch (e) {
        if (missing(e)) continue;
        throw e;
      }
      try {
        if (kind === "continue") await open2(request.chatKey);
        else await act?.(kind);
      } finally {
        await fs.unlink(claimed).catch(() => {
        });
      }
    }
  }
  async dispose() {
    this.closing = true;
    const owned = [...this.generations.values()];
    this.generations.clear();
    await Promise.all(owned.map((v) => v.release().catch(() => {
    })));
    await fs.unlink(this.file("windows", this.windowId)).catch(() => {
    });
  }
};

// extensions/shuncode/test/workspace-hub-store.test.ts
var hash2 = (s) => (0, import_node_crypto3.createHash)("sha256").update(s).digest("hex");
var workspace = (name) => ({ id: hash2(name), name, uri: `file:///projects/${name}`, kind: "folder", folders: [] });
var uri = (id) => `vscode-chat-session://local/${Buffer.from(id).toString("base64url")}`;
function frame(id = "chat-1", sequence = 1, text = "reply", generation) {
  return { sessionId: id, sessionResource: uri(id), sequence, generation, serialized: JSON.stringify({ version: 3, sessionId: id, creationDate: 100, inputState: { text: "UNSENT_DRAFT" }, pendingRequests: [{ prompt: "NEVER_REPLAY" }], requests: [{ requestId: "request-1", message: { text: "hello" }, response: [{ kind: "markdownContent", content: { value: text } }], timestamp: 100, responseTimestamp: 101 }] }) };
}
async function setup(t, sameWorkspace = false) {
  const root = await fs2.mkdtemp(import_node_path3.default.join(import_node_os2.default.tmpdir(), "shuncode-hub-test-"));
  const clock = { now: 1e5 };
  const a = new WorkspaceHubStore(root, (0, import_node_crypto3.randomUUID)(), workspace("a"), () => clock.now);
  const b = new WorkspaceHubStore(root, (0, import_node_crypto3.randomUUID)(), workspace(sameWorkspace ? "a" : "b"), () => clock.now);
  await Promise.all([a.initialize(), b.initialize()]);
  t.after(async () => {
    await Promise.all([a.dispose(), b.dispose()]);
    await fs2.rm(root, { recursive: true, force: true });
  });
  const publish = async (store) => store.publishWindow({
    version: 1,
    windowId: store.windowId,
    workspace: store.workspace,
    updatedAt: clock.now,
    bridge: { state: "running", provider: "cloudflare", domain: "example.trycloudflare.com", connected: true, todos: [] },
    activeChats: []
  });
  await Promise.all([publish(a), publish(b)]);
  return { root, clock, a, b, publish };
}
(0, import_node_test.default)("window catalog identifies both projects and expires stale windows", async (t) => {
  const { a, b, clock, publish } = await setup(t);
  import_strict.default.equal((await a.listWindows()).length, 2);
  clock.now += HUB_WINDOW_TTL_MS + 1;
  await publish(a);
  import_strict.default.deepEqual((await b.listWindows()).map((w) => w.workspace.name), ["a"]);
});
(0, import_node_test.default)("window snapshots whitelist fields and never persist an endpoint token", async (t) => {
  const { a, root } = await setup(t);
  const token = "1".repeat(32);
  const unsafe = {
    version: 1,
    windowId: a.windowId,
    workspace: a.workspace,
    updatedAt: Date.now(),
    bridge: { state: "running", provider: "cloudflare", domain: "example.trycloudflare.com", connected: true, publicUrl: `https://example.trycloudflare.com/mcp/${token}`, routeToken: token, todos: [{ id: "one", title: `/mcp/${token}`, status: "in_progress" }] },
    activeChats: []
  };
  await a.publishWindow(unsafe);
  const file = import_node_path3.default.join(root, "windows", `${a.windowId}.json`);
  import_strict.default.ok(!(await fs2.readFile(file, "utf8")).includes(token));
  if (process.platform !== "win32") import_strict.default.equal((await fs2.stat(file)).mode & 63, 0);
});
(0, import_node_test.default)("identical native IDs in different workspaces do not overwrite each other", async (t) => {
  const { a, b } = await setup(t);
  await Promise.all([a.publishChat(frame("same", 1, "project A")), b.publishChat(frame("same", 1, "project B"))]);
  const all = await a.listChats();
  import_strict.default.equal(all.length, 2);
  import_strict.default.notEqual(hubChatKey(a.workspace.id, uri("same")), hubChatKey(b.workspace.id, uri("same")));
  import_strict.default.ok(JSON.stringify((await b.readChat(hubChatKey(a.workspace.id, uri("same"))))?.data).includes("project A"));
});
(0, import_node_test.default)("other windows read incremental replies and out-of-order frames cannot roll them back", async (t) => {
  const { a, b } = await setup(t);
  const key = hubChatKey(a.workspace.id, uri("chat-1"));
  const generation = await a.beginGeneration(frame());
  await a.publishChat(frame("chat-1", 3, "latest streamed reply", generation));
  import_strict.default.equal(await a.publishChat(frame("chat-1", 2, "old reply", generation)), false);
  const value = await b.readChat(key);
  import_strict.default.equal(value?.sourceSequence, 3);
  import_strict.default.ok(JSON.stringify(value?.data).includes("latest streamed reply"));
  await a.finishGeneration(frame("chat-1", 4, "finished reply", generation));
  import_strict.default.equal((await b.readChat(key))?.active, false);
});
(0, import_node_test.default)("one chat has one generating owner even across independent store instances", async (t) => {
  const { a, b, publish } = await setup(t, true);
  const generation = await a.beginGeneration(frame());
  await publish(a);
  await import_strict.default.rejects(b.beginGeneration(frame()), /另一个窗口/);
  await import_strict.default.rejects(b.prepareContinuation(hubChatKey(a.workspace.id, uri("chat-1"))), /仍在生成/);
  await a.finishGeneration(frame("chat-1", 2, "done", generation));
  await import_strict.default.rejects(b.beginGeneration(frame()), /属于另一个窗口/);
});
(0, import_node_test.default)("a wrong generation cannot finish or release the current owner's work", async (t) => {
  const { a, b } = await setup(t, true);
  const generation = await a.beginGeneration(frame());
  await a.finishGeneration(frame("chat-1", 9, "wrong", (0, import_node_crypto3.randomUUID)()));
  await import_strict.default.rejects(b.beginGeneration(frame()), /另一个窗口/);
  await a.finishGeneration(frame("chat-1", 10, "right", generation));
  import_strict.default.ok(JSON.stringify((await a.readChat(hubChatKey(a.workspace.id, uri("chat-1"))))?.data).includes("right"));
});
(0, import_node_test.default)("a foreign workspace can view but never adopt a continuation", async (t) => {
  const { a, b } = await setup(t);
  await a.publishChat(frame());
  const key = hubChatKey(a.workspace.id, uri("chat-1"));
  import_strict.default.ok(await b.readChat(key));
  await import_strict.default.rejects(b.prepareContinuation(key), /所属的工作区/);
});
(0, import_node_test.default)("closed-owner recovery claims only the original workspace, strips drafts and queues", async (t) => {
  const { a, b } = await setup(t, true);
  await a.publishChat(frame());
  const key = hubChatKey(a.workspace.id, uri("chat-1"));
  await a.dispose();
  const resumed = await b.prepareContinuation(key);
  import_strict.default.equal(resumed.ownerWindowId, b.windowId);
  import_strict.default.ok(!JSON.stringify(resumed.data).includes("UNSENT_DRAFT"));
  import_strict.default.ok(!JSON.stringify(resumed.data).includes("NEVER_REPLAY"));
});
(0, import_node_test.default)("a closed owner leaves an interrupted record rather than pretending completion", async (t) => {
  const { a, b, publish } = await setup(t, true);
  await a.beginGeneration(frame());
  await publish(a);
  import_strict.default.equal((await b.listChats())[0].status, "running");
  await a.dispose();
  import_strict.default.equal((await b.listChats())[0].status, "interrupted");
  await b.prepareContinuation(hubChatKey(a.workspace.id, uri("chat-1")));
});
(0, import_node_test.default)("deletion cannot race a foreign generation before its heartbeat is published", async (t) => {
  const { a, b } = await setup(t, true);
  const generation = await a.beginGeneration(frame());
  await import_strict.default.rejects(b.deleteChat(uri("chat-1")), /先在原窗口停止生成/);
  import_strict.default.equal((await a.readChat(hubChatKey(a.workspace.id, uri("chat-1"))))?.deleted, false);
  await a.finishGeneration(frame("chat-1", 2, "done", generation));
});
(0, import_node_test.default)("tombstones erase shared contents and prevent stale history imports resurrecting them", async (t) => {
  const { a, b } = await setup(t, true);
  await a.publishChat(frame());
  await a.deleteChat(uri("chat-1"));
  import_strict.default.equal(await b.publishChat(frame(), true), false);
  import_strict.default.equal((await a.listChats()).length, 0);
  import_strict.default.equal((await a.readChat(hubChatKey(a.workspace.id, uri("chat-1"))))?.data, null);
});
(0, import_node_test.default)("continuation requests are consumed once, by the intended original window", async (t) => {
  const { a, b } = await setup(t, true);
  await a.publishChat(frame());
  const value = await a.readChat(hubChatKey(a.workspace.id, uri("chat-1")));
  await b.requestContinuation(value, a.windowId);
  const openedA = [], openedB = [];
  await Promise.all([a.consumeRequests(async (key) => {
    openedA.push(key);
  }), b.consumeRequests(async (key) => {
    openedB.push(key);
  })]);
  await a.consumeRequests(async (key) => {
    openedA.push(key);
  });
  import_strict.default.deepEqual(openedA, [value.key]);
  import_strict.default.deepEqual(openedB, []);
});
(0, import_node_test.default)("concurrent imports of the same archive never lose or duplicate its record", async (t) => {
  const { a, b } = await setup(t, true);
  const results = await Promise.all([a.publishChat(frame(), true), b.publishChat(frame(), true)]);
  import_strict.default.equal(results.filter(Boolean).length, 1);
  import_strict.default.equal((await a.listChats()).length, 1);
});
(0, import_node_test.default)("resource identity and record keys are validated before storage access", async (t) => {
  const { a, root } = await setup(t);
  await import_strict.default.rejects(a.readChat("../../private"), /Invalid hub record key/);
  await import_strict.default.rejects(a.publishChat({ ...frame(), sessionResource: uri("different") }), /does not match/);
  await import_strict.default.rejects(a.publishChat({ ...frame(), serialized: '{"sessionId":"other","requests":[]}' }), /Invalid serialized/);
  import_strict.default.equal((await fs2.readdir(import_node_path3.default.join(root, "chats"))).length, 0);
});
(0, import_node_test.default)("one corrupt catalog record does not hide valid chats", async (t) => {
  const { a, root } = await setup(t);
  await a.publishChat(frame());
  await fs2.writeFile(import_node_path3.default.join(root, "chats", `${"f".repeat(64)}.json`), "broken JSON");
  import_strict.default.equal((await a.listChats()).length, 1);
});
(0, import_node_test.default)("a late finish cannot roll back a newer final snapshot", async (t) => {
  const { a } = await setup(t);
  const generation = await a.beginGeneration(frame());
  await a.publishChat(frame("chat-1", 9, "newer metadata and reply", generation));
  await a.finishGeneration(frame("chat-1", 8, "older captured finish", generation));
  const value = await a.readChat(hubChatKey(a.workspace.id, uri("chat-1")));
  import_strict.default.equal(value?.active, false);
  import_strict.default.equal(value?.sourceSequence, 9);
  import_strict.default.ok(JSON.stringify(value?.data).includes("newer metadata and reply"));
});
(0, import_node_test.default)("catalog cache observes atomic replacements even with equal size and mtime", async (t) => {
  const { a, root } = await setup(t);
  await a.publishChat(frame("chat-1", 1, "same size"));
  const key = hubChatKey(a.workspace.id, uri("chat-1"));
  const file = import_node_path3.default.join(root, "chats", `${key}.json`);
  const stamp = new Date(Math.floor((await fs2.stat(file)).mtimeMs / 1e3) * 1e3);
  await fs2.utimes(file, stamp, stamp);
  const before = await fs2.stat(file);
  await a.listChats();
  const value = await a.readChat(key);
  value.title = "world";
  value.revision++;
  const temporary = file + ".test-replacement";
  await fs2.writeFile(temporary, JSON.stringify(value));
  await fs2.utimes(temporary, before.atime, before.mtime);
  await fs2.rename(temporary, file);
  import_strict.default.equal((await fs2.stat(file)).size, before.size);
  import_strict.default.equal((await fs2.stat(file)).mtimeMs, before.mtimeMs);
  import_strict.default.equal((await a.listChats())[0].title, "world");
});
(0, import_node_test.default)("disposed stores cannot recreate their window or write late snapshots", async (t) => {
  const { a, publish } = await setup(t);
  await a.dispose();
  await import_strict.default.rejects(publish(a), /closing/);
  await import_strict.default.rejects(a.publishChat(frame()), /closing/);
});
(0, import_node_test.default)("window snapshots carry the instance registry fields and reject malformed ones", async (t) => {
  const { a, b, clock, root } = await setup(t);
  await a.publishWindow({
    version: 1,
    windowId: a.windowId,
    workspace: a.workspace,
    updatedAt: clock.now,
    bridge: { state: "stopped", provider: "cloudflare", domain: "", connected: false, todos: [] },
    activeChats: [],
    instanceId: "instance-a",
    userDataDir: "/Users/me/Library/Application Support/ShunCode-2",
    pid: 4242
  });
  const seen = (await b.listWindows()).find((w) => w.windowId === a.windowId);
  import_strict.default.equal(seen.instanceId, "instance-a");
  import_strict.default.equal(seen.userDataDir, "/Users/me/Library/Application Support/ShunCode-2");
  import_strict.default.equal(seen.pid, 4242);
  const file = import_node_path3.default.join(root, "windows", `${a.windowId}.json`);
  const broken = { ...JSON.parse(await fs2.readFile(file, "utf8")), pid: "4242" };
  await fs2.writeFile(file, JSON.stringify(broken));
  import_strict.default.equal((await b.listWindows()).some((w) => w.windowId === a.windowId), false);
});
(0, import_node_test.default)("window actions are delivered only to the addressed live window and never open a chat", async (t) => {
  const { a, b } = await setup(t, true);
  const [windowA] = (await a.listWindows()).filter((w) => w.windowId === a.windowId);
  await b.requestWindowAction(windowA, "focus");
  await b.requestWindowAction(windowA, "copy-address");
  const openedA = [], actsA = [], openedB = [], actsB = [];
  await b.consumeRequests(async (key) => {
    openedB.push(key);
  }, async (kind) => {
    actsB.push(kind);
  });
  await a.consumeRequests(async (key) => {
    openedA.push(key);
  }, async (kind) => {
    actsA.push(kind);
  });
  await a.consumeRequests(async (key) => {
    openedA.push(key);
  }, async (kind) => {
    actsA.push(kind);
  });
  import_strict.default.deepEqual(openedA, []);
  import_strict.default.deepEqual(openedB, []);
  import_strict.default.deepEqual(actsB, []);
  import_strict.default.deepEqual(actsA.sort(), ["copy-address", "focus"]);
});
(0, import_node_test.default)("an untargeted continuation waits for any window of the owning workspace (cold-started instance)", async (t) => {
  const { a, b, clock } = await setup(t);
  await a.publishChat(frame());
  const value = await a.readChat(hubChatKey(a.workspace.id, uri("chat-1")));
  await b.requestContinuation(value);
  const openedB = [];
  await b.consumeRequests(async (key) => {
    openedB.push(key);
  });
  import_strict.default.deepEqual(openedB, [], "a foreign workspace must not consume it");
  clock.now += 6e4;
  const late = new WorkspaceHubStore(a.root, (0, import_node_crypto3.randomUUID)(), workspace("a"), () => clock.now);
  await late.initialize();
  t.after(() => late.dispose());
  const openedLate = [];
  await late.consumeRequests(async (key) => {
    openedLate.push(key);
  });
  import_strict.default.deepEqual(openedLate, [value.key]);
});
(0, import_node_test.default)("management delete tombstones one record by key while a foreign generation blocks it", async (t) => {
  const { a, b } = await setup(t, true);
  const key = hubChatKey(a.workspace.id, uri("chat-1"));
  const generation = await a.beginGeneration(frame());
  await import_strict.default.rejects(b.deleteChatByKey(key), /先在原窗口停止生成/);
  await a.finishGeneration(frame("chat-1", 2, "done", generation));
  await import_strict.default.rejects(b.deleteChatByKey("../../private"), /Invalid chat key/);
  await b.deleteChatByKey(key);
  await b.deleteChatByKey("e".repeat(64));
  const tombstone = await a.readChat(key);
  import_strict.default.equal(tombstone?.deleted, true);
  import_strict.default.equal(tombstone?.data, null);
  import_strict.default.equal((await a.listChats()).length, 0);
});
(0, import_node_test.default)("startup sweep keeps the newest record per native session and skips live generations", async (t) => {
  const { root, clock } = await setup(t);
  const oldA = new WorkspaceHubStore(root, (0, import_node_crypto3.randomUUID)(), workspace("old-window-1"), () => clock.now);
  const oldB = new WorkspaceHubStore(root, (0, import_node_crypto3.randomUUID)(), workspace("old-window-2"), () => clock.now);
  await Promise.all([oldA.initialize(), oldB.initialize()]);
  t.after(async () => {
    await Promise.all([oldA.dispose(), oldB.dispose()]);
  });
  await oldA.publishChat(frame("dup", 1, "stale incarnation"));
  clock.now += 1e3;
  await oldB.publishChat(frame("dup", 1, "newest incarnation"));
  const live = new WorkspaceHubStore(root, (0, import_node_crypto3.randomUUID)(), workspace("old-window-3"), () => clock.now);
  const newer = new WorkspaceHubStore(root, (0, import_node_crypto3.randomUUID)(), workspace("old-window-4"), () => clock.now);
  await Promise.all([live.initialize(), newer.initialize()]);
  t.after(async () => {
    await Promise.all([live.dispose(), newer.dispose()]);
  });
  const liveGeneration = await live.beginGeneration(frame("livedup", 1, "still generating"));
  clock.now += 1e3;
  await newer.publishChat(frame("livedup", 1, "newer incarnation"));
  const before = await oldA.listChats();
  import_strict.default.equal(before.filter((c) => c.sessionResource === uri("dup")).length, 2);
  const swept = await oldA.sweepSupersededChatRecords();
  import_strict.default.equal(swept, 1);
  const after = await oldA.listChats();
  const survivors = after.filter((c) => c.sessionResource === uri("dup"));
  import_strict.default.equal(survivors.length, 1);
  import_strict.default.ok(JSON.stringify((await oldA.readChat(survivors[0].key))?.data).includes("newest incarnation"));
  import_strict.default.equal((await oldA.readChat(hubChatKey(oldA.workspace.id, uri("dup"))))?.deleted, true);
  import_strict.default.equal((await oldA.listChats()).filter((c) => c.sessionResource === uri("livedup")).length, 2);
  import_strict.default.equal(await oldA.sweepSupersededChatRecords(), 0);
  await live.finishGeneration(frame("livedup", 2, "done", liveGeneration));
});
