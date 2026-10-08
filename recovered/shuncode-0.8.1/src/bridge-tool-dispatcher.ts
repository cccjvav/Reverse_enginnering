import { BridgeTaskStore } from "../../../src/bridge-task-store.js";
import { ideToolStructuredContent } from "../../../src/ide-tool-output.js";
import { BridgeActivityTracker, type BridgeActivitySnapshot } from "../../../src/bridge-activity-tracker.js";
import { parseBridgePlan, parseBridgeProgress, parseBridgeTodos } from "../../../src/bridge-coordination-validation.js";
import { executeCustomTool, findCustomTool, type CustomToolManifest } from "../../../src/custom-tools.js";
import { resolveBridgeToolName } from "../../../src/bridge-tool-name.js";
import {
  isFileToolCompatibilityAlias,
  normalizeFileToolInput,
  normalizeFileToolName,
} from "../../../src/file-tool-input-compat.js";
import { invokeFileTool, isFileToolName } from "../../../src/file-tool-registry.js";
import { BRIDGE_EXCLUDED_TOOL_NAMES, getIdeToolDefinition } from "../../../src/ide-tool-definitions.js";
import { NATIVE_MANAGED_COMMAND_OWNER_ID } from "../../../src/managed-command-cancellation.js";
import { validateToolInput } from "../../../src/tool-input-validation.js";
import { Semaphore } from "../../../src/concurrency.js";
import type { CallToolResult as McpCallToolResult } from "@modelcontextprotocol/server";
import { AdaptiveConcurrencyController } from "../../../src/adaptive-concurrency.js";
import {
  BRIDGE_TOOL_DEFINITIONS,
  CONFIGURE_MCP_TOOL,
  DEFAULT_BRIDGE_TOOL_CONCURRENCY,
  MAX_BRIDGE_TOOL_CONCURRENCY,
  MAX_ACTIVITY,
  MAX_TODOS,
  REPORT_PROGRESS_TOOL,
  SET_TODOS_TOOL,
  UPDATE_PLAN_TOOL,
} from "./bridge-constants.js";
import type { BridgeActivity, BridgeActivityPresentation, BridgeTodo } from "./bridge-constants.js";
import { LIST_SKILLS_TOOL, formatSkillListing, type AgentSkillListing } from "./skill-list-tool.js";
import { runConfigureMcp, type ConfigureMcpDeps } from "../../../src/configure-mcp.js";
import { asRecord, bridgePresentation } from "./bridge-utils.js";

/**
 * The shape a single tool invocation returns to the MCP layer. Never throws to
 * the session: unknown tools, validation failures, file-tool and IDE-tool
 * errors are all surfaced as `isError` tool results.
 */
export interface ToolCallResult {
  content: McpCallToolResult['content'];
  isError?: boolean;
  structuredContent?: unknown;
}

/**
 * Tools that must never wait behind the concurrency gate.
 *
 * These observe or stop work that already holds a permit. If they queued, a
 * client whose long-running commands had saturated the gate could no longer
 * cancel them or read their output — the gate would deadlock the very calls
 * that free it. They are cheap and do not spawn terminals, so exempting them
 * costs nothing.
 */
const CONCURRENCY_EXEMPT_TOOLS = new Set([
  "cancel_command",
  "get_command_output",
  "send_command_input",
]);

/** configure_mcp args carry inline API keys; only action/target/id are safe to show in the local activity row. */
function configureMcpActivityArgs(args: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (typeof args.action === "string") safe.action = args.action;
  if (typeof args.target === "string") safe.target = args.target;
  if (typeof args.id === "string") safe.id = args.id;
  return safe;
}

/**
 * Narrow, injectable dependencies. The dispatcher must not import `vscode`: the
 * IDE-tool invocation (with its CancellationToken bridging), the workspace root
 * resolution, and logging are all provided by the facade through this seam so a
 * fake adapter can drive the dispatcher deterministically in tests.
 */
export interface ToolDispatcherDeps {
  /** Windows 平台保留：技能源总开关（Mac 版由 custom-tools 内部默认处理）。 */
  skillsEnabled?(): boolean;
  /** Invoke an IDE tool by name; the facade bridges the AbortSignal to a VS Code CancellationToken. */
  invokeIdeTool(
    toolName: string,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
    commandOwnerId: string,
  ): Promise<{ text: string; isError: boolean; structuredContent?: Record<string, unknown> }>;
  /** Current workspace roots; throws when no folder is open (parity with the facade). */
  workspaceRoots(): string[];
  /**
   * Roots the controlled file tools (read_files, apply_patch, search_files, ...) may use: the workspace
   * folders plus the configured global Skill directory (0.7.7). Falls back to workspaceRoots() when absent.
   * Custom tools and commands keep using workspaceRoots().
   */
  fileToolRoots?(): string[];
  isWorkspaceTrusted?(): boolean;
  /** Read-only listing of the installed skills (the facade feeds it from skill-center). */
  listSkills?(): AgentSkillListing;
  externalMcp?: {
    hasBinding(name: string): boolean;
    call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallToolResult | undefined>;
  };
  /** Configure OTHER MCP servers (configure_mcp tool). Provided by the facade with the vscode-backed catalog. */
  configureMcp?: ConfigureMcpDeps;
  log(message: string): void;
}

/**
 * Sole owner of the tool-side Bridge state: activity tracker, todos, and the
 * tool-side revision. The facade keeps its own revision for
 * session/tunnel lifecycle events and sums the two in getStatus(); every
 * activity/todo event therefore still increments the aggregate exactly once.
 */
export class BridgeToolDispatcher {
  private readonly activityTracker = new BridgeActivityTracker<BridgeActivityPresentation>(MAX_ACTIVITY);
  private readonly taskStore = new BridgeTaskStore(MAX_TODOS);
  /** task owner -> command owner seen with it, so a vanished MCP session can still interrupt its job. */
  private readonly taskCommandOwners = new Map<string, string>();
  private revision_ = 0;
  /**
   * Caps tool calls executed at once across BOTH protocol eras.
   *
   * The modern (2026) path is stateless — every request builds its own server
   * and nothing serialises them — so without this a client can hold an
   * unbounded number of managed terminals open at the same time. Callers over
   * the limit queue instead of failing, so a burst stays correct and merely
   * takes longer.
   */
  private readonly toolGate: Semaphore;
  /** External requests never occupy all permits needed for built-in file and IDE tools. */
  private readonly externalToolGate: Semaphore;

  /**
   * Tunes `toolGate` from observed load. Bandwidth is not a usable signal here
   * (see adaptive-concurrency.ts); queueing, latency and failures are.
   */
  private readonly adaptive: AdaptiveConcurrencyController;

  constructor(private readonly deps: ToolDispatcherDeps, concurrency = DEFAULT_BRIDGE_TOOL_CONCURRENCY) {
    this.toolGate = new Semaphore(concurrency);
    this.externalToolGate = new Semaphore(Math.max(2, Math.min(4, Math.floor(concurrency / 4))));
    this.adaptive = new AdaptiveConcurrencyController({
      min: concurrency,
      max: Math.max(concurrency, MAX_BRIDGE_TOOL_CONCURRENCY),
    });
  }

  /** Tool-side revision counter; the facade adds this to its own for getStatus(). */
  get revision(): number {
    return this.revision_;
  }

  /** Copy of the current todos for BridgeStatus. */
  snapshotTodos(): BridgeTodo[] {
    return this.taskStore.selectedTodos();
  }

  snapshotTaskState() {
    if (this.taskStore.pruneTerminal()) this.revision_++;
    return this.taskStore.snapshot();
  }

  /** Local native Chat task lifecycle; not exposed as an MCP tool. */
  ensureNativeChatTask(owner: string, model: string) {
    const before = this.taskStore.snapshot().taskId;
    const task = this.taskStore.ensureNativeChat(owner, model);
    if (before !== task.id) this.revision_++;
    return task;
  }

  finishNativeChatTask(owner: string, taskId: string, revision: number, succeeded: boolean): void {
    if (this.taskStore.finishNativeChat(owner, taskId, revision, succeeded)) this.revision_++;
  }

  /** Local UI only; the MCP dispatcher never exposes this as a tool. */
  clearTasks(requests: readonly { id: string; revision: number }[], allowAttention = false): number {
    const removed = this.taskStore.clearTasks(requests, allowAttention);
    if (removed) this.revision_++;
    return removed;
  }

  /** Activity + stats snapshot for BridgeStatus. */
  snapshotActivity(): BridgeActivitySnapshot<BridgeActivityPresentation> {
    return this.activityTracker.snapshot();
  }

  /** Clears finished tool calls (keeping running ones) and bumps the revision. */
  clearActivity(): number {
    const removed = this.activityTracker.clear();
    const progressCleared = this.taskStore.clearProgress();
    if (removed > 0 || progressCleared > 0) {
      this.revision_ += 1;
    }
    return removed;
  }

  beginRemoteConversation(_commandOwnerId: string): void {
    // A connection is not a task. Never clear or select a plan on initialize.
  }


  endRemoteConversation(commandOwnerId: string): void {
    let changed = this.taskStore.disconnect(commandOwnerId);
    for (const [taskOwnerId, seenCommandOwnerId] of this.taskCommandOwners) {
      if (seenCommandOwnerId === commandOwnerId) changed = this.taskStore.disconnect(taskOwnerId) || changed;
    }
    if (changed) this.revision_ += 1;
  }

  private rememberTaskCommandOwner(taskOwnerId: string, commandOwnerId: string): void {
    this.taskCommandOwners.delete(taskOwnerId);
    this.taskCommandOwners.set(taskOwnerId, commandOwnerId);
    while (this.taskCommandOwners.size > 32) this.taskCommandOwners.delete(this.taskCommandOwners.keys().next().value!);
  }

  // ---- Dispatch ------------------------------------------------------------

  /**
   * Route the call to its handler. Tool-call counts are no longer collected
   * for upload to the license server; the activity tracker keeps the local
   * statistics shown in the Bridge panel.
   */
  async dispatch(
    rawToolName: string,
    args: Record<string, unknown>,
    extra: { signal?: AbortSignal; commandOwnerId?: string; taskOwnerId?: string },
  ): Promise<ToolCallResult> {
    const commandOwnerId = extra.commandOwnerId ?? NATIVE_MANAGED_COMMAND_OWNER_ID;
    const run = () => this.handleToolCall(rawToolName, args, { signal: extra.signal, commandOwnerId, taskOwnerId: extra.taskOwnerId });
    // Control-plane tools bypass the gate on purpose: they are the only way to
    // observe or stop work that already holds a permit, so queueing them behind
    // a saturated gate would deadlock a client that is trying to cancel.
    if (CONCURRENCY_EXEMPT_TOOLS.has(rawToolName)) return run();
    const externalName = resolveBridgeToolName(rawToolName, name => this.deps.externalMcp?.hasBinding(name) === true);
    if (this.deps.externalMcp?.hasBinding(externalName) && !this.findCustomToolSafe(externalName)) {
      return this.externalToolGate.run(run, extra.signal);
    }

    // Sample queue depth at admission time, not completion: it is what tells the
    // controller whether demand actually exceeded the ceiling for this call.
    const queued = this.toolGate.waiting;
    const startedAt = Date.now();
    let failed = false;
    try {
      const result = await this.toolGate.run(run, extra.signal);
      failed = result.isError === true;
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      this.applyAdaptiveDecision({ durationMs: Date.now() - startedAt, failed, queued });
    }
  }

  /** Feed one completion to the controller and resize the gate if it decides to. */
  private applyAdaptiveDecision(sample: { durationMs: number; failed: boolean; queued: number }): void {
    const decision = this.adaptive.record(sample);
    if (!decision.changed) return;
    this.toolGate.setLimit(decision.limit);
    this.deps.log(
      `[bridge] tool concurrency ${decision.reason} -> ${decision.limit}` +
      ` (active=${this.toolGate.active}, waiting=${this.toolGate.waiting})`,
    );
  }

  /** In-flight and queued tool calls plus the current adaptive ceiling. */
  concurrencySnapshot(): { active: number; waiting: number; limit: number } {
    return { active: this.toolGate.active, waiting: this.toolGate.waiting, limit: this.toolGate.limit };
  }

  /** Never throws: a malformed manifest must not break built-in tool dispatch. */
  private findCustomToolSafe(toolName: string): CustomToolManifest | undefined {
    try {
      return findCustomTool(this.deps.workspaceRoots(), toolName, (message) => this.deps.log(message), { skillsEnabled: this.deps.skillsEnabled?.() ?? true });
    } catch {
      return undefined;
    }
  }

  private async handleToolCall(
    rawToolName: string,
    args: Record<string, unknown>,
    extra: { signal?: AbortSignal; commandOwnerId: string; taskOwnerId?: string },
  ): Promise<ToolCallResult> {
    const resolvedToolName = resolveBridgeToolName(rawToolName, (name) =>
      name === SET_TODOS_TOOL.name
      || name === UPDATE_PLAN_TOOL.name
      || name === REPORT_PROGRESS_TOOL.name
      || isFileToolName(name)
      || isFileToolCompatibilityAlias(name)
      || (!BRIDGE_EXCLUDED_TOOL_NAMES.has(name) && getIdeToolDefinition(name) !== undefined)
      || name === CONFIGURE_MCP_TOOL.name
      || this.findCustomToolSafe(name) !== undefined
      || this.deps.externalMcp?.hasBinding(name) === true);
    // Unknown ext__ names must never reach a built-in file tool via prefix/alias fallback.
    const toolName = rawToolName.startsWith('ext__')
      && !this.findCustomToolSafe(rawToolName)
      && !this.deps.externalMcp?.hasBinding(rawToolName)
      ? rawToolName : normalizeFileToolName(resolvedToolName);
    const publicDefinition = BRIDGE_TOOL_DEFINITIONS.find((tool) => tool.name === toolName);
    // set_todos / update_plan / report_progress are control-plane calls, not tracked tool calls:
    // validate them here and dispatch without touching the activity/stats counters
    // (report_progress records a "progress" entry; set_todos records nothing).
    if (
      toolName === SET_TODOS_TOOL.name
      || toolName === UPDATE_PLAN_TOOL.name
      || toolName === REPORT_PROGRESS_TOOL.name
    ) {
      if (publicDefinition) {
        try {
          validateToolInput(publicDefinition.name, publicDefinition.inputSchema, args);
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          };
        }
      }
      // Semantic rules beyond the JSON schema (single in_progress todo, unknown
      // todo_id, percent range) are enforced inside the handlers. Without this
      // guard their errors escape as an empty result instead of a tool error,
      // leaving the caller unable to tell rejection from success.
      try {
        const taskOwnerId = extra.taskOwnerId ?? extra.commandOwnerId;
        if (taskOwnerId !== extra.commandOwnerId) this.rememberTaskCommandOwner(taskOwnerId, extra.commandOwnerId);
        if (toolName === SET_TODOS_TOOL.name) {
          return this.handleSetTodos(args, taskOwnerId);
        }
        if (toolName === UPDATE_PLAN_TOOL.name) {
          return this.handleUpdatePlan(args, taskOwnerId);
        }
        return this.handleReportProgress(args, taskOwnerId);
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    }

    // Every real tool is tracked from the start so that input-validation failures
    // are counted as failed tool calls too, instead of returning before the
    // counters are ever touched. Validation runs inside the try so a schema
    // rejection flows through the same finishActivity("error") path as any other
    // failure.
    const externalBinding = this.deps.externalMcp?.hasBinding(toolName) === true && !this.findCustomToolSafe(toolName);
    const activityArgs = externalBinding ? {} : toolName === CONFIGURE_MCP_TOOL.name ? configureMcpActivityArgs(args) : args;
    const activityId = this.pushActivity({
      tool: toolName,
      status: "running",
      // Upstream input may include credentials or user data. Do not retain it in activity history.
      presentation: bridgePresentation(toolName, externalBinding ? {} : args),
    });
    const startedAt = Date.now();
    try {
      // File tools normalize, validate and execute inside the shared registry, so the Bridge
      // and the standalone server report the identical structured error instead of each
      // flattening it on the way out. The dispatcher still folds compatibility aliases, but
      // only best-effort and only so the local activity row shows the canonical shape; a
      // failure there is swallowed and re-reported by the registry, which owns the error.
      let presentationArgs = args;
      if (isFileToolName(toolName)) {
        try {
          presentationArgs = normalizeFileToolInput(toolName, args) as Record<string, unknown>;
        } catch {
          presentationArgs = args;
        }
      } else if (publicDefinition) {
        validateToolInput(publicDefinition.name, publicDefinition.inputSchema, args);
      }
      if (isFileToolName(toolName)) {
        const result = await invokeFileTool(toolName, args, {
          // Lazy on purpose: resolving it here would throw before the registry could envelope it.
          workspaceRoots: () => this.deps.fileToolRoots ? this.deps.fileToolRoots() : this.deps.workspaceRoots(),
          signal: extra.signal,
        });
        this.finishActivity(
          activityId,
          result.isError ? "error" : "completed",
          Date.now() - startedAt,
          result.isError ? result.text : undefined,
          bridgePresentation(
            toolName,
            presentationArgs,
            result.text,
            result.structuredContent as Record<string, unknown>,
            result.isError,
          ),
        );
        return {
          isError: result.isError || undefined,
          content: result.content ?? [{ type: "text" as const, text: result.text }],
          structuredContent: result.structuredContent as Record<string, unknown>,
        };
      }

      // list_skills is a read-only control-surface tool: it lists the installed skills
      // (name = same-named tool). It runs before the custom branch, and a user tool may
      // not even be registered under that name (RESERVED_TOOL_NAMES).
      if (toolName === LIST_SKILLS_TOOL.name) {
        const { result, text } = this.handleListSkills();
        this.finishActivity(
          activityId,
          result.isError ? "error" : "completed",
          Date.now() - startedAt,
          result.isError ? text : undefined,
          bridgePresentation(LIST_SKILLS_TOOL.name, args, text, result.structuredContent as Record<string, unknown>, result.isError),
        );
        return result;
      }
      if (toolName === CONFIGURE_MCP_TOOL.name) {
        if (!this.deps.configureMcp) throw new Error("MCP configuration is unavailable in this session.");
        if (this.deps.isWorkspaceTrusted?.() === false) throw new Error("受限模式下不能配置 MCP，请先信任工作区。");
        const action = typeof args.action === "string" ? args.action : "";
        const result = await runConfigureMcp(action, args, this.deps.configureMcp);
        this.finishActivity(
          activityId,
          result.isError ? "error" : "completed",
          Date.now() - startedAt,
          result.isError ? result.text : undefined,
          bridgePresentation(toolName, activityArgs, result.text, result.structuredContent, result.isError),
        );
        return {
          isError: result.isError || undefined,
          content: [{ type: "text" as const, text: result.text }],
          structuredContent: result.structuredContent,
        };
      }

      // User-added tools are matched before the built-in IDE branch but after the
      // file tools: the registry refuses to register a reserved name, so a custom
      // tool can never shadow a built-in one.
      const customTool = this.findCustomToolSafe(toolName);
      if (customTool) {
        if (this.deps.isWorkspaceTrusted?.() === false) throw new Error("受限模式下不能执行 Skill / 自定义工具，请先信任工作区。");
        validateToolInput(customTool.name, customTool.inputSchema, args);
        const result = await executeCustomTool(this.deps.workspaceRoots(), customTool, args, {
          signal: extra.signal,
          log: (message) => this.deps.log(message),
        });
        this.finishActivity(
          activityId,
          result.isError ? "error" : "completed",
          Date.now() - startedAt,
          result.isError ? result.text : undefined,
          bridgePresentation(toolName, args, result.text, result.structuredContent, result.isError),
        );
        return {
          isError: result.isError || undefined,
          content: [{ type: "text" as const, text: result.text }],
          structuredContent: result.structuredContent,
        };
      }

      if (externalBinding) {
        if (this.deps.isWorkspaceTrusted?.() === false) throw new Error('受限模式下不能调用外部 MCP。');
        const result = await this.deps.externalMcp!.call(toolName, args, extra.signal);
        if (!result) throw new Error(`Unknown external MCP tool: ${toolName}`);
        this.finishActivity(activityId, result.isError ? 'error' : 'completed', Date.now() - startedAt,
          result.isError ? '上游工具返回错误。' : undefined,
          bridgePresentation(toolName, {}, result.isError ? '上游工具返回错误。' : '调用已完成。', undefined, result.isError));
        return { content: result.content, isError: result.isError, structuredContent: result.structuredContent };
      }

      if (BRIDGE_EXCLUDED_TOOL_NAMES.has(toolName)) {
        throw new Error(`The ${toolName} tool is not available in Bridge mode.`);
      }

      const definition = getIdeToolDefinition(toolName);
      if (definition) {
        const result = await this.deps.invokeIdeTool(
          toolName,
          asRecord(args),
          extra.signal,
          extra.commandOwnerId,
        );
        const structuredContent = result.structuredContent ?? (result.isError
          ? { error: result.text }
          : ideToolStructuredContent(toolName, result.text));
        this.finishActivity(
          activityId,
          result.isError ? "error" : "completed",
          Date.now() - startedAt,
          result.isError ? result.text : undefined,
          bridgePresentation(toolName, args, result.text, structuredContent, result.isError),
        );
        return {
          isError: result.isError || undefined,
          content: [{ type: "text" as const, text: result.text }],
          structuredContent,
        };
      }

      throw new Error(toolName === rawToolName
        ? `Unknown Bridge tool: ${toolName}`
        : `Unknown Bridge tool: ${rawToolName} (after stripping MCP server prefix: ${toolName})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A failing upstream can put URLs, request headers or caller arguments in its exception.
      const safeMessage = externalBinding ? '外部 MCP 调用失败，请检查服务状态并重试。' : message;
      this.finishActivity(activityId, "error", Date.now() - startedAt, safeMessage,
        bridgePresentation(toolName, externalBinding ? {} : args, safeMessage, undefined, true));
      return {
        isError: true,
        content: [{ type: "text" as const, text: safeMessage }],
      };
    }
  }

  /** list_skills: read-only, no arguments, no side effects; returns the AI-facing listing. */
  private handleListSkills(): { result: ToolCallResult; text: string } {
    let listing: AgentSkillListing;
    try {
      if (!this.deps.listSkills) throw new Error("Skill discovery is unavailable; catalog provider is not initialized.");
      listing = this.deps.listSkills();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { text: message, result: { isError: true, content: [{ type: "text", text: message }] } };
    }
    const text = formatSkillListing(listing);
    return {
      text,
      result: {
        content: [{ type: "text", text }],
        structuredContent: { directory: listing.directory, enabled: listing.enabled, skills: listing.skills },
      },
    };
  }

  private handleReportProgress(value: unknown, commandOwnerId: string): ToolCallResult {
    const task = this.taskStore.forProgress(commandOwnerId, value);
    const linkableTodos = task?.todos ?? [];
    const { message, phase, percent, linkedTodo } = parseBridgeProgress(value, linkableTodos);
    if (task) this.taskStore.touch(task.id);
    if (task) this.taskStore.recordProgress(commandOwnerId, task.id, linkedTodo?.id, { message, phase, percent });
    this.pushActivity({
      taskId: task?.id,
      tool: REPORT_PROGRESS_TOOL.name,
      status: "progress",
      message,
      phase,
      percent,
      todoId: linkedTodo?.id,
      todoTitle: linkedTodo?.title,
    });
    this.deps.log(`[bridge-progress]${linkedTodo ? ` [${linkedTodo.id}]` : ""}${phase ? ` ${phase}:` : ""} ${message}${percent !== undefined ? ` (${percent}%)` : ""}`);
    return { structuredContent: { message, ...(phase !== undefined ? { phase } : {}), ...(percent !== undefined ? { percent } : {}), ...(linkedTodo ? { todo_id: linkedTodo.id } : {}) }, content: [{ type: "text", text: linkedTodo ? `已向 ShunCode 上报步骤 ${linkedTodo.id} 的进度。` : "已向 ShunCode 上报进度。" }] };
  }

  private handleSetTodos(value: unknown, taskOwnerId: string): ToolCallResult {
    return this.storeTodos(parseBridgeTodos(value, MAX_TODOS), taskOwnerId, SET_TODOS_TOOL.name, value);
  }

  private handleUpdatePlan(value: unknown, taskOwnerId: string): ToolCallResult {
    return this.storeTodos(parseBridgePlan(value, MAX_TODOS), taskOwnerId, UPDATE_PLAN_TOOL.name, value);
  }

  private storeTodos(
    nextTodos: BridgeTodo[], taskOwnerId: string,
    sourceTool: typeof SET_TODOS_TOOL.name | typeof UPDATE_PLAN_TOOL.name, value: unknown,
  ): ToolCallResult {
    if (sourceTool === UPDATE_PLAN_TOOL.name && asRecord(value).mode === "patch") throw new Error("update_plan uses positional IDs and only supports replace; use set_todos with stable IDs for patches.");
    const task = this.taskStore.update(taskOwnerId, nextTodos, value);
    this.revision_ += 1;
    // Absent fields never appear: a cleared job must not look like a job with unknown values.
    const taskContract = {
      task_protocol: "task-lifecycle-v1" as const,
      ...(task ? { task_id: task.id, task_revision: task.revision, lifecycle: task.state, history: task.history } : {}),
      ...(task?.overview ? { overview: task.overview } : {}),
    };
    const todos = task?.todos ?? [];
    const completed = todos.filter(todo => todo.status === "completed").length;
    const current = todos.find(todo => todo.status === "in_progress");
    this.deps.log(`[bridge-todos] ${completed}/${todos.length} completed via ${sourceTool} · state: ${task?.state ?? "cleared"}`);
    return {
      structuredContent: sourceTool === UPDATE_PLAN_TOOL.name
        ? { plan: todos.map(({ title, status }) => ({ step: title, status })), ...taskContract }
        : { todos: todos.map((todo) => ({ ...todo })), ...taskContract },
      content: [{ type: "text", text: task
        ? `已通过 ${sourceTool} 更新 ShunCode 任务卡：已完成 ${completed}/${todos.length} 步${current ? `；当前步骤 ${current.id}：${current.title}` : ""}。任务编号：${task.id}；修订号：${task.revision}。下次更新请带 task_id 与 expected_revision；新任务使用 new_task=true。最终回复前须提交并确认终态任务卡；空闲不等于完成。`
        : "已清空 ShunCode 任务卡。" }],
    };
  }

  private pushActivity(input: Omit<BridgeActivity, "id" | "at">): number {
    const id = this.activityTracker.push(input);
    this.revision_ += 1;
    return id;
  }

  private finishActivity(
    id: number,
    status: "completed" | "error",
    durationMs: number,
    message?: string,
    presentation?: BridgeActivityPresentation,
  ): void {
    if (this.activityTracker.finish(id, status, durationMs, message, presentation)) {
      this.revision_ += 1;
    }
  }
}
