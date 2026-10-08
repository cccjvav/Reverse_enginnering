// EXTRACTED from src/skill-import-recovery.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var import_node_fs10 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path15 = __toESM(require("node:path"), 1);
var IMPORT_STALE_MS = 10 * 60 * 1e3;
var STAGING_HARD_LIMIT_MS = 24 * 60 * 60 * 1e3;
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error2) {
    return error2.code === "EPERM";
  }
}
function recoverSkillImports(directory, options = {}) {
  const report = { rolledBack: [], rolledForward: [], removed: [], busy: 0 };
  if (!(0, import_node_fs10.existsSync)(directory)) return report;
  const now = options.now ?? Date.now(), host = options.host ?? (0, import_node_os2.hostname)(), alive = options.isAlive ?? processAlive;
  const inUse = /* @__PURE__ */ new Set();
  for (const journal of readImportJournals(directory)) {
    const live = journal.host === host ? alive(journal.pid) && now - journal.updatedAt < IMPORT_STALE_MS : now - journal.updatedAt < IMPORT_STALE_MS;
    if (live) {
      report.busy++;
      inUse.add(journal.staging);
      inUse.add(journal.target);
      continue;
    }
    (settleImportJournal(journal) === "rolled-back" ? report.rolledBack : report.rolledForward).push(journal.name);
  }
  for (const entry of (0, import_node_fs10.readdirSync)(directory, { withFileTypes: true })) {
    const full = import_node_path15.default.join(directory, entry.name);
    if (!entry.isDirectory() || inUse.has(full)) continue;
    if (entry.name.startsWith(".import-")) {
      const age = now - (0, import_node_fs10.statSync)(full).mtimeMs, owner = readStagingOwner(full);
      const orphan = owner === void 0 ? age > IMPORT_STALE_MS : owner.host === host ? !alive(owner.pid) : age > IMPORT_STALE_MS;
      if (orphan || age > STAGING_HARD_LIMIT_MS) {
        removeTree(full);
        report.removed.push(entry.name);
      }
      continue;
    }
    if (entry.name.startsWith(".")) continue;
    const marker = import_node_path15.default.join(full, IMPORTING_MARKER);
    if (!(0, import_node_fs10.existsSync)(marker)) continue;
    if (now - (0, import_node_fs10.statSync)(marker).mtimeMs > IMPORT_STALE_MS) {
      removeTree(full);
      report.removed.push(entry.name);
    } else report.busy++;
  }
  return report;
}
