import { BridgeActivityTracker, type BridgeActivitySnapshot } from "../../../src/bridge-activity-tracker.js";
import { parseBridgePlan, parseBridgeProgress, parseBridgeTodos } from "../../../src/bridge-coordination-validation.js";
import { executeCustomTool, findCustomTool, type CustomToolManifest } from "../../../src/custom-tools.js";
import { resolveBridgeToolName } from "../../../src/bridge-tool-name.js";
import { BridgeUsageCounter } from "../../../src/bridge-usage-counter.js";
import {
  isFileToolCompatibilityAlias,
  normalizeFileToolInput,
  normalizeFileToolName,
} from "../../../src/file-tool-input-compat.js";
import { invokeFileTool, isFileToolName, type ToolContentBlock } from "../../../src/file-tool-registry.js";
import { BRIDGE_EXCLUDED_TOOL_NAMES, getIdeToolDefinition } from "../../../src/ide-tool-definitions.js";
import { NATIVE_MANAGED_COMMAND_OWNER_ID } from "../../../src/managed-command-cancellation.js";
import { validateToolInput } from "../../../src/tool-input-validation.js";
import { Semaphore } from "../../../src/concurrency.js";
import { AdaptiveConcurrencyController } from "../../../src/adaptive-concurrency.js";
import {
  BRIDGE_TOOL_DEFINITIONS,
  DEFAULT_BRIDGE_TOOL_CONCURRENCY,
  MAX_BRIDGE_TOOL_CONCURRENCY,
  MAX_ACTIVITY,
  MAX_TODOS,
  REPORT_PROGRESS_TOOL,
  SET_TODOS_TOOL,
  UPDATE_PLAN_TOOL,
} from "./bridge-constants.js";
import type { BridgeActivity, BridgeActivityPresentation, BridgeTodo } from "./bridge-constants.js";
import { asRecord, bridgePresentation } from "./bridge-utils.js";

/**
 * The shape a single tool invocation returns to the MCP layer. Never throws to
 * the session: unknown tools, validation failures, file-tool and IDE-tool
 * errors are all surfaced as `isError` tool results.
 */
export interface ToolCallResult {
  content: ToolContentBlock[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
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
  ): Promise<{ text: string; isError: boolean }>;
  /** Current workspace roots; throws when no folder is open (parity with the facade). */
  workspaceRoots(): string[];
  log(message: string): void;
}

/**
 * Sole owner of the tool-side Bridge state: usage counter, activity tracker,
 * todos, and the tool-side revision. The facade keeps its own revision for
 * session/tunnel lifecycle events and sums the two in getStatus(); every
 * activity/todo event therefore still increments the aggregate exactly once.
 */
export class BridgeToolDispatcher {
  private readonly usageCounter = new BridgeUsageCounter();
  private readonly activityTracker = new BridgeActivityTracker<BridgeActivityPresentation>(MAX_ACTIVITY);
  private todos: BridgeTodo[] = [];
  private todosOwnerId: string | undefined;
  private activeCommandOwnerId: string | undefined;
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

  /**
   * Tunes `toolGate` from observed load. Bandwidth is not a usable signal here
   * (see adaptive-concurrency.ts); queueing, latency and failures are.
   */
  private readonly adaptive: AdaptiveConcurrencyController;

  constructor(private readonly deps: ToolDispatcherDeps, concurrency = DEFAULT_BRIDGE_TOOL_CONCURRENCY) {
    this.toolGate = new Semaphore(concurrency);
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
    return this.todos.map((todo) => ({ ...todo }));
  }

  /** Activity + stats snapshot for BridgeStatus. */
  snapshotActivity(): BridgeActivitySnapshot<BridgeActivityPresentation> {
    return this.activityTracker.snapshot();
  }

  /** Clears finished tool calls (keeping running ones) and bumps the revision. */
  clearActivity(): number {
    const removed = this.activityTracker.clear();
    if (removed > 0) {
      this.revision_ += 1;
    }
    return removed;
  }

  // ---- Usage counter (facade delegates its two public methods here) --------

  takeToolCallsSinceLastReport(): number {
    return this.usageCounter.take();
  }

  returnToolCallsSinceLastReport(count: number): void {
    this.usageCounter.returnCount(count);
  }

  beginRemoteConversation(commandOwnerId: string): void {
    if (!commandOwnerId || this.activeCommandOwnerId === commandOwnerId) {
      return;
    }
    this.clearTodosForOwnerTransition(commandOwnerId);
    this.activeCommandOwnerId = commandOwnerId;
  }

  endRemoteConversation(commandOwnerId: string): void {
    if (!commandOwnerId || this.activeCommandOwnerId !== commandOwnerId) {
      return;
    }
    this.clearTodosForOwnerTransition(undefined);
    this.activeCommandOwnerId = undefined;
  }

  // ---- Dispatch ------------------------------------------------------------

  /**
   * Record the call for usage accounting, then route it. Mirrors the legacy
   * "recordToolCall() then handleToolCall()" ordering exactly.
   */
  async dispatch(
    rawToolName: string,
    args: Record<string, unknown>,
    extra: { signal?: AbortSignal; commandOwnerId?: string },
  ): Promise<ToolCallResult> {
    const commandOwnerId = extra.commandOwnerId ?? NATIVE_MANAGED_COMMAND_OWNER_ID;
    this.ensureConversationOwner(commandOwnerId);
    this.usageCounter.recordToolCall();
    const run = () => this.handleToolCall(rawToolName, args, { signal: extra.signal, commandOwnerId });
    // Control-plane tools bypass the gate on purpose: they are the only way to
    // observe or stop work that already holds a permit, so queueing them behind
    // a saturated gate would deadlock a client that is trying to cancel.
    if (CONCURRENCY_EXEMPT_TOOLS.has(rawToolName)) return run();

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
    extra: { signal?: AbortSignal; commandOwnerId: string },
  ): Promise<ToolCallResult> {
    this.ensureConversationOwner(extra.commandOwnerId);
    const resolvedToolName = resolveBridgeToolName(rawToolName, (name) =>
      name === SET_TODOS_TOOL.name
      || name === UPDATE_PLAN_TOOL.name
      || name === REPORT_PROGRESS_TOOL.name
      || isFileToolName(name)
      || isFileToolCompatibilityAlias(name)
      || (!BRIDGE_EXCLUDED_TOOL_NAMES.has(name) && getIdeToolDefinition(name) !== undefined)
      || this.findCustomToolSafe(name) !== undefined);
    const toolName = normalizeFileToolName(resolvedToolName);
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
        if (toolName === SET_TODOS_TOOL.name) {
          return this.handleSetTodos(args, extra.commandOwnerId);
        }
        if (toolName === UPDATE_PLAN_TOOL.name) {
          return this.handleUpdatePlan(args, extra.commandOwnerId);
        }
        return this.handleReportProgress(args, extra.commandOwnerId);
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
    const activityId = this.pushActivity({
      tool: toolName,
      status: "running",
      presentation: bridgePresentation(toolName, args),
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
          workspaceRoots: () => this.deps.workspaceRoots(),
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

      // User-added tools are matched before the built-in IDE branch but after the
      // file tools: the registry refuses to register a reserved name, so a custom
      // tool can never shadow a built-in one.
      const customTool = this.findCustomToolSafe(toolName);
      if (customTool) {
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
        this.finishActivity(
          activityId,
          result.isError ? "error" : "completed",
          Date.now() - startedAt,
          result.isError ? result.text : undefined,
          bridgePresentation(toolName, args, result.text, undefined, result.isError),
        );
        return {
          isError: result.isError || undefined,
          content: [{ type: "text" as const, text: result.text }],
        };
      }

      throw new Error(toolName === rawToolName
        ? `Unknown Bridge tool: ${toolName}`
        : `Unknown Bridge tool: ${rawToolName} (after stripping MCP server prefix: ${toolName})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.finishActivity(activityId, "error", Date.now() - startedAt, message, bridgePresentation(toolName, args, message, undefined, true));
      return {
        isError: true,
        content: [{ type: "text" as const, text: message }],
      };
    }
  }

  private handleReportProgress(value: unknown, commandOwnerId: string): ToolCallResult {
    const linkableTodos = this.todosOwnerId === commandOwnerId ? this.todos : [];
    const { message, phase, percent, linkedTodo } = parseBridgeProgress(value, linkableTodos);
    this.pushActivity({
      tool: REPORT_PROGRESS_TOOL.name,
      status: "progress",
      message,
      phase,
      percent,
      todoId: linkedTodo?.id,
      todoTitle: linkedTodo?.title,
    });
    this.deps.log(`[bridge-progress]${linkedTodo ? ` [${linkedTodo.id}]` : ""}${phase ? ` ${phase}:` : ""} ${message}${percent !== undefined ? ` (${percent}%)` : ""}`);
    return { content: [{ type: "text", text: linkedTodo ? `Progress reported to ShunCode for todo ${linkedTodo.id}.` : "Progress reported to ShunCode." }] };
  }

  private handleSetTodos(value: unknown, commandOwnerId: string): ToolCallResult {
    return this.storeTodos(parseBridgeTodos(value, MAX_TODOS), commandOwnerId, SET_TODOS_TOOL.name);
  }

  private handleUpdatePlan(value: unknown, commandOwnerId: string): ToolCallResult {
    return this.storeTodos(parseBridgePlan(value, MAX_TODOS), commandOwnerId, UPDATE_PLAN_TOOL.name);
  }

  private storeTodos(
    todos: BridgeTodo[],
    commandOwnerId: string,
    sourceTool: typeof SET_TODOS_TOOL.name | typeof UPDATE_PLAN_TOOL.name,
  ): ToolCallResult {
    this.todos = todos;
    this.todosOwnerId = todos.length ? commandOwnerId : undefined;
    this.revision_ += 1;
    const completed = todos.filter((todo) => todo.status === "completed").length;
    const current = todos.find((todo) => todo.status === "in_progress");
    this.deps.log(todos.length
      ? `[bridge-todos] ${completed}/${todos.length} completed via ${sourceTool}${current ? ` · current: [${current.id}] ${current.title}` : ""}`
      : `[bridge-todos] cleared via ${sourceTool}`);
    return {
      content: [{
        type: "text",
        text: todos.length
          ? `Todo state updated in ShunCode via ${sourceTool}: ${completed}/${todos.length} completed${current ? `; current todo ${current.id}: ${current.title}` : ""}.`
          : "Todo state cleared in ShunCode.",
      }],
    };
  }

  private pushActivity(input: Omit<BridgeActivity, "id" | "at">): number {
    const id = this.activityTracker.push(input);
    this.revision_ += 1;
    return id;
  }

  private ensureConversationOwner(commandOwnerId: string): void {
    if (!commandOwnerId || this.activeCommandOwnerId === commandOwnerId) {
      return;
    }
    this.clearTodosForOwnerTransition(commandOwnerId);
    this.activeCommandOwnerId = commandOwnerId;
  }

  private clearTodosForOwnerTransition(nextOwnerId: string | undefined): void {
    if (!this.todos.length || !this.todosOwnerId || this.todosOwnerId === nextOwnerId) {
      return;
    }
    const previousOwnerId = this.todosOwnerId;
    this.todos = [];
    this.todosOwnerId = undefined;
    this.revision_ += 1;
    this.deps.log(nextOwnerId
      ? `[bridge] task scope cleared: ${previousOwnerId} -> ${nextOwnerId}`
      : `[bridge] task scope cleared: ${previousOwnerId}`);
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
