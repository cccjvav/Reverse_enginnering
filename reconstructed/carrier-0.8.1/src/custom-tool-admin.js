// EXTRACTED from src/custom-tool-admin.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var import_node_fs17 = require("node:fs");
var import_node_path22 = __toESM(require("node:path"), 1);
function toggleCustomTool(workspaceRoots, name, log) {
  const manifest = loadCustomTools(workspaceRoots, log).find((tool) => tool.name === name);
  if (!manifest) throw new Error(`Unknown custom tool: ${name}.`);
  if (manifest.skillDir) {
    if (manifest.scope === "global" && !isGlobalSkillDirectory(manifest.skillDir)) throw new Error("\u5168\u5C40 Skill \u8DEF\u5F84\u65E0\u6548\u6216\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
    const sidecarPath = import_node_path22.default.join(manifest.skillDir, SKILL_SIDECAR_FILE);
    let value = {};
    if ((0, import_node_fs17.existsSync)(sidecarPath)) {
      const parsed2 = JSON.parse((0, import_node_fs17.readFileSync)(sidecarPath, "utf8"));
      if (!isRecord(parsed2)) throw new Error(`Custom tool sidecar is invalid: ${sidecarPath}.`);
      value = parsed2;
    }
    const next2 = { ...value, enabled: !manifest.enabled };
    (0, import_node_fs17.writeFileSync)(sidecarPath, JSON.stringify(next2, null, 2) + "\n");
    return { name, enabled: next2.enabled };
  }
  const parsed = JSON.parse((0, import_node_fs17.readFileSync)(manifest.sourcePath, "utf8"));
  if (!isRecord(parsed)) throw new Error(`Custom tool manifest is invalid: ${manifest.sourcePath}.`);
  const next = { ...parsed, enabled: !manifest.enabled };
  (0, import_node_fs17.writeFileSync)(manifest.sourcePath, JSON.stringify(next, null, 2) + "\n");
  return { name, enabled: next.enabled };
}
function deleteCustomTool(workspaceRoots, name, log) {
  const manifest = loadCustomTools(workspaceRoots, log).find((tool) => tool.name === name);
  if (!manifest) throw new Error(`Unknown custom tool: ${name}.`);
  if (manifest.skillDir) {
    if (manifest.scope === "global" && !isGlobalSkillDirectory(manifest.skillDir)) throw new Error("\u5168\u5C40 Skill \u8DEF\u5F84\u65E0\u6548\u6216\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
    if (!(manifest.scope === "global" && isGlobalSkillDirectory(manifest.skillDir)) && !workspaceRoots.some((root) => import_node_path22.default.dirname(manifest.skillDir) === import_node_path22.default.join(root, SKILLS_DIR_NAME))) throw new Error(`Custom tool directory is outside the skills directory: ${manifest.skillDir}.`);
    (0, import_node_fs17.rmSync)(manifest.skillDir, { recursive: true });
    return { name, deleted: manifest.skillDir };
  }
  const contained = workspaceRoots.some((root) => manifest.sourcePath.startsWith(import_node_path22.default.join(root, CUSTOM_TOOLS_DIR_NAME) + import_node_path22.default.sep) && manifest.sourcePath.endsWith(".json"));
  if (!contained) throw new Error(`Custom tool manifest is outside the tools directory: ${manifest.sourcePath}.`);
  (0, import_node_fs17.unlinkSync)(manifest.sourcePath);
  return { name, deleted: manifest.sourcePath };
}
