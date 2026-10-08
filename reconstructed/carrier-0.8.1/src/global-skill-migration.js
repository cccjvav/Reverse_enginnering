// EXTRACTED from src/global-skill-migration.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var import_node_fs12 = require("node:fs");
var import_node_path17 = __toESM(require("node:path"), 1);
var same = (a, b) => {
  const left = import_node_path17.default.resolve(a), right = import_node_path17.default.resolve(b);
  return process.platform === "win32" || process.platform === "darwin" ? left.toLowerCase() === right.toLowerCase() : left === right;
};
function hasRootSkillFile(directory) {
  try {
    const markers = (0, import_node_fs12.readdirSync)(directory, { withFileTypes: true }).filter((entry) => /^skill\.md$/i.test(entry.name));
    return markers.length === 1 && markers[0].isFile();
  } catch {
    return false;
  }
}
function detectMigratableSkills(from, to) {
  if (!from || same(from, to)) return [];
  let entries;
  try {
    entries = (0, import_node_fs12.readdirSync)(from, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
    const directory = import_node_path17.default.join(from, entry.name);
    if (same(directory, to) || same(import_node_path17.default.resolve(to), directory) || import_node_path17.default.resolve(to).toLowerCase().startsWith(import_node_path17.default.resolve(directory).toLowerCase() + import_node_path17.default.sep)) continue;
    try {
      if ((0, import_node_fs12.lstatSync)(import_node_path17.default.join(directory, IMPORTING_MARKER)).isFile()) continue;
    } catch {
    }
    if (hasRootSkillFile(directory)) found.push({ name: entry.name, directory });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}
async function migrateGlobalSkills(from, skills, log) {
  const to = globalSkillsDirectory();
  if (!to) throw new Error("\u5C1A\u672A\u914D\u7F6E\u5168\u5C40 Skill \u76EE\u5F55\u3002");
  if (same(from, to)) throw new Error("\u65B0\u65E7\u5168\u5C40 Skill \u76EE\u5F55\u76F8\u540C\uFF0C\u65E0\u9700\u8FC1\u79FB\u3002");
  const migrated = [], skipped = [];
  for (const skill of skills) {
    try {
      const prepared = await prepareGlobalSkillImport(skill.directory, { origin: "internal", log });
      try {
        if (prepared.mode === "replace") {
          skipped.push({ name: skill.name, reason: `\u65B0\u76EE\u5F55\u5DF2\u6709\u540C\u540D Skill \u201C${prepared.name}\u201D\uFF0C\u672A\u8986\u76D6\u3002` });
          continue;
        }
        commitGlobalSkillImport(prepared, { log });
        migrated.push(prepared.name);
      } finally {
        discardGlobalSkillImport(prepared);
      }
    } catch (error2) {
      skipped.push({ name: skill.name, reason: error2 instanceof Error ? error2.message : String(error2) });
    }
  }
  log?.(`[global-skills] migrated ${migrated.length}/${skills.length} skill(s) from ${from} to ${to}`);
  return { from, to, migrated, skipped };
}
