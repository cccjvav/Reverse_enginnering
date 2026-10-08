// EXTRACTED from src/custom-tools.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var MAX_MANIFESTS_PER_ROOT = 64;
function loadCustomTools(workspaceRoots, log, options = {}) {
  const tools = /* @__PURE__ */ new Map();
  if (options.skillsEnabled !== false) for (const tool of loadGlobalSkills(log)) tools.set(tool.name, tool);
  for (const root of workspaceRoots) {
    let entries;
    try {
      entries = (0, import_node_fs16.readdirSync)(import_node_path21.default.join(root, CUSTOM_TOOLS_DIR_NAME));
    } catch {
      continue;
    }
    for (const file of entries.filter((entry) => entry.endsWith(".json")).sort().slice(0, MAX_MANIFESTS_PER_ROOT)) {
      const manifest = readManifest(import_node_path21.default.join(root, CUSTOM_TOOLS_DIR_NAME, file), log);
      if (!manifest) continue;
      if (tools.has(manifest.name)) {
        log?.(`[custom-tools] duplicate tool ${manifest.name}; keeping first.`);
        continue;
      }
      tools.set(manifest.name, manifest);
    }
  }
  if (options.skillsEnabled !== false) for (const root of workspaceRoots) {
    migrateLegacySkillDirs(root, log);
    for (const manifest of loadSkillTools(root, log)) {
      if (tools.has(manifest.name)) {
        log?.(`[custom-tools] duplicate tool ${manifest.name}; keeping first.`);
        continue;
      }
      tools.set(manifest.name, manifest);
    }
  }
  return [...tools.values()];
}
function listEnabledCustomTools(workspaceRoots, log, options = {}) {
  return loadCustomTools(workspaceRoots, log, options).filter((tool) => tool.enabled && !tool.skillDir);
}
function findCustomTool(workspaceRoots, name, log, options = {}) {
  return listEnabledCustomTools(workspaceRoots, log, options).find((tool) => tool.name === name);
}
function toStatusEntries(tools) {
  return tools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, enabled: tool.enabled, scope: tool.scope ?? "workspace", source: tool.skillDir ? "skill" : "manifest" }));
}
function customToolsFingerprint(tools) {
  return tools.map((tool) => JSON.stringify([tool.name, tool.title, tool.description, tool.enabled, tool.scope, tool.sourcePath, tool.command, tool.inputSchema, tool.timeoutMs])).sort().join(",");
}
