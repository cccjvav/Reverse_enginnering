import type { CustomToolStatusEntry } from "../../../src/custom-tools.js";

import { FILE_TOOL_DEFINITIONS } from "../../../src/file-tool-registry.js";

import { BRIDGE_EXCLUDED_TOOL_NAMES, IDE_TOOL_DEFINITIONS } from "../../../src/ide-tool-definitions.js";

export const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
export const MAX_ACTIVITY = 60;
export const MAX_TODOS = 24;
/** Idle sessions are retained long enough for ChatGPT to pause and resume without being forced to reinitialize. */
export const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
export const SESSION_PRUNE_INTERVAL_MS = 60_000;
export const MAX_SESSIONS = 64;
/** Explicitly pin transport behavior instead of depending on SDK defaults. */
export const SESSION_KEEPALIVE_INTERVAL_MS = 15_000;
export const SESSION_RETRY_INTERVAL_MS = 2_000;
export const SESSION_EVENT_STORE_LIMIT = 512;

export type BridgeTunnelProvider = "cloudflare" | "cloudflare-named" | "ngrok";

export const BRIDGE_SERVER_INSTRUCTIONS = `You are connected to the local Windows host running the currently open ShunCode workspace.

ShunCode executes tools and displays your task state, progress, and tool activity to the local user.

Use:
- list_directory/find_files to discover files
- search_files for raw text search
- lsp for semantic code navigation
- read_files before editing
- apply_patch for workspace changes
- get_diagnostics after edits
- run_command for builds and tests
- set_todos to maintain the complete task list for multi-step work
- update_plan for Codex-style { plan: [{ step, status }] } clients (Bridge-owned compatibility form of set_todos)
- report_progress to report transient progress for the current task

Parallelism: independent tool calls may be issued concurrently and the Bridge runs them in parallel; measured throughput rises roughly linearly with the number of in-flight calls, so batching independent reads, searches and probes into one parallel round is markedly faster than issuing them one after another. Serialize only where a real dependency exists: an edit that must observe a prior read, or a command whose input depends on an earlier result. Do not parallelize writes to the same file. The host caps how many tool calls execute at once and queues the remainder, so a large parallel burst stays correct and merely finishes in successive waves rather than failing — there is no need to self-throttle or to stagger calls defensively. cancel_command, get_command_output and send_command_input are never queued, so a long-running command can always be inspected or stopped even while the cap is saturated.

Task coordination:
- Use set_todos for multi-step work, significant replanning, or validation workflows.
- Send the complete ordered todo list whenever task state changes.
- Keep at most one todo in_progress.
- Use stable todo IDs across updates.
- Keep todos at the goal level; do not create one todo per tool call.
- Use report_progress for what you are doing right now, not for durable task state.
- When there is exactly one in_progress todo, report_progress is automatically associated with it.
- Pass todo_id only when an explicit association is needed.
- Send an empty todo list when the task state should be cleared.

Tool guidance:
- Prefer semantic navigation over broad text search when locating code symbols.
- Do not assume an empty LSP result means a symbol does not exist.
- Use search_files for exact text and lsp for symbols, definitions, references, and type information.
- Reread affected files after stale patch or context-mismatch failures before retrying.
- Prefer small, focused patches with enough unique context.
- Run diagnostics and relevant tests after meaningful edits.
- Report meaningful progress periodically during long work, but avoid progress updates for every tool call.

Deliverable sync: every analysis, audit, plan, or review produced during a session is written into this repository under docs/ before the session ends, following the existing docs/mcp-<topic>.md naming, with LF endings and no trailing whitespace, and intra-document references rewritten to repo paths. Probe scripts, machine-readable baselines, and logs stay outside docs/ unless the user asks for them.`;

export const DEFAULT_BRIDGE_TOOL_CONCURRENCY = 8;
export const MAX_BRIDGE_TOOL_CONCURRENCY = 32;
export const BRIDGE_TOOL_CONCURRENCY_SETTING = "bridge.toolConcurrency";

/**
 * Master switch for Agent Skills. Individual skills also have their own
 * enabled flag; this turns the whole source off without touching them, which
 * is what a user wants when a skill misbehaves and they need the Bridge back.
 */
export const BRIDGE_SKILLS_ENABLED_SETTING = "bridge.skillsEnabled";

/**
 * Clamp a user-supplied concurrency into a usable range.
 *
 * The value comes from settings.json, so it can be absent, a string, a float or
 * negative. `Semaphore` throws on anything that is not a positive integer, and
 * that would happen during Bridge construction — before there is any UI to
 * report it — so normalise here instead of trusting the input.
 */
export function resolveBridgeToolConcurrency(configured: unknown): number {
  const value = Number(configured);
  if (!Number.isFinite(value)) return DEFAULT_BRIDGE_TOOL_CONCURRENCY;
  return Math.min(MAX_BRIDGE_TOOL_CONCURRENCY, Math.max(1, Math.trunc(value)));
}


export const SET_TODOS_TOOL = {
  name: "set_todos",
  title: "Set Todos",
  description: "Set the complete durable task list for the current remote-agent job in ShunCode. Use this for multi-step work so the local user can see what is done, in progress, and still pending. Send the full list whenever the plan changes; keep at most one item in_progress. Immediately before a final answer, send the terminal snapshot and wait for acknowledgement; if the work is complete every item must be completed. Use report_progress for transient details instead of creating tool-call-sized todos. Send an empty list to clear task state.",
  inputSchema: {
    type: "object",
    required: ["todos"],
    properties: {
      todos: {
        type: "array",
        maxItems: MAX_TODOS,
        description: "Complete ordered todo snapshot for the current job.",
        items: {
          type: "object",
          required: ["id", "title", "status"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 80, description: "Stable id reused across later set_todos updates." },
            title: { type: "string", minLength: 1, maxLength: 400, description: "Goal-level task title, not an individual tool call." },
            status: { type: "string", enum: ["pending", "in_progress", "completed"], description: "Current todo state. Keep at most one todo in_progress." },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["id", "title", "status"],
        },
      },
    },
    additionalProperties: true,
  },
  annotations: {
    title: "Set Todos",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

export const UPDATE_PLAN_TOOL = {
  name: "update_plan",
  title: "Update Plan",
  description: "Compatibility plan updater for the current remote-agent job in ShunCode. It accepts the Codex-style plan array and publishes it to the same durable task card as set_todos. This must be the Bridge MCP tool call: updating only a client-local plan does not update ShunCode. Send the full plan whenever state changes, and immediately before a final answer send the terminal snapshot and wait for acknowledgement. When work is complete every item must be completed; when blocked or incomplete keep truthful non-terminal statuses.",
  inputSchema: {
    type: "object",
    required: ["plan"],
    properties: {
      explanation: {
        type: "string",
        maxLength: 2000,
        description: "Optional concise reason for the plan update; task-card state is derived from plan.",
      },
      plan: {
        type: "array",
        maxItems: MAX_TODOS,
        description: "Complete ordered plan snapshot for the current job.",
        items: {
          type: "object",
          required: ["step", "status"],
          properties: {
            step: { type: "string", minLength: 1, maxLength: 400, description: "Goal-level step title displayed in the ShunCode task card." },
            status: { type: "string", enum: ["pending", "in_progress", "completed"], description: "Current step status. Keep at most one item in_progress." },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      plan: {
        type: "array",
        items: {
          type: "object",
          properties: {
            step: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["step", "status"],
        },
      },
    },
    additionalProperties: true,
  },
  annotations: {
    title: "Update Plan",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

export const REPORT_PROGRESS_TOOL = {
  name: "report_progress",
  title: "Report Progress",
  description: "Report concise transient progress from the remote MCP agent to the ShunCode Bridge UI. For multi-step work, maintain durable task state with set_todos and use report_progress for what you are doing right now. todo_id is optional: when omitted, ShunCode automatically associates progress with the sole in_progress todo. This tool does not modify workspace files.",
  inputSchema: {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string", minLength: 1, maxLength: 2000, description: "Human-readable progress update." },
      phase: { type: "string", maxLength: 160, description: "Optional short phase label, such as Reading, Editing, Testing, or Done." },
      percent: { type: "integer", minimum: 0, maximum: 100, description: "Optional completion estimate from 0 to 100 for the current activity/todo." },
      todo_id: { type: "string", minLength: 1, maxLength: 80, description: "Optional todo id from set_todos. Omit when there is exactly one in_progress todo; ShunCode will link it automatically." },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
      phase: { type: "string" },
      percent: { type: "integer" },
    },
    additionalProperties: true,
  },
  annotations: {
    title: "Report Progress",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

// Protocol upgrade: preserve full tool metadata, do not strip to 3 fields
export const BRIDGE_TOOL_DEFINITIONS = [
  ...FILE_TOOL_DEFINITIONS,
  ...IDE_TOOL_DEFINITIONS.filter((tool) => !BRIDGE_EXCLUDED_TOOL_NAMES.has(tool.name)),
  SET_TODOS_TOOL,
  UPDATE_PLAN_TOOL,
  REPORT_PROGRESS_TOOL,
] as const;



export interface BridgeActivity {
  readonly id: number;
  readonly at: string;
  readonly tool: string;
  readonly status: "running" | "completed" | "error" | "progress";
  readonly durationMs?: number;
  readonly message?: string;
  readonly phase?: string;
  readonly percent?: number;
  readonly todoId?: string;
  readonly todoTitle?: string;
  readonly presentation?: BridgeActivityPresentation;
}

export interface BridgeTodo {
  readonly id: string;
  readonly title: string;
  readonly status: "pending" | "in_progress" | "completed";
}

export interface BridgeActivityPresentation {
  readonly kind: "files" | "search" | "edit" | "terminal" | "diagnostics" | "lsp" | "generic";
  readonly title: string;
  readonly subtitle?: string;
  readonly input?: string;
  readonly output?: string;
  readonly files?: string[];
  readonly items?: BridgeActivityItem[];
  readonly diff?: string;
  readonly diffPreview?: BridgeDiffFilePreview[];
  readonly terminalId?: string;
  readonly commandId?: string;
  readonly exitCode?: number | null;
}

export interface BridgeDiffFilePreview {
  readonly path: string;
  readonly oldPath?: string;
  readonly newPath?: string;
  readonly hunks: BridgeDiffHunkPreview[];
  readonly truncated?: boolean;
}

export interface BridgeDiffHunkPreview {
  readonly oldStart: number;
  readonly newStart: number;
  readonly lines: BridgeDiffLinePreview[];
  readonly truncated?: boolean;
}

export interface BridgeDiffLinePreview {
  readonly kind: "context" | "add" | "delete";
  readonly oldLine?: number;
  readonly newLine?: number;
  readonly text: string;
}

export interface BridgeActivityItem {
  readonly kind: "file" | "folder" | "match" | "diagnostic" | "symbol";
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
  readonly label?: string;
  readonly description?: string;
  readonly severity?: "error" | "warning" | "information" | "hint";
  readonly additions?: number;
  readonly deletions?: number;
}

export interface BridgeStatus {
  readonly state: "stopped" | "starting" | "running" | "error";
  readonly transport: "streamable-http";
  readonly tunnelProvider: BridgeTunnelProvider;
  readonly domain: string;
  readonly configuredDomain: string;
  readonly configuredNamedDomain: string;
  readonly namedTunnelTokenConfigured: boolean;
  readonly namedTunnelLocalPort: number;
  readonly namedTunnelOriginUrl: string;
  readonly localUrl?: string;
  readonly publicUrl?: string;
  readonly localPort?: number;
  readonly tunnelInstalled?: boolean;
  readonly tunnelVersion?: string;
  readonly tunnelConfigValid?: boolean;
  readonly lastError?: string;
  readonly toolNames: string[];
  readonly toolCount: number;
  readonly customTools: CustomToolStatusEntry[];
  readonly activeRequests: number;
  readonly connected: boolean;
  readonly revision: number;
  readonly stats: {
    readonly toolCalls: number;
    readonly completedToolCalls: number;
    readonly failedToolCalls: number;
    readonly averageDurationMs: number;
    readonly successRate: number;
    readonly lastTool?: string;
    readonly lastToolAt?: string;
  };
  readonly todos: BridgeTodo[];
  readonly activities: BridgeActivity[];
  readonly health?: BridgeHealthReport;
}

export interface BridgeHealthProbe {
  readonly ok: boolean;
  readonly url?: string;
  readonly latencyMs?: number;
  readonly error?: string;
}

export interface BridgeHealthReport {
  readonly at: string;
  readonly ok: boolean;
  readonly state: BridgeStatus["state"];
  readonly durationMs: number;
  readonly local: BridgeHealthProbe;
  readonly public?: BridgeHealthProbe;
  readonly tunnelProcessAlive: boolean;
  readonly sessions: number;
  readonly activeRequests: number;
  readonly lastSessionActivityAt?: string;
  readonly summary: string;
}

