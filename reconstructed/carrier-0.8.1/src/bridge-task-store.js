// EXTRACTED from src/bridge-task-store.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var copyTodos = (todos) => todos.map((t) => ({ ...t }));
var record2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var isTerminal = (state) => state === "completed" || state === "cancelled" || state === "cleared";
var BridgeTaskStore = class {
  constructor(maxTodos, now = Date.now, maxTasks = 32, maxHistory = 8, terminalLimit = 8, terminalTtlMs = 24 * 60 * 60 * 1e3) {
    this.maxTodos = maxTodos;
    this.now = now;
    this.maxTasks = maxTasks;
    this.maxHistory = maxHistory;
    this.terminalLimit = terminalLimit;
    this.terminalTtlMs = terminalTtlMs;
  }
  maxTodos;
  now;
  maxTasks;
  maxHistory;
  terminalLimit;
  terminalTtlMs;
  tasks = /* @__PURE__ */ new Map();
  currentByOwner = /* @__PURE__ */ new Map();
  /** Session hints are untrusted; namespace them by the authenticated task owner. */
  overviewBySession = /* @__PURE__ */ new Map();
  selectedId;
  /** Soft retention: expire terminal records after 24h and keep at most the newest eight.
   * Never remove active, stale, blocked or interrupted tasks. Snapshot calls also sweep.
   */
  pruneTerminal() {
    const terminal = [...this.tasks.values()].filter((task) => isTerminal(task.state)).reverse().sort((a, b) => b.updatedAt - a.updatedAt);
    let removed = 0;
    for (const [index, task] of terminal.entries()) {
      if (index >= this.terminalLimit || this.now() - task.updatedAt >= this.terminalTtlMs) {
        this.forget(task.id);
        removed++;
      }
    }
    return removed;
  }
  /** Called only behind a local confirmation prompt, never through an MCP tool.
   * Validate the whole batch before removing any record; stale or revived tasks abort.
   */
  clearTasks(requests, allowAttention = false) {
    if (!Array.isArray(requests) || !requests.length || requests.length > this.maxTasks) throw new Error("Select a bounded non-empty batch of Bridge tasks to clear.");
    const seen = /* @__PURE__ */ new Set();
    for (const item of requests) {
      if (!item || typeof item.id !== "string" || !item.id || seen.has(item.id) || !Number.isSafeInteger(item.revision)) throw new Error("Invalid or duplicate task clear request.");
      seen.add(item.id);
      const task = this.tasks.get(item.id);
      if (!task || task.revision !== item.revision) throw new Error("Task changed or expired; refresh the list and confirm again.");
      if (!isTerminal(task.state) && !(allowAttention && (task.state === "blocked" || task.state === "interrupted"))) {
        throw new Error("Running, planning and awaiting-sync tasks cannot be cleared here. Blocked or interrupted tasks require explicit warning.");
      }
    }
    for (const { id } of requests) this.forget(id);
    if (!this.selectedId) this.selectedId = [...this.tasks.keys()].at(-1);
    return requests.length;
  }
  resolve(owner, value) {
    const input = record2(value);
    if (input.task_id !== void 0 && (typeof input.task_id !== "string" || !input.task_id || input.task_id.length > 80)) throw new Error("task_id must be a non-empty task handle returned by Bridge.");
    const id = input.task_id;
    const task = this.tasks.get(id ?? this.currentByOwner.get(owner) ?? "");
    if (id && !task) throw new Error("Unknown or expired task_id. Start a new task; do not replay an obsolete snapshot.");
    if (task && task.owner !== owner) throw new Error("task_id belongs to a different client session; start a new task instead of adopting it.");
    return task;
  }
  update(owner, todos, value) {
    const input = record2(value);
    if (input.new_task !== void 0 && typeof input.new_task !== "boolean") throw new Error("new_task must be boolean.");
    if (input.new_task && (input.task_id !== void 0 || input.expected_revision !== void 0)) throw new Error("new_task cannot resume or revise an existing task.");
    if (input.mode !== void 0 && input.mode !== "replace" && input.mode !== "patch") throw new Error("mode must be replace or patch.");
    if (input.lifecycle !== void 0 && !["running", "completed", "blocked", "cancelled"].includes(String(input.lifecycle))) throw new Error("Invalid task lifecycle.");
    if (input.source_label !== void 0 && (typeof input.source_label !== "string" || input.source_label.length > 80)) throw new Error("source_label must be at most 80 characters.");
    for (const key of ["overview_model", "overview_provider"]) {
      if (input[key] !== void 0 && (typeof input[key] !== "string" || input[key].length > 80)) throw new Error(`${key} must be at most 80 characters.`);
    }
    if (input.overview_session_id !== void 0 && (typeof input.overview_session_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.overview_session_id))) {
      throw new Error("overview_session_id must be a random UUID v4, not a client or task identity.");
    }
    this.pruneTerminal();
    let previous = input.new_task ? void 0 : this.resolve(owner, input);
    if (input.new_task && owner.startsWith("native-chat:")) {
      const reserved = this.tasks.get(this.currentByOwner.get(owner) ?? "");
      if (reserved?.state === "waiting_plan" && reserved.revision === 1 && !reserved.todos.length) previous = reserved;
    }
    if (previous?.overviewSessionId && input.overview_session_id && previous.overviewSessionId !== input.overview_session_id) {
      throw new Error("Cannot move an existing task to a different overview session.");
    }
    const explicit = input.task_id !== void 0;
    if ((explicit || input.mode === "patch") && input.expected_revision === void 0) throw new Error("Provide expected_revision from the last acknowledgement for task_id or patch updates.");
    if (input.expected_revision !== void 0) {
      if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision !== previous?.revision) throw new Error(`Task revision conflict; current revision is ${previous?.revision ?? "missing"}. No changes applied.`);
    }
    if (input.mode === "patch") {
      if (!previous) throw new Error("A patch requires an existing task.");
      const patch = new Map(todos.map((t) => [t.id, t]));
      todos = [...previous.todos.map((t) => patch.get(t.id) ?? t), ...todos.filter((t) => !previous.todos.some((old) => old.id === t.id))];
    }
    todos = parseBridgeTodos({ todos }, this.maxTodos);
    const complete = todos.length > 0 && todos.every((t) => t.status === "completed");
    if (input.lifecycle === "completed" && !complete) throw new Error("Completion requires a non-empty, fully completed snapshot.");
    if (previous && isTerminal(previous.state)) {
      const unchanged = todos.length === previous.todos.length && todos.every((todo, index) => todo.id === previous.todos[index].id && todo.title === previous.todos[index].title && todo.status === previous.todos[index].status);
      if (todos.length && unchanged) return this.publicTask(previous);
      if (explicit || input.mode === "patch" || input.expected_revision !== void 0) throw new Error("\u5DF2\u7ED3\u675F\u4EFB\u52A1\u5361\u4E0D\u80FD\u7EED\u5199\u6216\u91CD\u65B0\u6253\u5F00\uFF1B\u8BF7\u7528 new_task=true \u65B0\u5EFA\u4EFB\u52A1\u5361\uFF0C\u539F\u4EFB\u52A1\u4FDD\u6301\u539F\u6837\u3002");
      if (todos.length) previous = void 0;
    } else if (previous && (previous.state === "blocked" || previous.state === "interrupted") && todos.some((todo) => !previous.todos.some((old) => old.id === todo.id))) {
      if (explicit || input.mode === "patch" || input.expected_revision !== void 0) throw new Error("\u5DF2\u963B\u585E\u6216\u4E2D\u65AD\u7684\u4EFB\u52A1\u5361\u4E0D\u80FD\u8FFD\u52A0\u65B0\u6B65\u9AA4\uFF1B\u8BF7\u7528 new_task=true \u65B0\u5EFA\u4EFB\u52A1\u5361\u3002\u539F\u6B65\u9AA4\u4ECD\u53EF\u7EE7\u7EED\u66F4\u65B0\u3002");
      previous = void 0;
    }
    if (!todos.length && !explicit && !input.new_task) {
      if (previous && !isTerminal(previous.state)) this.forget(previous.id);
      return void 0;
    }
    if (!previous && !todos.length && !input.new_task) return void 0;
    const state = complete ? "completed" : !todos.length ? input.new_task ? "waiting_plan" : "cleared" : input.lifecycle ?? "running";
    const at = this.now();
    const removed = previous?.todos.filter((t) => !todos.some((next) => next.id === t.id)) ?? [];
    const revision = (previous?.revision ?? 0) + 1;
    const label = input.source_label === void 0 ? previous?.source?.label : input.source_label.replace(/[\x00-\x1f\x7f]/g, " ").trim();
    const sessionId = input.overview_session_id ?? previous?.overviewSessionId;
    const sessionKey = sessionId ? `${owner}\0${sessionId}` : void 0;
    const model = input.overview_model?.replace(/[\x00-\x1f\x7f]/g, " ").trim();
    const provider = input.overview_provider?.replace(/[\x00-\x1f\x7f]/g, " ").trim();
    const overview = (sessionKey ? this.overviewBySession.get(sessionKey) : void 0) ?? previous?.overview ?? (model ? { label: model, kind: "model", verified: false } : provider ? { label: provider, kind: "provider", verified: false } : void 0);
    const task = {
      id: previous?.id ?? (0, import_node_crypto20.randomUUID)(),
      owner,
      revision,
      updatedAt: at,
      createdAt: previous ? previous.createdAt : at,
      overviewSessionId: sessionId,
      ...overview ? { overview } : {},
      ...label ? { source: { label, verified: false } } : {},
      state,
      todos: copyTodos(todos),
      history: [...previous?.history ?? [], { revision, at, state, completed: todos.filter((t) => t.status === "completed").length, total: todos.length, removed: copyTodos(removed) }].slice(-this.maxHistory)
    };
    if (!previous && this.tasks.size >= this.maxTasks) {
      const reclaimable = [...this.tasks.values()].find((old) => isTerminal(old.state));
      if (!reclaimable) throw new Error(`\u4EFB\u52A1\u5BB9\u91CF\u5DF2\u6EE1\uFF08\u4E0A\u9650 ${this.maxTasks} \u9879\uFF09\uFF1A\u6CA1\u6709\u53EF\u5B89\u5168\u56DE\u6536\u7684\u5DF2\u7ED3\u675F\u4EFB\u52A1\uFF0C\u672A\u4FEE\u6539\u4EFB\u4F55\u4EFB\u52A1\u3002\u8BF7\u5B8C\u6210\u6216\u53D6\u6D88\u53EF\u7ED3\u675F\u7684\u4EFB\u52A1\uFF1B\u6301\u6709 task_id \u7684\u539F\u8C03\u7528\u65B9\u4E5F\u53EF\u5C06\u81EA\u5DF1\u7684\u65E7\u4EFB\u52A1\u8BBE\u4E3A cleared \u540E\u91CD\u8BD5\u3002\u5DF2\u6709\u4EFB\u52A1\u4ECD\u53EF\u66F4\u65B0\u3002`);
      this.forget(reclaimable.id);
    }
    if (previous && previous.owner !== owner && this.currentByOwner.get(previous.owner) === task.id) this.currentByOwner.delete(previous.owner);
    this.tasks.delete(task.id);
    this.tasks.set(task.id, task);
    this.currentByOwner.set(owner, task.id);
    if (overview && sessionKey && !this.overviewBySession.has(sessionKey)) {
      if (this.overviewBySession.size >= 64) this.overviewBySession.delete(this.overviewBySession.keys().next().value);
      this.overviewBySession.set(sessionKey, overview);
    }
    this.selectedId = task.id;
    return this.publicTask(task);
  }
  /** Transient progress may link by capability, but cannot claim completion or steal selection. */
  forProgress(owner, value) {
    const task = this.resolve(owner, value);
    return task ? this.publicTask(task) : void 0;
  }
  touch(id) {
    const task = this.tasks.get(id);
    if (task && ["running", "waiting_plan"].includes(task.state)) task.updatedAt = this.now();
  }
  /** Store only one fresh, owner-checked, in-progress step report per task. */
  recordProgress(owner, taskId, todoId, value) {
    const task = this.tasks.get(taskId);
    if (!task || task.owner !== owner || task.state !== "running") return;
    if (todoId && !task.todos.some((todo) => todo.id === todoId && todo.status === "in_progress")) return;
    task.progress = {
      ...todoId ? { todoId } : {},
      taskRevision: task.revision,
      at: this.now(),
      ...value.percent !== void 0 ? { percent: value.percent } : {},
      ...value.phase !== void 0 ? { phase: value.phase } : {},
      ...value.message !== void 0 ? { message: value.message } : {}
    };
  }
  clearProgress() {
    let cleared = 0;
    for (const task of this.tasks.values()) if (task.progress) {
      task.progress = null;
      cleared++;
    }
    return cleared;
  }
  /** Drop a job and its selection; used by the legacy clear form and by capacity eviction. */
  forget(id) {
    this.tasks.delete(id);
    for (const [owner, taskId] of this.currentByOwner) if (taskId === id) this.currentByOwner.delete(owner);
    if (this.selectedId === id) this.selectedId = void 0;
  }
  disconnect(owner) {
    let changed = false;
    for (const task of this.tasks.values()) {
      if (task.owner === owner && ["running", "waiting_plan"].includes(task.state)) {
        task.state = "interrupted";
        task.progress = null;
        task.revision++;
        task.updatedAt = this.now();
        task.history = [...task.history, { revision: task.revision, at: task.updatedAt, state: task.state, completed: task.todos.filter((t) => t.status === "completed").length, total: task.todos.length, removed: [] }].slice(-this.maxHistory);
        changed = true;
      }
    }
    return changed;
  }
  publicTask(task) {
    const state = ["running", "waiting_plan"].includes(task.state) && this.now() - task.updatedAt >= 9e4 ? "awaiting_sync" : task.state;
    const progress = state === "running" && task.progress && task.progress.taskRevision === task.revision && this.now() - task.progress.at < 5 * 6e4 && (!task.progress.todoId || task.todos.some((todo) => todo.id === task.progress?.todoId && todo.status === "in_progress")) ? { ...task.progress } : null;
    return {
      id: task.id,
      revision: task.revision,
      updatedAt: task.updatedAt,
      originKind: task.owner.startsWith("native-chat:") ? "chat" : "bridge",
      ...task.overview ? { overview: { ...task.overview } } : {},
      ...task.overviewSessionId ? { overviewSessionTag: task.overviewSessionId.slice(0, 8).toUpperCase() } : {},
      ...task.createdAt !== void 0 ? { createdAt: task.createdAt } : {},
      ...task.source ? { source: { ...task.source, verified: false } } : {},
      attribution: { ownerBound: true, clientVerified: false, sessionVerified: false },
      progress,
      state,
      todos: copyTodos(task.todos),
      history: task.history.map((h) => ({ ...h, removed: copyTodos(h.removed) }))
    };
  }
  snapshot() {
    this.pruneTerminal();
    return { taskId: this.selectedId, tasks: [...this.tasks.values()].reverse().map((t) => this.publicTask(t)) };
  }
  selectedTodos() {
    return copyTodos(this.tasks.get(this.selectedId ?? "")?.todos ?? []);
  }
  /** Local Chat Code only: expose a truthful planning card before the model calls a tool. */
  ensureNativeChat(owner, model) {
    if (!/^native-chat:[0-9a-f-]{36}$/i.test(owner)) throw new Error("Invalid native Chat task owner.");
    const existing = this.tasks.get(this.currentByOwner.get(owner) ?? "");
    if (existing && !isTerminal(existing.state)) {
      this.selectedId = existing.id;
      return this.publicTask(existing);
    }
    return this.update(owner, [], { new_task: true, overview_model: model, overview_session_id: owner.slice("native-chat:".length) });
  }
  /** Only settle the untouched placeholder; never overwrite an agent-authored plan. */
  finishNativeChat(owner, taskId, revision, succeeded) {
    const task = this.tasks.get(taskId);
    if (!task || task.owner !== owner || task.revision !== revision || task.state !== "waiting_plan" || task.todos.length) return false;
    this.update(
      owner,
      [{ id: "chat-response", title: "\u5904\u7406\u5F53\u524D Chat \u8BF7\u6C42", status: succeeded ? "completed" : "in_progress" }],
      { task_id: taskId, expected_revision: revision, lifecycle: succeeded ? "completed" : "blocked" }
    );
    return true;
  }
};
