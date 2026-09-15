// RECONSTRUCTED from src/custom-tool-contract.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.
import { FILE_TOOL_NAMES } from './file-tool-registry.js';
import { IDE_TOOL_NAMES } from './ide-tool-definitions.js';

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

var RESERVED_TOOL_NAMES = /* @__PURE__ */ new Set([...FILE_TOOL_NAMES, ...IDE_TOOL_NAMES, "batch_file_tools", "read_file"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { CUSTOM_TOOLS_DIR_NAME, CUSTOM_TOOL_OUTPUT_SCHEMA, DEFAULT_TIMEOUT_MS, LEGACY_SKILLS_DIR_NAME, MAX_DESCRIPTION_LENGTH, MAX_TIMEOUT_MS, MIN_DESCRIPTION_LENGTH, MIN_TIMEOUT_MS, RESERVED_TOOL_NAMES, SKILLS_DIR_NAME, TOOL_NAME_PATTERN, isRecord };
