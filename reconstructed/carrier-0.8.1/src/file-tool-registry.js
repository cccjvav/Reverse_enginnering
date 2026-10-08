// EXTRACTED from src/file-tool-registry.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var APPLY_PATCH_TOOL = {
  name: "apply_patch",
  title: "Apply Patch",
  description: [
    "Edit files in allowed workspace roots with one Codex-style patch. Keep changes modular and read the affected sections first, including in large files.",
    "Start/end with '*** Begin Patch'/'*** End Patch'. Directives: '*** Add File:', '*** Update File:' (optionally followed by '*** Move to:'), and '*** Delete File:'. In @@ hunks, prefix context with a space, removals with '-', additions with '+'. Context must match exactly and uniquely.",
    "Add File and Move to automatically create missing parent directories inside allowed roots. No preliminary mkdir or placeholder file is needed. For a requested empty directory use run_command, within the authorized scope.",
    "Pass expected_versions from read_files. On STALE_FILE or ambiguous context, re-read; after an uncertain response, inspect before retrying. Check error codes rather than assuming the tool lacks a capability.",
    "The runtime validates paths/versions/permissions before writing, locks overlapping paths and stages file images. It preserves existing BOM/line endings. Failed writes roll back; cleanup removes only newly created, unchanged, empty directories. Validated operations require no additional interactive approval.",
    "Returns the actual applied unified diff. Commits are rollback-capable, not filesystem-wide atomic. Outside paths, unsafe symlinks and permission denials remain blocked."
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      patch: {
        type: "string",
        minLength: 1,
        description: "Codex-style patch text using *** Begin Patch / *** End Patch and Add/Update/Delete/Move directives."
      },
      expected_versions: {
        type: "object",
        additionalProperties: { type: "string", pattern: "^sha256:" },
        description: "Optional map from existing file paths to sha256:... versions previously returned by read_files. Strongly recommended whenever those versions are available."
      }
    },
    required: ["patch"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["success", "error"] },
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["add", "update", "delete", "move"] },
            path: { type: "string" },
            destination_path: { type: "string" },
            old_version: { type: ["string", "null"] },
            new_version: { type: ["string", "null"] },
            additions: { type: "integer" },
            deletions: { type: "integer" }
          },
          required: ["action", "path"],
          additionalProperties: true
        }
      },
      summary: {
        type: "object",
        properties: {
          files_changed: { type: "integer" },
          additions: { type: "integer" },
          deletions: { type: "integer" }
        },
        additionalProperties: true
      },
      diff: { type: "string" },
      diff_truncated: { type: "boolean" },
      error_code: { type: "string" },
      message: { type: "string" }
    },
    required: ["status"],
    additionalProperties: true
  },
  annotations: {
    title: "Apply Patch",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false
  }
};
var READ_FILES_TOOL = {
  name: "read_files",
  title: "Read Files",
  description: [
    "Read one or more UTF-8 text files from the current local workspace opened in ShunCode.",
    "These file tools are scoped to the open workspace folder(s) and, on the Bridge, the global Skill directory reported by list_skills. If the user clearly points to another local path on this same Windows host outside those roots, inspect that path with run_command first instead of treating workspace-only results as proof of absence.",
    "Batch independent files together in one call.",
    "For small files, omit start_line/end_line to read the complete file.",
    "For large files, results may be truncated and include next_start_line.",
    "For large-file work, prefer search_files and explicit line ranges so you read only the sections that matter before expanding scope.",
    "A satisfied explicit range can still report has_more=true when the file continues afterward.",
    "Use 1-based inclusive start_line/end_line for targeted reads.",
    "Successful result paths are normalized to workspace-relative paths even when the request used an absolute in-workspace path.",
    "Files at or above the very-large-file threshold require an explicit range. Smaller files may still be automatically truncated by per-file line/byte/token budgets; prefer search_files before targeted reads when location is unknown."
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        description: "Files to read. Independent files should be requested together.",
        items: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Workspace file path inside the currently open local ShunCode folder(s). Workspace-relative is preferred; an absolute path is accepted only when it remains inside an allowed workspace root for this session."
            },
            start_line: {
              type: "integer",
              minimum: 1,
              description: "Optional 1-based inclusive first line."
            },
            end_line: {
              type: "integer",
              minimum: 1,
              description: "Optional 1-based inclusive last line."
            }
          },
          required: ["path"],
          additionalProperties: false
        }
      }
    },
    required: ["files"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            status: { type: "string", enum: ["success", "error", "skipped"] },
            content: { type: "string" },
            start_line: { type: "integer" },
            end_line: { type: ["integer", "null"] },
            total_lines: { type: "integer" },
            truncated: { type: "boolean" },
            has_more: { type: "boolean" },
            next_start_line: { type: ["integer", "null"] },
            size_bytes: { type: "integer" },
            version: { type: "string" },
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" }
              },
              additionalProperties: true
            }
          },
          required: ["path", "status"],
          additionalProperties: true
        }
      },
      summary: {
        type: "object",
        properties: {
          requested: { type: "integer" },
          succeeded: { type: "integer" },
          failed: { type: "integer" },
          skipped: { type: "integer" },
          truncated: { type: "integer" }
        },
        required: ["requested", "succeeded", "failed"],
        additionalProperties: true
      }
    },
    required: ["files", "summary"],
    additionalProperties: true
  },
  annotations: {
    title: "Read Files",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  }
};
var READ_IMAGE_TOOL = {
  name: "read_image",
  title: "Read Image",
  description: [
    "Read an image file from the current local workspace opened in ShunCode and inspect its visual metadata and content.",
    "Supported image formats include PNG, JPEG, GIF, WebP, BMP, SVG, and ICO.",
    "Returns image dimensions (width, height), aspect ratio, format, MIME type, file size, and base64 data URI.",
    "Use this to inspect UI mockups, icons, screenshots, diagrams, and visual assets before implementing or verifying designs."
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        minLength: 1,
        description: "Workspace image path inside the currently open local ShunCode folder(s). Workspace-relative is preferred."
      },
      include_data_uri: {
        type: "boolean",
        description: "Whether to include the base64 data URI in the response. Defaults to true."
      }
    },
    required: ["path"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      status: { type: "string", enum: ["success", "error"] },
      format: { type: "string" },
      mime_type: { type: "string" },
      width: { type: ["integer", "null"] },
      height: { type: ["integer", "null"] },
      aspect_ratio: { type: ["string", "null"] },
      size_bytes: { type: "integer" },
      size_formatted: { type: "string" },
      data_uri: { type: "string" },
      base64: { type: "string" },
      error: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" }
        },
        required: ["code", "message"],
        additionalProperties: true
      }
    },
    required: ["path", "status"],
    additionalProperties: true
  },
  annotations: {
    title: "Read Image",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  }
};
var FIND_FILES_TOOL = {
  name: "find_files",
  title: "Find Files",
  description: [
    "Find files by path/name glob patterns inside the current workspace; this does not search file contents.",
    "Use find_files when you know a filename, extension, or path shape but not the exact path. Use search_files when you need to search file contents. Use it for fuzzy filename/path discovery inside the workspace.",
    "Batch independent file patterns together in the patterns array instead of making separate calls.",
    "Patterns are evaluated relative to path, which defaults to the current local workspace root opened in ShunCode. Basename-only patterns such as '*.ts' match recursively within that scope. Results are files only, never directories.",
    "Returned file paths and the reported scope are normalized to workspace-relative paths even when path was supplied as an absolute in-workspace directory.",
    "By default matching is case-insensitive, ignored/common generated directories and hidden paths are skipped, and results are sorted by modification time newest first.",
    "Use exclude for additional path globs, include_hidden/no_ignore only when those files are intentionally needed, and sort='path_asc' when deterministic path order matters.",
    "If the conversation points to a sibling checkout, external-disk folder, or approximate local path outside the workspace, use run_command with ls/find/grep there instead of assuming find_files can see it.",
    "Results are hard-bounded: at most 5000 candidate paths are collected internally before sorting, and by default only 100 paths are returned (hard maximum 500). If truncated=true, narrow path/patterns before increasing max_results."
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      patterns: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: { type: "string", minLength: 1 },
        description: "One or more glob patterns to find in a single call, e.g. ['**/*-files.ts', '**/mcp-server.ts']."
      },
      path: {
        type: "string",
        description: "Optional workspace directory scope inside the currently open local ShunCode folder(s). Workspace-relative is preferred; an absolute path is accepted only when it remains inside an allowed workspace root for this session. Defaults to '.'."
      },
      exclude: {
        type: "array",
        maxItems: 50,
        items: { type: "string", minLength: 1 },
        description: "Optional glob patterns to exclude, evaluated relative to the requested path scope."
      },
      case_sensitive: {
        type: "boolean",
        description: "Whether glob matching is case-sensitive. Defaults to false."
      },
      no_ignore: {
        type: "boolean",
        description: "Set true to bypass ignore files/common generated-directory excludes. Defaults to false."
      },
      include_hidden: {
        type: "boolean",
        description: "Set true to include hidden files/directories. Defaults to false."
      },
      max_results: {
        type: "integer",
        minimum: 1,
        maximum: 500,
        description: "Maximum file paths returned. Defaults to 100; hard maximum 500."
      },
      sort: {
        type: "string",
        enum: ["modified_desc", "path_asc"],
        description: "Result order. Defaults to modified_desc (newest first); path_asc gives deterministic lexical order."
      }
    },
    required: ["patterns"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      patterns: { type: "array", items: { type: "string" } },
      scope: { type: "string" },
      engine: { type: "string", enum: ["ripgrep", "node"] },
      sort: { type: "string", enum: ["modified_desc", "path_asc"] },
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            size_bytes: { type: "integer" },
            modified_ms: { type: "number" }
          },
          required: ["path"],
          additionalProperties: true
        }
      },
      summary: {
        type: "object",
        properties: {
          candidate_paths: { type: "integer" },
          returned_files: { type: "integer" },
          truncated: { type: "boolean" },
          truncation_reasons: { type: "array", items: { type: "string" } }
        },
        additionalProperties: true
      }
    },
    required: ["patterns", "scope", "files", "summary"],
    additionalProperties: true
  },
  annotations: {
    title: "Find Files",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  }
};
var SEARCH_FILES_TOOL = {
  name: "search_files",
  title: "Search Files",
  description: [
    "Search UTF-8 text file contents inside the current workspace and return bounded path/line/snippet matches.",
    "Use this to locate relevant code before calling read_files.",
    "Use this to narrow large files to the relevant regions before broader reads or edits.",
    "This search is scoped to the open workspace folder(s) and, on the Bridge, the global Skill directory; if the user points to another local path on the same Windows host outside those roots, inspect that path with run_command first.",
    "Literal search is the default; set is_regex=true only when regular-expression semantics are required.",
    "Omit case_sensitive for smart-case (lowercase patterns are case-insensitive; uppercase makes the search case-sensitive).",
    "Use path to narrow the directory/file scope and include/exclude glob arrays to filter files.",
    "Returned match paths and the reported scope are normalized to workspace-relative paths even when path was supplied as an absolute in-workspace path.",
    "context_lines returns nearby lines for disambiguation; keep it small because search is for locating code, not reading whole files.",
    "Results are hard-bounded by per-file/global/output budgets. If truncated=true, narrow the query and search again.",
    "By default ignored/common generated directories and hidden paths are skipped."
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        minLength: 1,
        description: "Text or regex pattern to search for. Literal text by default."
      },
      path: {
        type: "string",
        description: "Optional workspace file or directory scope inside the currently open local ShunCode folder(s). Workspace-relative is preferred; an absolute path is accepted only when it remains inside an allowed workspace root for this session. Defaults to '.'."
      },
      is_regex: {
        type: "boolean",
        description: "Set true to interpret pattern as a regular expression. Defaults to false (literal search)."
      },
      case_sensitive: {
        type: "boolean",
        description: "Optional case mode. true=sensitive, false=insensitive, omitted=smart-case."
      },
      include: {
        type: "array",
        items: { type: "string", minLength: 1 },
        description: "Optional glob filters evaluated relative to the requested path scope, e.g. ['**/*.ts', '**/*.tsx']."
      },
      exclude: {
        type: "array",
        items: { type: "string", minLength: 1 },
        description: "Optional glob filters evaluated relative to the requested path scope, e.g. ['**/*.test.ts']."
      },
      context_lines: {
        type: "integer",
        minimum: 0,
        maximum: 20,
        description: "Surrounding lines on each side of each match. Defaults to 1, maximum 20."
      },
      max_results: {
        type: "integer",
        minimum: 1,
        maximum: 500,
        description: "Maximum matches returned across the call. Defaults to 100; hard maximum 500."
      },
      max_matches_per_file: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Maximum matches returned from one file. Defaults to 20; hard maximum 100."
      },
      no_ignore: {
        type: "boolean",
        description: "Set true to ignore .gitignore/common excludes. Defaults to false."
      },
      include_hidden: {
        type: "boolean",
        description: "Set true to include hidden files/directories. Defaults to false."
      }
    },
    required: ["pattern"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      mode: { type: "string", enum: ["literal", "regex"] },
      case_mode: { type: "string", enum: ["sensitive", "insensitive", "smart"] },
      scope: { type: "string" },
      engine: { type: "string", enum: ["ripgrep", "node"] },
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            line: { type: "integer" },
            column: { type: "integer" },
            text: { type: "string" },
            before: { type: "array", items: { type: "object", additionalProperties: true } },
            after: { type: "array", items: { type: "object", additionalProperties: true } }
          },
          required: ["path", "line", "column", "text"],
          additionalProperties: true
        }
      },
      summary: {
        type: "object",
        properties: {
          returned_matches: { type: "integer" },
          files_with_matches: { type: "integer" },
          truncated: { type: "boolean" }
        },
        additionalProperties: true
      }
    },
    required: ["pattern", "matches", "summary"],
    additionalProperties: true
  },
  annotations: {
    title: "Search Files",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  }
};
var FILE_TOOL_DEFINITIONS = [
  APPLY_PATCH_TOOL,
  FIND_FILES_TOOL,
  READ_FILES_TOOL,
  READ_IMAGE_TOOL,
  SEARCH_FILES_TOOL
];
var FILE_TOOL_NAMES = FILE_TOOL_DEFINITIONS.map((tool) => tool.name);
function asObjectRow(value) {
  if (!value || typeof value !== "object") {
    throw new Error("INVALID_ARGUMENT: expected an object.");
  }
  return value;
}
function assertOptionalNonEmptyString(row, key) {
  const candidate = row[key];
  if (candidate !== void 0 && (typeof candidate !== "string" || candidate.length === 0)) {
    throw new Error(`INVALID_ARGUMENT: ${key} must be a non-empty string when provided.`);
  }
}
function assertOptionalBooleans(row, keys) {
  for (const key of keys) {
    if (row[key] !== void 0 && typeof row[key] !== "boolean") {
      throw new Error(`INVALID_ARGUMENT: ${key} must be a boolean when provided.`);
    }
  }
}
function assertOptionalIntegers(row, keys) {
  for (const key of keys) {
    if (row[key] !== void 0 && !Number.isInteger(row[key])) {
      throw new Error(`INVALID_ARGUMENT: ${key} must be an integer when provided.`);
    }
  }
}
function assertOptionalStringArrays(row, keys) {
  for (const key of keys) {
    const candidate = row[key];
    if (candidate !== void 0 && (!Array.isArray(candidate) || candidate.some((item) => typeof item !== "string" || item.length === 0))) {
      throw new Error(`INVALID_ARGUMENT: ${key} must be an array of non-empty strings when provided.`);
    }
  }
}
function parseApplyPatchInput(value) {
  const row = asObjectRow(value);
  if (typeof row.patch !== "string" || row.patch.length === 0) {
    throw new Error("INVALID_ARGUMENT: patch must be a non-empty string.");
  }
  if (row.expected_versions !== void 0) {
    if (!row.expected_versions || typeof row.expected_versions !== "object" || Array.isArray(row.expected_versions)) {
      throw new Error("INVALID_ARGUMENT: expected_versions must be an object mapping paths to sha256 versions.");
    }
    for (const [filePath, version2] of Object.entries(row.expected_versions)) {
      if (!filePath || typeof version2 !== "string" || !version2.startsWith("sha256:")) {
        throw new Error("INVALID_ARGUMENT: expected_versions entries must map non-empty paths to sha256:... strings.");
      }
    }
  }
  return {
    patch: row.patch,
    expected_versions: row.expected_versions
  };
}
function parseReadFilesInput(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.files)) {
    throw new Error("INVALID_ARGUMENT: expected an object with a files array.");
  }
  const files = value.files;
  if (files.length === 0) throw new Error("INVALID_ARGUMENT: files must not be empty.");
  return {
    files: files.map((item, index) => {
      if (!item || typeof item !== "object") {
        throw new Error(`INVALID_ARGUMENT: files[${index}] must be an object.`);
      }
      const row = item;
      if (typeof row.path !== "string" || row.path.length === 0) {
        throw new Error(`INVALID_ARGUMENT: files[${index}].path must be a non-empty string.`);
      }
      if (row.start_line !== void 0 && (!Number.isInteger(row.start_line) || row.start_line < 1)) {
        throw new Error(`INVALID_ARGUMENT: files[${index}].start_line must be an integer >= 1.`);
      }
      if (row.end_line !== void 0 && (!Number.isInteger(row.end_line) || row.end_line < 1)) {
        throw new Error(`INVALID_ARGUMENT: files[${index}].end_line must be an integer >= 1.`);
      }
      return {
        path: row.path,
        start_line: row.start_line,
        end_line: row.end_line
      };
    })
  };
}
function parseReadImageInput(value) {
  const row = asObjectRow(value);
  if (typeof row.path !== "string" || row.path.length === 0) {
    throw new Error("INVALID_ARGUMENT: path must be a non-empty string.");
  }
  assertOptionalBooleans(row, ["include_data_uri"]);
  return {
    path: row.path,
    include_data_uri: row.include_data_uri
  };
}
function parseFindFilesInput(value) {
  const row = asObjectRow(value);
  if (!Array.isArray(row.patterns) || row.patterns.length === 0 || row.patterns.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error("INVALID_ARGUMENT: patterns must be a non-empty array of non-empty strings.");
  }
  assertOptionalNonEmptyString(row, "path");
  if (row.exclude !== void 0 && (!Array.isArray(row.exclude) || row.exclude.some((item) => typeof item !== "string" || item.length === 0))) {
    throw new Error("INVALID_ARGUMENT: exclude must be an array of non-empty strings when provided.");
  }
  assertOptionalBooleans(row, ["case_sensitive", "no_ignore", "include_hidden"]);
  assertOptionalIntegers(row, ["max_results"]);
  if (row.sort !== void 0 && row.sort !== "modified_desc" && row.sort !== "path_asc") {
    throw new Error("INVALID_ARGUMENT: sort must be 'modified_desc' or 'path_asc'.");
  }
  return {
    patterns: row.patterns,
    path: row.path,
    exclude: row.exclude,
    case_sensitive: row.case_sensitive,
    no_ignore: row.no_ignore,
    include_hidden: row.include_hidden,
    max_results: row.max_results,
    sort: row.sort
  };
}
function parseSearchFilesInput(value) {
  const row = asObjectRow(value);
  if (typeof row.pattern !== "string" || row.pattern.length === 0) {
    throw new Error("INVALID_ARGUMENT: pattern must be a non-empty string.");
  }
  assertOptionalNonEmptyString(row, "path");
  assertOptionalBooleans(row, ["is_regex", "case_sensitive", "no_ignore", "include_hidden"]);
  assertOptionalStringArrays(row, ["include", "exclude"]);
  assertOptionalIntegers(row, ["context_lines", "max_results", "max_matches_per_file"]);
  return {
    pattern: row.pattern,
    path: row.path,
    is_regex: row.is_regex,
    case_sensitive: row.case_sensitive,
    include: row.include,
    exclude: row.exclude,
    context_lines: row.context_lines,
    max_results: row.max_results,
    max_matches_per_file: row.max_matches_per_file,
    no_ignore: row.no_ignore,
    include_hidden: row.include_hidden
  };
}
function isFileToolName(name) {
  return FILE_TOOL_NAMES.includes(name);
}
var FILE_TOOL_ERROR_TAGS = {
  apply_patch: "APPLY_PATCH",
  find_files: "FIND_FILES",
  read_files: "READ_FILES",
  read_image: "READ_IMAGE",
  search_files: "SEARCH_FILES"
};
function resolveFileToolErrorCode(error2, message2) {
  const className = error2?.constructor?.name ?? "";
  if (/(?:FindFiles|SearchTool|ReadTool|ReadImageTool|PatchTool)Error$/.test(className)) {
    const code = error2.code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  if (message2.startsWith("INVALID_ARGUMENT:")) return "INVALID_ARGUMENT";
  return "UNEXPECTED";
}
function buildFileToolErrorResult(name, error2) {
  const message2 = error2 instanceof Error ? error2.message : String(error2 ?? "");
  const code = resolveFileToolErrorCode(error2, message2);
  const at = error2?.at;
  const tag = FILE_TOOL_ERROR_TAGS[normalizeFileToolName(name)] ?? "FILE_TOOL";
  const structuredContent = {
    status: "error",
    error_code: code,
    message: message2,
    ...at ? { invalid_glob_source: at } : {}
  };
  const lines = [
    `=== ${tag} BEGIN ===`,
    "status: error",
    `error_code: ${code}`,
    `message: ${message2.replace(/[\r\n]+/g, " ")}`,
    ...at ? [`invalid_glob_source: ${JSON.stringify(at)}`] : [],
    "NOTE: nothing was read or written; correct the reported field before retrying.",
    `=== ${tag} END ===`
  ];
  return { text: lines.join("\n"), structuredContent, isError: true };
}
async function invokeFileTool(name, args, context) {
  try {
    const { workspaceRoots } = context;
    return await dispatchFileTool(name, args, {
      ...context,
      workspaceRoots: typeof workspaceRoots === "function" ? workspaceRoots() : workspaceRoots
    });
  } catch (error2) {
    return buildFileToolErrorResult(name, error2);
  }
}
async function dispatchFileTool(name, args, context) {
  const canonicalName = normalizeFileToolName(name);
  const normalizedArgs = normalizeFileToolInput(canonicalName, args);
  const definition = FILE_TOOL_DEFINITIONS.find((tool) => tool.name === canonicalName);
  if (!definition) throw new Error(`Unknown file tool: ${name}`);
  validateToolInput(definition.name, definition.inputSchema, normalizedArgs);
  if (canonicalName === APPLY_PATCH_TOOL.name) {
    const result = await applyPatch(parseApplyPatchInput(normalizedArgs), {
      workspaceRoots: context.workspaceRoots,
      signal: context.signal
    });
    return { text: formatApplyPatchForModel(result), structuredContent: result };
  }
  if (canonicalName === FIND_FILES_TOOL.name) {
    const result = await findFiles(parseFindFilesInput(normalizedArgs), {
      workspaceRoots: context.workspaceRoots,
      signal: context.signal
    });
    return { text: formatFindFilesForModel(result), structuredContent: result };
  }
  if (canonicalName === READ_FILES_TOOL.name) {
    const result = await readFiles(parseReadFilesInput(normalizedArgs), {
      workspaceRoots: context.workspaceRoots,
      signal: context.signal
    });
    return {
      text: formatReadFilesForModel(result),
      structuredContent: result,
      isError: result.summary.succeeded === 0 && result.summary.failed > 0 || void 0
    };
  }
  if (canonicalName === READ_IMAGE_TOOL.name) {
    const result = await readImage(parseReadImageInput(normalizedArgs), {
      workspaceRoots: context.workspaceRoots,
      signal: context.signal
    });
    const text2 = formatReadImageForModel(result);
    const content = [{ type: "text", text: text2 }];
    if (result.status === "error") {
      return { text: text2, structuredContent: result, content, isError: true };
    }
    const { base64: base642, ...metadata } = result;
    if (!base642) throw new Error("read_image returned success without image data.");
    content.push({ type: "image", data: base642, mimeType: result.mime_type });
    return { text: text2, structuredContent: metadata, content };
  }
  if (canonicalName === SEARCH_FILES_TOOL.name) {
    const result = await searchFiles(parseSearchFilesInput(normalizedArgs), {
      workspaceRoots: context.workspaceRoots,
      signal: context.signal
    });
    return { text: formatSearchFilesForModel(result), structuredContent: result };
  }
  throw new Error(`Unknown file tool: ${name}`);
}
