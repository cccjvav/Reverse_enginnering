// EXTRACTED from src/custom-tool-contract.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var CUSTOM_TOOLS_DIR_NAME = ".shuncode/mcp-tools";
var SKILLS_DIR_NAME = CUSTOM_TOOLS_DIR_NAME;
var LEGACY_SKILLS_DIR_NAME = ".shuncode/skills";
var CUSTOM_TOOL_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    exit_code: { type: ["integer", "null"] },
    timed_out: { type: "boolean" },
    aborted: { type: "boolean" },
    duration_ms: { type: "integer" }
  },
  required: ["exit_code", "timed_out", "aborted", "duration_ms"],
  additionalProperties: true
};
var TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
var MIN_DESCRIPTION_LENGTH = 80;
var MAX_DESCRIPTION_LENGTH = 4e3;
var MIN_TIMEOUT_MS = 1e3;
var MAX_TIMEOUT_MS = 6e5;
var DEFAULT_TIMEOUT_MS = 12e4;
var RESERVED_TOOL_NAMES = /* @__PURE__ */ new Set([...FILE_TOOL_NAMES, ...IDE_TOOL_NAMES, "batch_file_tools", "read_file", "list_skills"]);
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
