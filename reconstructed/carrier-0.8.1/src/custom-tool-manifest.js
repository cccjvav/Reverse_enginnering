// EXTRACTED from src/custom-tool-manifest.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var import_node_fs13 = require("node:fs");
var import_node_path18 = __toESM(require("node:path"), 1);
var MAX_MANIFEST_BYTES = 65536;
var MAX_COMMAND_PARTS = 16;
var MAX_COMMAND_PART_LENGTH = 1024;
function parseManifest(value, sourcePath) {
  if (!isRecord(value)) return void 0;
  const { name, title, description, inputSchema, command, timeout_ms, enabled } = value;
  if (typeof name !== "string" || !TOOL_NAME_PATTERN.test(name) || RESERVED_TOOL_NAMES.has(name)) return void 0;
  if (typeof title !== "string" || !title.trim() || title.length > 80) return void 0;
  if (typeof description !== "string" || description.length < MIN_DESCRIPTION_LENGTH || description.length > MAX_DESCRIPTION_LENGTH) return void 0;
  if (!isRecord(inputSchema) || inputSchema.type !== "object") return void 0;
  if (!Array.isArray(command) || command.length < 1 || command.length > MAX_COMMAND_PARTS) return void 0;
  for (const part of command) if (typeof part !== "string" || !part || part.length > MAX_COMMAND_PART_LENGTH) return void 0;
  const parts = command;
  const head = parts[0];
  if (!head) return void 0;
  if (head !== "node" && (import_node_path18.default.isAbsolute(head) || head.split(/[\\/]/).includes(".."))) return void 0;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (timeout_ms !== void 0) {
    if (typeof timeout_ms !== "number" || !Number.isInteger(timeout_ms) || timeout_ms < MIN_TIMEOUT_MS || timeout_ms > MAX_TIMEOUT_MS) return void 0;
    timeoutMs = timeout_ms;
  }
  if (enabled !== void 0 && typeof enabled !== "boolean") return void 0;
  return { name, title: title.trim(), description, inputSchema, command: [...parts], timeoutMs, enabled: enabled ?? true, sourcePath };
}
function readManifest(sourcePath, log) {
  let raw;
  try {
    raw = (0, import_node_fs13.readFileSync)(sourcePath, "utf8");
  } catch {
    log?.(`[custom-tools] cannot read ${sourcePath}; skipping.`);
    return void 0;
  }
  if (raw.length > MAX_MANIFEST_BYTES) {
    log?.(`[custom-tools] manifest too large: ${sourcePath}; skipping.`);
    return void 0;
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    log?.(`[custom-tools] invalid JSON: ${sourcePath}; skipping.`);
    return void 0;
  }
  const manifest = parseManifest(value, sourcePath);
  if (!manifest) log?.(`[custom-tools] invalid manifest: ${sourcePath}; skipping.`);
  return manifest;
}
