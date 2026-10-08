// EXTRACTED from src/bridge-task-owner.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var import_node_crypto17 = require("node:crypto");
var MODERN_COMMAND_OWNER_PREFIX = "modern:";
var MODERN_TASK_OWNER_PREFIX = "task-modern:";
function bridgeIdentityDigest(identity) {
  return (0, import_node_crypto17.createHash)("sha256").update(JSON.stringify(identity)).digest("hex");
}
function bridgeOwnerFromIdentity(prefix, identity) {
  return `${prefix}${bridgeIdentityDigest(identity)}`;
}
