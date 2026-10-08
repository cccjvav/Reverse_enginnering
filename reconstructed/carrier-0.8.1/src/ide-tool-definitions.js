// EXTRACTED from src/ide-tool-definitions.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var MANAGED_SHELL_DESCRIPTION = managedBashDescription(process.platform);
var GENERIC_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true
};
var LIST_DIRECTORY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string" },
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          path: { type: "string" },
          type: { type: "string", enum: ["file", "directory", "symlink", "other"] },
          size_bytes: { type: "integer" }
        },
        required: ["name", "path", "type"],
        additionalProperties: true
      }
    },
    truncated: { type: "boolean" }
  },
  required: ["path", "entries"],
  additionalProperties: true
};
var RUN_COMMAND_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    command_id: { type: "string" },
    terminal_id: { type: "string" },
    status: { type: "string", enum: ["running", "completed", "failed", "killed", "cancelled"] },
    exit_code: { type: ["integer", "null"] },
    pipeline_exit_codes: { type: ["array", "null"], items: { type: "integer" } },
    output: { type: "string" },
    cwd: { type: "string" }
  },
  required: ["command_id", "status"],
  additionalProperties: true
};
var IDE_TOOL_DEFINITIONS = [
  {
    name: "list_directory",
    title: "List Directory",
    vscodeToolName: "shuncode_list_directory",
    capability: "read",
    description: "List the immediate contents of a workspace directory on the current Windows host running ShunCode for this session. Use this to understand what is in a known directory inside the folder(s) currently open in ShunCode; use find_files when searching by filename/path pattern. For paths outside the current workspace on this same Windows host, use run_command with ls/find for read-only discovery instead of list_directory. Depth is intentionally limited to 1 or 2. Returned path values are normalized to workspace-relative paths even when an absolute in-workspace path is supplied.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace directory path. Workspace-relative is preferred; an absolute path is accepted only when it remains inside the folder(s) currently open in ShunCode on the Windows host for this session. Defaults to the workspace root." },
        depth: { type: "integer", enum: [1, 2], default: 1, description: "Directory depth to list. Keep this small; use find_files for recursive discovery." },
        include_hidden: { type: "boolean", default: false, description: "Include dot-prefixed entries." },
        no_ignore: { type: "boolean", default: false, description: "Include common generated/ignored directories such as node_modules, dist and .git." },
        max_entries: { type: "integer", minimum: 1, maximum: 500, default: 200, description: "Maximum returned entries." }
      },
      additionalProperties: false
    },
    outputSchema: LIST_DIRECTORY_OUTPUT_SCHEMA,
    annotations: {
      title: "List Directory",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: "run_command",
    title: "Run Command",
    vscodeToolName: "shuncode_run_command",
    capability: "execute",
    description: `Run a shell command, including a multiline script, on the same Windows host that runs the current ShunCode workspace in a ShunCode-managed persistent real PTY that is independent of the user's terminal profiles and VS Code Shell Integration. Default to that workspace and do not assume a web workspace or another machine is the target unless the user explicitly asks. When the conversation clearly points to a sibling folder, external-disk directory, or approximate local path on this same Windows host outside the current workspace, use run_command itself for quick read-only cd/ls/find/grep discovery there before declaring the target missing. ${MANAGED_SHELL_DESCRIPTION} Shell state such as environment variables, functions and the current directory persists while the same terminal remains available. Omit cwd to continue from the most recently used idle ShunCode terminal's current directory; the first command defaults to the workspace root. Interactive input, terminal resize and TTY-aware CLI behavior are supported. Concurrent/busy commands may use additional terminals. background defaults to false so ordinary commands are awaited; set background=true explicitly only for long-running servers/watchers. Use apply_patch for workspace file edits it can express; arbitrary shell scripts cannot be preflighted to exact affected paths, so they are not a substitute for its destructive-change review. Returns a cryptographically random, owner-scoped command_id capability plus exit_code for later output inspection, interactive input, or cancellation. When the shuncode.terminal.pipelineExitCodes setting is enabled (default), POSIX pipelines additionally report pipeline_exit_codes.`,
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string", minLength: 1, description: BASH_COMMAND_INPUT_DESCRIPTION },
        cwd: { type: "string", description: "Optional working directory on the same local Windows host running ShunCode. A relative path resolves under the first open workspace folder; an absolute existing directory may be used outside it when the user explicitly names that local folder (including another opened workspace folder). For a user-named folder, supply its absolute cwd rather than relying on the terminal previous directory. Workspace file tools remain limited to open folders. When omitted, reuse the most recently used idle terminal; a new terminal starts at the first workspace root." },
        background: { type: "boolean", default: false, description: "Whether this is expected to keep running. Defaults to false; set true only for a long-running server or watcher." },
        timeout_ms: { type: "integer", minimum: 1e3, maximum: 12e4, default: 12e4, description: "For foreground commands, maximum time to wait before returning status=running. The command is not killed on timeout." }
      },
      additionalProperties: false
    },
    outputSchema: RUN_COMMAND_OUTPUT_SCHEMA,
    annotations: {
      title: "Run Command",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: "get_command_output",
    title: "Get Command Output",
    vscodeToolName: "shuncode_get_command_output",
    capability: "execute",
    description: "Read new output, status and exit_code from a previously started run_command using its command_id in the same command-owner scope (native Chat context, 2025 MCP session, or stable credential/client/workspace identity for stateless 2026 requests). Pass only the opaque cmd_... token, never the terminal_id line or the surrounding transcript. Use next_offset on subsequent reads to avoid repeating old output. When the shuncode.terminal.pipelineExitCodes setting is enabled (default), POSIX pipelines additionally report pipeline_exit_codes.",
    inputSchema: {
      type: "object",
      required: ["command_id"],
      properties: {
        command_id: { type: "string", minLength: 1, description: "Exact opaque cmd_... token returned by run_command; do not include terminal_id or adjacent output lines." },
        offset: { type: "integer", minimum: 0, default: 0, description: "Absolute UTF-8 byte offset into captured output." },
        max_bytes: { type: "integer", minimum: 1, maximum: 131072, default: 32768, description: "Maximum number of captured UTF-8 bytes to return in this read." }
      },
      additionalProperties: false
    },
    outputSchema: GENERIC_OUTPUT_SCHEMA,
    annotations: {
      title: "Get Command Output",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: "cancel_command",
    title: "Cancel Command",
    vscodeToolName: "shuncode_cancel_command",
    capability: "execute",
    description: "Cancel a managed command using the exact cryptographically random command_id capability returned by run_command in the same command-owner scope (native Chat context, 2025 MCP session, or stable credential/client/workspace identity for stateless 2026 requests). This dedicated tool accepts no pid, process name, path, signal, or approval field. By default it only interrupts the foreground process and waits up to grace_ms; it never automatically force-closes a terminal. If the result reports force_required=true, a later force=true call may force-close only that command's managed PTY after host-owned local confirmation. High-risk packaging, signing, installation, migration, archive mutation/restore, and bulk-move operations receive a stronger consequence warning; the AI cannot approve it, while the local user retains final control. Calls on final states are read-only and idempotent; do not emulate cancellation by sending Ctrl+C through send_command_input.",
    inputSchema: {
      type: "object",
      required: ["command_id"],
      properties: {
        command_id: { type: "string", minLength: 1, description: "Exact opaque cmd_... token returned by run_command; do not include terminal_id or adjacent output lines." },
        grace_ms: { type: "integer", minimum: 100, maximum: 1e4, default: 1500, description: "Milliseconds to wait after the soft foreground interrupt before returning the current status; this never causes automatic force escalation." },
        force: { type: "boolean", default: false, description: "Request force-closing only this managed PTY if it remains running after grace_ms. The host must show and accept a local confirmation; this field is not approval. High-risk commands receive a stronger warning, and only the local user can choose to force stop anyway." }
      },
      additionalProperties: false
    },
    outputSchema: GENERIC_OUTPUT_SCHEMA,
    annotations: {
      title: "Cancel Command",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: "send_command_input",
    title: "Send Command Input",
    vscodeToolName: "shuncode_send_command_input",
    capability: "execute",
    description: "Send text to the terminal of a running command in the same command-owner scope (native Chat context, 2025 MCP session, or stable credential/client/workspace identity for stateless 2026 requests). Pass only the opaque cmd_... command_id token, never the terminal_id line or the surrounding transcript. Use for interactive prompts or REPL input. A newline is appended by default.",
    inputSchema: {
      type: "object",
      required: ["command_id", "input"],
      properties: {
        command_id: { type: "string", minLength: 1, description: "Exact opaque cmd_... token returned by run_command; do not include terminal_id or adjacent output lines." },
        input: { type: "string", description: "Exact text to send to the command's PTY stdin." },
        append_newline: { type: "boolean", default: true, description: "Append a newline after input. Set false for raw keystrokes or partial input." }
      },
      additionalProperties: false
    },
    outputSchema: GENERIC_OUTPUT_SCHEMA,
    annotations: {
      title: "Send Command Input",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  {
    name: "wait",
    title: "Wait",
    vscodeToolName: "shuncode_wait",
    capability: "execute",
    description: "Block for a fixed amount of time (ms), then return. Use to let a background command started with run_command (background=true) make progress before reading its output with get_command_output, or to give a server/watcher time to emit more output. Choose one wait long enough for the expected work (e.g. 10_000-30_000 ms for builds, up to 120_000 for slow compiles) instead of polling get_command_output in a tight loop. The wait only sleeps; it does not check command status.",
    inputSchema: {
      type: "object",
      required: ["ms"],
      properties: {
        ms: { type: "integer", minimum: 100, maximum: 12e4, default: 1e4, description: "Milliseconds to wait." }
      },
      additionalProperties: false
    },
    outputSchema: GENERIC_OUTPUT_SCHEMA,
    annotations: {
      title: "Wait",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: "get_diagnostics",
    title: "Get Diagnostics",
    vscodeToolName: "shuncode_get_diagnostics",
    capability: "read",
    description: "Read the current diagnostic snapshot from VS Code and active language services for the current local workspace, including unsaved editor state when providers report it. Use after edits/builds to inspect errors and warnings structurally instead of parsing compiler output when diagnostics are available. A zero-result snapshot is explicitly marked inconclusive because it does not prove every language service/project has been activated and fully analyzed.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional workspace file or directory scope. Workspace-relative is preferred; an absolute path is accepted only when it remains inside the folder(s) currently open in ShunCode on the Windows host for this session." },
        severity: {
          type: "array",
          items: { type: "string", enum: ["error", "warning", "information", "hint"] },
          uniqueItems: true,
          description: "Optional severity filter. Defaults to all severities."
        },
        max_results: { type: "integer", minimum: 1, maximum: 500, default: 100, description: "Maximum number of diagnostics to return. Defaults to 100." }
      },
      additionalProperties: false
    },
    outputSchema: GENERIC_OUTPUT_SCHEMA,
    annotations: {
      title: "Get Diagnostics",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: "lsp",
    title: "LSP Navigation",
    vscodeToolName: "shuncode_lsp",
    capability: "read",
    description: "Navigate code semantically through the language services already active in VS Code for the current local workspace. Use this for code symbols rather than text search: workspace/document symbols, go-to-definition, references, implementations, and hover/type information. Results include provider_state, project_anchor, project_anchor_source, warmup_performed, and semantic_result_inconclusive metadata so empty semantic results and heuristic warm-up anchors are not over-interpreted. Use search_files for raw text and read_files after lsp locates the relevant implementation.",
    inputSchema: {
      type: "object",
      required: ["operation"],
      properties: {
        operation: {
          type: "string",
          enum: ["workspace_symbols", "document_symbols", "definition", "references", "implementation", "hover"],
          description: "Semantic operation to execute through VS Code language feature providers."
        },
        path: { type: "string", description: "Workspace source path. Workspace-relative is preferred; absolute paths are accepted only when they remain inside the folder(s) currently open in ShunCode on the Windows host for this session. Required for document_symbols/definition/references/implementation/hover. Optional for workspace_symbols as a project/file/directory anchor to activate the relevant language project before semantic search." },
        line: { type: "integer", minimum: 1, description: "1-based source line. Required for definition/references/implementation/hover." },
        column: { type: "integer", minimum: 1, description: "1-based UTF-16 source column. Required for definition/references/implementation/hover." },
        query: { type: "string", description: "Symbol query. Required for workspace_symbols." },
        include_declaration: { type: "boolean", default: true, description: "For references, include the symbol declaration/definition when present." },
        max_results: { type: "integer", minimum: 1, maximum: 500, description: "Maximum returned semantic results. Operation-specific defaults are used when omitted." }
      },
      additionalProperties: false
    },
    outputSchema: GENERIC_OUTPUT_SCHEMA,
    annotations: {
      title: "LSP Navigation",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }
];
var IDE_TOOL_NAMES = IDE_TOOL_DEFINITIONS.map((tool) => tool.name);
var BRIDGE_EXCLUDED_TOOL_NAMES = /* @__PURE__ */ new Set(["wait"]);
function getIdeToolDefinition(name) {
  return IDE_TOOL_DEFINITIONS.find((tool) => tool.name === name);
}
