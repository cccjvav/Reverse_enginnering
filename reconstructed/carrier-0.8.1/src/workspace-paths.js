// EXTRACTED from src/workspace-paths.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var import_promises3 = require("node:fs/promises");
var STALE_ROOT_CODES = /* @__PURE__ */ new Set(["ENOENT", "ENOTDIR"]);
async function canonicalizeWorkspaceRoots(roots2, createUnavailableError) {
  if (roots2.length === 0) {
    throw createUnavailableError("No workspace root is configured.");
  }
  const canonical2 = [];
  for (const root of roots2) {
    try {
      canonical2.push(await (0, import_promises3.realpath)(root));
    } catch (error2) {
      const code = error2.code;
      if (code && STALE_ROOT_CODES.has(code)) continue;
      throw error2;
    }
  }
  if (canonical2.length === 0) {
    throw createUnavailableError(
      "No usable workspace root is available; every configured root is missing or no longer a directory."
    );
  }
  return [...new Set(canonical2)];
}
function literalFirstPathSpellings(requestedPath) {
  if (!requestedPath.includes("\\")) {
    return [requestedPath];
  }
  const slashSpelling = requestedPath.replace(/\\/g, "/");
  return slashSpelling === requestedPath ? [requestedPath] : [requestedPath, slashSpelling];
}
