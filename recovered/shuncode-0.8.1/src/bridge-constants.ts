import { BRIDGE_BASH_TERMINAL_CONTRACT, BRIDGE_COMMAND_OWNER_RULE, CODE_STRUCTURE_GUIDANCE } from "../../../src/bridge-agent-instructions.js";
import { BRIDGE_CONVERSATION_OVERVIEW_PROMPT } from "./bridge-conversation-overview-prompt.js";
import type { BridgeTaskSnapshot } from "../../../src/bridge-task-store.js";
import type { CustomToolStatusEntry } from "../../../src/custom-tools.js";
import type { BridgeStartFailure } from "./bridge-start-failure.js";

import { FILE_TOOL_DEFINITIONS } from "../../../src/file-tool-registry.js";

import { BRIDGE_EXCLUDED_TOOL_NAMES, IDE_TOOL_DEFINITIONS } from "../../../src/ide-tool-definitions.js";
import { LIST_SKILLS_TOOL } from "./skill-list-tool.js";

export const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
export const MAX_ACTIVITY = 60;
export const MAX_TODOS = 24;
/** Idle sessions are retained long enough for ChatGPT to pause and resume without being forced to reinitialize. */
// Paused MCP clients may not reinitialize on 404. Retain sessions until explicit
// close/shutdown or bounded MAX_SESSIONS capacity eviction, not wall-clock idle.
export const SESSION_IDLE_TIMEOUT_MS = Number.POSITIVE_INFINITY;
export const SESSION_PRUNE_INTERVAL_MS = 60_000;
export const MAX_SESSIONS = 64;
/** Explicitly pin transport behavior instead of depending on SDK defaults. */
export const SESSION_KEEPALIVE_INTERVAL_MS = 15_000;
export const SESSION_RETRY_INTERVAL_MS = 2_000;
export const SESSION_EVENT_STORE_LIMIT = 512;

export type BridgeTunnelProvider = "cloudflare" | "cloudflare-named" | "ngrok";

/** Platform identity and how run_command reaches the shell. */
const BRIDGE_HOST_PLATFORM_RULES: readonly string[] = [
  `Operating system: Windows (\${arch}).`,
  `ShunCode run_command uses a persistent product-bundled PortableGit bash.exe with /c/... drive paths.`,
];

/** Quoting, globbing and literal-word handling. */
const BRIDGE_HOST_QUOTING_RULES: readonly string[] = [
  BRIDGE_BASH_TERMINAL_CONTRACT,
  `Quote path/var expansions ("$path") and use -- before arbitrary paths. Windows paths have spaces/Unicode; inside Bash use /c/... form, not C:\\ backslashes.`,
  `Use Bash variables ($name), not PowerShell $env:NAME or CMD %NAME%.`,
  `File tools (read_files, list_directory, find_files, search_files, apply_patch) and cwd take workspace-relative paths or absolute Windows paths inside the open folder (D:/dir/file); do not pass Bash /d/... form to them.`,
  `Unmatched globs stay literal. Use find_files (rg may be absent; grep is available); guard globs with compgen -G or existence checks. Quote literal * ? [ ].`,
];

/** bash dialect and failure propagation. */
const BRIDGE_HOST_SCRIPTING_RULES: readonly string[] = [
  `Bundled Git Bash is GNU bash (MSYS2): arrays 0-based; check BASH_VERSION before assuming newer optional features.`,
  `Copy "\${PIPESTATUS[@]}" right after pipeline for per-stage status; result also has pipeline_exit_codes. Use set -o pipefail for fail-fast pipelines.`,
  `Join dependent steps with && for fail-fast; ; can hide earlier failure behind later success.`,
];

/** Managed terminal lifetime, environment and native tooling. */
const BRIDGE_HOST_TERMINAL_RULES: readonly string[] = [
  `Explicit cwd selects/creates different terminal slot; don't rely on env/cwd persisting across different cwd values.`,
  `Idle terminal closes after 2h; next command fresh bash, loses prior vars/functions/cwd.`,
  `Prefer Windows tooling reachable from Git Bash over POSIX-only assumptions.`,
  `Managed shell: bundled PortableGit bash.exe --noprofile --norc, no rc files read, inherits Extension Host PATH.`,
  `Files may use CRLF: prefer apply_patch (preserves existing BOM/line endings) over sed -i for source edits.`,
  `Stay with Windows/bash unless user explicitly asks for another OS.`,
];

/**
 * Host rules handed to the model.
 *
 * These were one flat 14-item list inside a single template literal, which made
 * it hard to tell whether a rule already existed or which topic a new one
 * belonged to. The groups keep their order; the common Bash and command-owner contracts are
 * imported from one shared module so all three host prompts evolve together.
 */
export function bridgeHostInstructions(arch: string): string {
  const rules = [
    ...BRIDGE_HOST_PLATFORM_RULES,
    ...BRIDGE_HOST_QUOTING_RULES,
    ...BRIDGE_HOST_SCRIPTING_RULES,
    ...BRIDGE_HOST_TERMINAL_RULES,
  ];
  return [
    `Host environment:`,
    `- Operating system: Windows (${arch}).`,
    ...rules.slice(1).map((rule) => `- ${rule}`),
  ].join("\n");
}

export const BRIDGE_HOST_INSTRUCTIONS = bridgeHostInstructions(process.arch);

/**
 * This playbook is sent through the MCP initialize response. Keep every exposed
 * Bridge tool named here: clients may show the JSON schemas but omit or truncate
 * individual tool descriptions when constructing their model prompt.
 */
export const BRIDGE_MCP_TOOL_INSTRUCTIONS = `MCP tools and workflow:
- Files: list_directory folders; find_files paths; search_files text; read_files text; read_image images; lsp symbols. Empty results are inconclusive. Batch reads; try fuzzy path search before declaring missing.
- Editing: apply_patch first; Add File/Move create missing parent directories inside allowed roots. Read first, pass expected_versions, use unique hunks and modular edits. Validated edits execute directly: no additional interactive approval is required. Re-read stale/ambiguous context. After an uncertain response, inspect the files instead of blindly retrying.
- Directories: apply_patch creates file parents. For an empty directory use run_command with mkdir -p -- <directory> and cwd. Check the error code/path before claiming a capability is unavailable. Never bypass denied scope.
- Commands: run_command uses local Windows bash. Set cwd; background=true only for servers/watchers, not edits. Confirm destructive actions with the user; follow quoting rules.
- ${BRIDGE_COMMAND_OWNER_RULE}
- get_command_output reads from next_offset; send_command_input sends interactive input. cancel_command soft-interrupts, never auto-forces; never send Ctrl+C text or use a PID. force=true needs host-owned local confirmation; the MCP client cannot self-approve. Only the local user may Force Stop Anyway.
- Task state: at the START of EVERY conversation call Bridge set_todos before other tools, including readiness. New job: new_task=true (even with same client/name); resume the same unfinished job with acknowledged task_id + expected_revision. Completed/cancelled/cleared cards are sealed; blocked/interrupted cards may update existing step IDs only. Same overview_session_id inherits model/provider title, not task IDs. Stable steps (at most one in_progress). Before the final answer, send the terminal snapshot and wait for acknowledgement; completed only if all work is done, otherwise blocked/cancelled. Bridge update_plan is an alias; client-local or built-in update_plan does not reach the ShunCode task card. report_progress is transient, not durable task state; avoid progress updates for every tool call. If set_todos fails try Bridge update_plan once, then continue without repeated task-card retries and say the ShunCode task card was not synchronized. Never claim unacknowledged updates.
- Task retention: max 32 jobs; keep eight newest finished for 24h unless capacity prunes. Never prune active/blocked/interrupted tasks. Cleared/pruned task_id cannot resume. source_label is unverified, not authorization.
- Task-card language: all user-visible todo titles, steps, progress, phase labels and final explanations MUST use Simplified Chinese; keep technical names and protocol field names/status/lifecycle enums in English.
- Skills: call list_skills before answering which Skills are installed. They are instruction folders, NOT MCP tools; read skillFile before use. A failed listing means discovery is unavailable, not that no Skills are installed. Never install a Skill just to list it.
- MCP config: configure_mcp manages OTHER servers. add accepts mcpServers JSON, https:// URL or a command/key; stores keys in OS credentials. list/remove/test inspect/delete/re-test. Never echo secrets.
- Validation: get_diagnostics is a snapshot, not full coverage. Run relevant tests/type checks; distinguish testing from deployment.
Parallelism: independent calls may be issued concurrently; host queues over-limit work. Serialize same-file edits; command control remains available.
Code shape: ${CODE_STRUCTURE_GUIDANCE} Use targeted reads and semantic lookups. Make modular edits; extract a nearby helper when it genuinely improves structure. Do not refuse a legitimate edit merely because the file is large.`;

// 默认本地修改，不使用网页端的 Workspace。
export const BRIDGE_LOCAL_ONLY_NOTE = `Tools run on the local Windows host of this Bridge session. The folders currently open in ShunCode are the default target, not a hard ban. For task-relevant paths on the same Windows host, use run_command for read-only discovery first; file tools stay in allowed workspace/Skill roots. Do not assume a web/cloud workspace or another machine unless the user explicitly asks.`;

export const BRIDGE_SERVER_INSTRUCTIONS = `You are connected to ShunCode. Tool activity and task state are visible to the local user.

${BRIDGE_LOCAL_ONLY_NOTE}

${BRIDGE_HOST_INSTRUCTIONS}

${BRIDGE_MCP_TOOL_INSTRUCTIONS}

${BRIDGE_CONVERSATION_OVERVIEW_PROMPT}

Deliverables: do not assume the workspace is a repository or contains a docs/ folder. Follow requested locations and project conventions. Save reports/plans only when requested or required; otherwise return it in the conversation. If a required output location is unclear, ask before creating a new documentation folder. A readiness request changes no files: first set the task card, then await work.`;

export const DEFAULT_BRIDGE_TOOL_CONCURRENCY = 16;
export const MAX_BRIDGE_TOOL_CONCURRENCY = 64;
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
  title: "设置任务卡",
  description: "Set the full durable ShunCode task list. At conversation start use new_task=true for a new job; resume only the same unfinished job with acknowledged task_id/expected_revision. Completed/cancelled/cleared cards are sealed; blocked/interrupted cards may update existing step IDs only. The same overview_session_id may carry a model/provider title, never merge task IDs. Keep stable steps and at most one in_progress; before the final answer send the terminal snapshot and wait for acknowledgement (completed only when all steps are done; otherwise blocked/cancelled). patch preserves omitted IDs; an empty list clears only this job. Bridge update_plan is an alias; report_progress is transient. If neither writer works, continue without repeated task-card retries and disclose the ShunCode task card was not synchronized. Write user-visible text in Simplified Chinese; keep protocol names/enums in English.",
  inputSchema: {
    type: "object",
    required: ["todos"],
    properties: {
      task_id: { type: "string", minLength: 1, maxLength: 80, description: "Opaque Bridge task handle returned by a previous acknowledgement; supports explicit reconnect/resume." },
      expected_revision: { type: "integer", minimum: 1, description: "Last acknowledged task_revision. Required with task_id or patch to reject stale writes." },
      new_task: { type: "boolean", description: "Start a distinct job/turn without clearing another task. Do not combine with task_id or expected_revision." },
      source_label: { type: "string", maxLength: 80, description: "Optional client self-reported display label. Unverified; never used for authorization or task ownership." },
      lifecycle: { type: "string", enum: ["running", "completed", "blocked", "cancelled"], description: "Explicit task state. Before final reply send completed only if every step is complete; otherwise send blocked/cancelled truthfully." },
      mode: { type: "string", enum: ["replace", "patch"], description: "replace (default) replaces the full plan. patch merges stable IDs, requires expected_revision, and preserves omitted steps." },
      overview_session_id: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", description: "Random UUID v4 generated per conversation and repeated on its task updates. Unverified grouping hint; never infer from client, MCP connection or task owner. Omit if unavailable." },
      overview_model: { type: "string", maxLength: 80, description: "Actual model answering this conversation, if known. Self-reported and unverified; preferred over overview_provider. Never derive from the user task or client name." },
      overview_provider: { type: "string", maxLength: 80, description: "AI service provider company, only when model name is unknown. Self-reported and unverified. The local user may manually rename the overview." },
      todos: {
        type: "array",
        maxItems: MAX_TODOS,
        description: "Complete ordered todo snapshot for the current job.",
        items: {
          type: "object",
          required: ["id", "title", "status"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 80, description: "Stable id reused across later set_todos updates." },
            title: { type: "string", minLength: 1, maxLength: 400, description: "步骤标题必须使用简体中文，可保留必要的技术标识；不要写成单次工具调用。" },
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
    required: ["todos"],
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
    title: "设置任务卡",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

export const UPDATE_PLAN_TOOL = {
  name: "update_plan",
  title: "更新任务计划",
  description: "Bridge update_plan adapts a Codex-style plan to the set_todos card; a client-local plan does not update ShunCode. New work: new_task=true; resume only the same unfinished job with task_id/expected_revision. Finished cards are sealed; blocked/interrupted cards cannot add step IDs. Send full plan on changes. Before the final answer, send the terminal snapshot and wait for acknowledgement; every item must be completed to finish, otherwise blocked/cancelled. If neither writer works, continue without repeated task-card retries and disclose the ShunCode task card was not synchronized. Write user-visible steps in Simplified Chinese; keep protocol enums in English.",
  inputSchema: {
    type: "object",
    required: ["plan"],
    properties: {
      task_id: { type: "string", minLength: 1, maxLength: 80, description: "Opaque Bridge task handle returned by a previous acknowledgement; supports explicit reconnect/resume." },
      expected_revision: { type: "integer", minimum: 1, description: "Last acknowledged task_revision. Required with task_id or patch to reject stale writes." },
      new_task: { type: "boolean", description: "Start a distinct job/turn without clearing another task. Do not combine with task_id or expected_revision." },
      source_label: { type: "string", maxLength: 80, description: "Optional client self-reported display label. Unverified; never used for authorization or task ownership." },
      overview_session_id: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", description: "Random UUID v4 generated per conversation and repeated on its task updates. Unverified grouping hint; never infer from client, MCP connection or task owner. Omit if unavailable." },
      overview_model: { type: "string", maxLength: 80, description: "Actual model answering this conversation if known; unverified self-report, preferred over provider, never the user task." },
      overview_provider: { type: "string", maxLength: 80, description: "Provider company only when the model is unknown; unverified self-report. Local edits take priority." },
      lifecycle: { type: "string", enum: ["running", "completed", "blocked", "cancelled"], description: "Explicit task state. Before final reply send completed only if every step is complete; otherwise send blocked/cancelled truthfully." },
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
            step: { type: "string", minLength: 1, maxLength: 400, description: "任务卡步骤标题必须使用简体中文，可保留必要的技术标识。" },
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
    required: ["plan"],
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
    title: "更新任务计划",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

export const REPORT_PROGRESS_TOOL = {
  name: "report_progress",
  title: "报告任务进度",
  description: "Report concise transient progress from the remote MCP agent to the ShunCode Bridge UI. For multi-step work, use set_todos (or its Bridge update_plan alias) for the durable task card; report_progress is a transient update only and changes neither todo status nor lifecycle. todo_id is optional: when omitted, ShunCode automatically associates progress with the sole in_progress todo. Write message and phase in Simplified Chinese; keep protocol field names and enum values unchanged. This tool does not modify workspace files.",
  inputSchema: {
    type: "object",
    required: ["message"],
    properties: {
      task_id: { type: "string", minLength: 1, maxLength: 80, description: "Optional task handle to scope progress to a specific job; never completes the task." },
      message: { type: "string", minLength: 1, maxLength: 2000, description: "面向用户的进度说明，必须使用简体中文。" },
      phase: { type: "string", maxLength: 160, description: "可选的简体中文阶段名称，例如「排查」「修改」「验证」「完成」。" },
      percent: { type: "integer", minimum: 0, maximum: 100, description: "Optional completion estimate from 0 to 100 for the current activity/todo." },
      todo_id: { type: "string", minLength: 1, maxLength: 80, description: "Optional todo id from set_todos. Omit when there is exactly one in_progress todo; ShunCode will link it automatically." },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string" },
      phase: { type: "string" },
      percent: { type: "integer" },
    },
    additionalProperties: true,
  },
  annotations: {
    title: "报告任务进度",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

export const CONFIGURE_MCP_TOOL = {
  name: "configure_mcp",
  title: "Configure MCP",
  description: "Configure other MCP servers for this ShunCode user without leaving the conversation. When the user only names a server or describes a need without giving a URL or launch command, do not rely on memorized endpoints: first look up the current connection details online, preferring the official MCP registry at https://registry.modelcontextprotocol.io/v0.1/servers (search by name, take the isLatest entry, prefer its remotes url, otherwise its packages npx or uvx command), then call action=add with that config. If a required API key is missing, ask the user for it and say where to get it, and never invent keys or endpoints. action=add takes a standard mcpServers JSON object, a single https:// URL, or a one-line stdio launch command; put any API key inline (an Authorization or x-api-key header for HTTP/SSE, the url query, or a stdio env var) and it is stored in the OS credential store and enabled in one step, with no extra prompt or confirmation. action=list shows configured servers with transport, enabled state and live tool counts and never returns secret values. action=remove deletes a server by id and clears its credentials. action=test reloads and reports each server connection state and tool count. action=where answers \"where is the config file\": the server list is stored as external-mcp.json inside the global Skill directory reported by list_skills (legacy ~/.shuncode/external-mcp.json is migrated automatically on first use), and every action echoes that absolute path, so never search the disk for it. HTTP(S) is required for non-loopback URLs and reserved headers/env are rejected, matching the MCP settings page. For stdio servers add first makes the host able to run them: it resolves the real executable behind wrappers such as cmd /c npx, installs a missing Node.js through winget/Homebrew/apt (uv and uvx ship with ShunCode), then writes the config and connects once, reporting each server state and tool count; if that first connection fails the config is kept and the reason is returned for the user to resolve. Prefer add when the user gives a URL/key or names a known MCP server package.",
  inputSchema: {
    type: "object",
    required: ["action"],
    properties: {
      install_runtime: { type: "boolean", description: "add only: install a missing stdio runtime (Node.js via winget/Homebrew/apt) before writing the config. Default true; set false to fail fast instead." },
      verify: { type: "boolean", description: "add only: after writing, connect once and report tool counts. Default true." },
      verify_timeout_ms: { type: "number", description: "add only: how long to wait for the first connection, default 180000, max 600000 (a first npx download can be slow)." },
      action: { type: "string", enum: ["add", "list", "remove", "test", "where"], description: "add configures and enables a server; list shows configured servers without secrets; remove deletes one by id; test reloads and reports connection health; where reports the absolute config file path and its credential store without touching anything." },
      config: { type: ["string", "object"], description: "For add. A standard mcpServers JSON object (or stringified JSON), a single https:// URL, or a one-line stdio launch command. Include the API key inline (Authorization/x-api-key header, url query, or stdio env). Supports one or more servers." },
      secrets: { type: "object", additionalProperties: true, description: "Optional, for add. Values that override same-named header/env credentials in config; usually unnecessary because keys are inline in config." },
      target: { type: "string", enum: ["both", "bridge"], default: "both", description: "For add. both publishes to the editor and Bridge; bridge publishes to the Bridge surface only. Defaults to both." },
      id: { type: "string", description: "For remove and test. The server id shown by list." },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    additionalProperties: true,
  },
  annotations: {
    title: "Configure MCP",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
} as const;

// Protocol upgrade: preserve full tool metadata, do not strip to 3 fields
export const BRIDGE_TOOL_DEFINITIONS = [
  ...FILE_TOOL_DEFINITIONS,
  ...IDE_TOOL_DEFINITIONS.filter((tool) => !BRIDGE_EXCLUDED_TOOL_NAMES.has(tool.name)),
  SET_TODOS_TOOL,
  UPDATE_PLAN_TOOL,
  REPORT_PROGRESS_TOOL,
  LIST_SKILLS_TOOL,
  CONFIGURE_MCP_TOOL,
] as const;

/** Bridge control-plane tools also callable from Code Chat through the same dispatcher. */
export const CHAT_BRIDGE_CONTROL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "set_todos", "update_plan", "report_progress", "list_skills", "configure_mcp",
]);



export interface BridgeActivity {
  readonly id: number;
  readonly at: string;
  readonly tool: string;
  readonly status: "running" | "completed" | "error" | "progress";
  readonly durationMs?: number;
  readonly message?: string;
  readonly phase?: string;
  readonly percent?: number;
  readonly taskId?: string;
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
  /** 结构化的启动失败 / 自动停止原因（R2 §8.3）；页面据此显示中文说明，lastError 仍是技术原文。 */
  readonly startFailure?: BridgeStartFailure;
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
  readonly taskId?: string;
  readonly tasks?: BridgeTaskSnapshot[];
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

