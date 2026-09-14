// RECONSTRUCTED from src/workspace-paths.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


import * as import_promises from "node:fs/promises";

var STALE_ROOT_CODES = /* @__PURE__ */ new Set(["ENOENT", "ENOTDIR"]);

async function canonicalizeWorkspaceRoots(roots, createUnavailableError) {
  if (roots.length === 0) {
    throw createUnavailableError("No workspace root is configured.");
  }
  const canonical = [];
  for (const root of roots) {
    try {
      canonical.push(await (0, import_promises.realpath)(root));
    } catch (error2) {
      const code = error2.code;
      if (code && STALE_ROOT_CODES.has(code)) continue;
      throw error2;
    }
  }
  if (canonical.length === 0) {
    throw createUnavailableError(
      "No usable workspace root is available; every configured root is missing or no longer a directory."
    );
  }
  return [...new Set(canonical)];
}

function literalFirstPathSpellings(requestedPath) {
  if (!requestedPath.includes("\\")) {
    return [requestedPath];
  }
  const slashSpelling = requestedPath.replace(/\\/g, "/");
  return slashSpelling === requestedPath ? [requestedPath] : [requestedPath, slashSpelling];
}

export { STALE_ROOT_CODES, canonicalizeWorkspaceRoots, import_promises, literalFirstPathSpellings };
