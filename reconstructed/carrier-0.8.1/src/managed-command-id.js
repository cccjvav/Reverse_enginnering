// EXTRACTED from src/managed-command-id.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var import_node_crypto23 = require("node:crypto");
var MANAGED_COMMAND_ENTROPY_BYTES = 24;
var MANAGED_COMMAND_ID = /^cmd_(?:[a-f0-9]{48}|\d+_\d+)/i;
var MANAGED_COMMAND_ID_LABEL = /^command_id:[ \t]*/;
function createManagedCommandId(entropy = import_node_crypto23.randomBytes) {
  const bytes = entropy(MANAGED_COMMAND_ENTROPY_BYTES);
  if (bytes.byteLength !== MANAGED_COMMAND_ENTROPY_BYTES) {
    throw new Error(`Managed command id entropy must contain exactly ${MANAGED_COMMAND_ENTROPY_BYTES} bytes.`);
  }
  return `cmd_${Buffer.from(bytes).toString("hex")}`;
}
function normalizeManagedCommandId(value) {
  const trimmed = value.trim();
  const candidate = trimmed.replace(MANAGED_COMMAND_ID_LABEL, "");
  const match = candidate.match(MANAGED_COMMAND_ID);
  if (!match) return trimmed;
  const suffix = candidate.slice(match[0].length);
  return suffix === "" || /^(?:\s|\\n)/.test(suffix) ? match[0] : trimmed;
}
