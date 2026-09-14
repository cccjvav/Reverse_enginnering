// RECONSTRUCTED from src/ide-tool-definitions.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


var MANAGED_SHELL_DESCRIPTION = "Windows PTY spawns the product-bundled PortableGit bash.exe with --noprofile --norc. There is no PowerShell fallback: a missing bundled Bash is a packaging/install error. Pass native Bash source directly and use Bash quoting, pipelines and here-docs. The bundled Unix toolchain includes git, grep, sed, awk, find and curl. Inside Bash prefer /c/... paths for Windows drives; call powershell.exe explicitly only for Windows-only facilities such as registry, services, event log or .ps1 scripts. Idle terminal closes after 2h; a fresh shell loses prior variables and cwd.";

var GENERIC_OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

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
    vscodeToolName: "shuncode_list_directory",
    capability: "read",
    description: "List the immediate contents of a workspace directory. Use this to understand what is in a known directory; use find_files when searching by filename/path pattern. Depth is intentionally limited to 1 or 2.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative directory path. Defaults to the workspace root." },
        depth: { type: "integer", enum: [1, 2], default: 1, description: "Directory depth to list. Keep this small; use find_files for recursive discovery." },
        include_hidden: { type: "boolean", default: false, description: "Include dot-prefixed entries." },
        no_ignore: { type: "boolean", default: false, description: "Include common generated/ignored directories such as node_modules, dist and .git." },
        max_entries: { type: "integer", minimum: 1, maximum: 500, default: 200, description: "Maximum returned entries." }
      },
      additionalProperties: false
    }
  },
  {
    name: "run_command",
    title: "Run Command",
    vscodeToolName: "shuncode_run_command",
    capability: "execute",
    description: `Run a shell command, including a multiline script, on the same Windows host that runs the current ShunCode workspace in a ShunCode-managed persistent real PTY backed by node-pty/ConPTY. ${MANAGED_SHELL_DESCRIPTION} Shell state persists while the same owner-scoped terminal remains available. Omit cwd to continue from the most recently used idle terminal; a fresh terminal starts at the workspace root. Interactive input and background processes are supported. background defaults to false. Returns a cryptographically random owner-scoped command_id capability for later output, input, or cancellation. When shuncode.terminal.pipelineExitCodes is enabled (default), Bash pipelines additionally report pipeline_exit_codes.`,
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string", minLength: 1, description: "Native Bash command or multiline Bash script." },
        cwd: { type: "string", description: "Optional workspace-relative working directory. When omitted, reuse the most recently used idle ShunCode terminal and continue from its current directory; a new terminal starts at the workspace root." },
        background: { type: "boolean", default: false, description: "Whether this is expected to keep running. Defaults to false." },
        timeout_ms: { type: "integer", minimum: 1e3, maximum: 12e4, default: 12e4, description: "For foreground commands, maximum time to wait before returning status=running. The command is not killed on timeout." }
      },
      additionalProperties: false
    },
    outputSchema: RUN_COMMAND_OUTPUT_SCHEMA,
    annotations: { title: "Run Command", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  },
  {
    name: "get_command_output",
    title: "Get Command Output",
    vscodeToolName: "shuncode_get_command_output",
    capability: "execute",
    description: "Read new output, status and exit_code from a previously started run_command using its exact opaque command_id in the same native Chat or Bridge MCP session scope. Use next_offset on subsequent reads to avoid repeating old output.",
    inputSchema: {
      type: "object",
      required: ["command_id"],
      properties: {
        command_id: { type: "string", minLength: 1 },
        offset: { type: "integer", minimum: 0, default: 0, description: "Absolute UTF-8 byte offset into captured output." },
        max_bytes: { type: "integer", minimum: 1, maximum: 131072, default: 32768 }
      },
      additionalProperties: false
    },
    outputSchema: GENERIC_OUTPUT_SCHEMA,
    annotations: { title: "Get Command Output", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "cancel_command",
    title: "Cancel Command",
    vscodeToolName: "shuncode_cancel_command",
    capability: "execute",
    description: "Cancel a managed command using its exact cryptographically random command_id in the same native Chat or Bridge MCP session scope. The first request sends a soft foreground interrupt and waits for grace_ms. If force_required remains true, force=true may close only that managed terminal. High-risk packaging, signing, installation, migration, archive mutation/restore and bulk-move operations require a host-owned local confirmation; the AI cannot approve it.",
    inputSchema: {
      type: "object",
      required: ["command_id"],
      properties: {
        command_id: { type: "string", minLength: 1 },
        grace_ms: { type: "integer", minimum: 100, maximum: 1e4, default: 1500 },
        force: { type: "boolean", default: false }
      },
      additionalProperties: false
    },
    outputSchema: GENERIC_OUTPUT_SCHEMA,
    annotations: { title: "Cancel Command", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "send_command_input",
    title: "Send Command Input",
    vscodeToolName: "shuncode_send_command_input",
    capability: "execute",
    description: "Send text to the terminal of a running command. Use for interactive prompts or REPL input. A newline is appended by default.",
    inputSchema: {
      type: "object",
      required: ["command_id", "input"],
      properties: {
        command_id: { type: "string", minLength: 1 },
        input: { type: "string" },
        append_newline: { type: "boolean", default: true }
      },
      additionalProperties: false
    }
  },
  {
    name: "wait",
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
    }
  },
  {
    name: "get_diagnostics",
    vscodeToolName: "shuncode_get_diagnostics",
    capability: "read",
    description: "Read current diagnostics from VS Code and active language services, including unsaved editor state when providers report it. Use after edits/builds to inspect errors and warnings structurally instead of parsing compiler output when diagnostics are available.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional workspace-relative file or directory scope." },
        severity: {
          type: "array",
          items: { type: "string", enum: ["error", "warning", "information", "hint"] },
          uniqueItems: true,
          description: "Optional severity filter. Defaults to all severities."
        },
        max_results: { type: "integer", minimum: 1, maximum: 500, default: 100 }
      },
      additionalProperties: false
    }
  },
  {
    name: "lsp",
    vscodeToolName: "shuncode_lsp",
    capability: "read",
    description: "Navigate code semantically through the language services already active in VS Code. Use this for code symbols rather than text search: workspace/document symbols, go-to-definition, references, implementations, and hover/type information. Results include provider_state, project_anchor, project_anchor_source, warmup_performed, and semantic_result_inconclusive metadata so empty semantic results and heuristic warm-up anchors are not over-interpreted. Use search_files for raw text and read_files after lsp locates the relevant implementation.",
    inputSchema: {
      type: "object",
      required: ["operation"],
      properties: {
        operation: {
          type: "string",
          enum: ["workspace_symbols", "document_symbols", "definition", "references", "implementation", "hover"],
          description: "Semantic operation to execute through VS Code language feature providers."
        },
        path: { type: "string", description: "Workspace source path. Workspace-relative is preferred; absolute paths are accepted only when they remain inside the workspace. Required for document_symbols/definition/references/implementation/hover. Optional for workspace_symbols as a project/file/directory anchor to activate the relevant language project before semantic search." },
        line: { type: "integer", minimum: 1, description: "1-based source line. Required for definition/references/implementation/hover." },
        column: { type: "integer", minimum: 1, description: "1-based UTF-16 source column. Required for definition/references/implementation/hover." },
        query: { type: "string", description: "Symbol query. Required for workspace_symbols." },
        include_declaration: { type: "boolean", default: true, description: "For references, include the symbol declaration/definition when present." },
        max_results: { type: "integer", minimum: 1, maximum: 500, description: "Maximum returned semantic results. Operation-specific defaults are used when omitted." }
      },
      additionalProperties: false
    }
  }
];

var IDE_TOOL_NAMES = IDE_TOOL_DEFINITIONS.map((tool) => tool.name);

var BRIDGE_EXCLUDED_TOOL_NAMES = /* @__PURE__ */ new Set(["wait"]);

function getIdeToolDefinition(name) {
  return IDE_TOOL_DEFINITIONS.find((tool) => tool.name === name);
}

export { BRIDGE_EXCLUDED_TOOL_NAMES, GENERIC_OUTPUT_SCHEMA, IDE_TOOL_DEFINITIONS, IDE_TOOL_NAMES, MANAGED_SHELL_DESCRIPTION, RUN_COMMAND_OUTPUT_SCHEMA, getIdeToolDefinition };
