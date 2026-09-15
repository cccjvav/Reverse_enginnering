// RECONSTRUCTED from src/custom-tools.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.
import { CUSTOM_TOOLS_DIR_NAME } from './custom-tool-contract.js';
import { readManifest } from './custom-tool-manifest.js';
import { migrateLegacySkillDirs } from './custom-tool-migration.js';
import { loadSkillTools } from './custom-tool-skill.js';

import * as import_node_fs6 from "node:fs";

import * as import_node_path10 from "node:path";

var MAX_MANIFESTS_PER_ROOT = 64;

function loadCustomTools(workspaceRoots, log, options = {}) {
  const tools = /* @__PURE__ */ new Map();
  for (const root of workspaceRoots) {
    let entries;
    try {
      entries = (0, import_node_fs6.readdirSync)(import_node_path10.default.join(root, CUSTOM_TOOLS_DIR_NAME));
    } catch {
      continue;
    }
    for (const file of entries.filter((entry) => entry.endsWith(".json")).sort().slice(0, MAX_MANIFESTS_PER_ROOT)) {
      const manifest = readManifest(import_node_path10.default.join(root, CUSTOM_TOOLS_DIR_NAME, file), log);
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
  return loadCustomTools(workspaceRoots, log, options).filter((tool) => tool.enabled);
}

function findCustomTool(workspaceRoots, name, log, options = {}) {
  return listEnabledCustomTools(workspaceRoots, log, options).find((tool) => tool.name === name);
}

function toStatusEntries(tools) {
  return tools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, enabled: tool.enabled, source: tool.skillDir ? "skill" : "manifest" }));
}

function customToolsFingerprint(tools) {
  return tools.map((tool) => `${tool.name}:${tool.enabled ? "1" : "0"}`).sort().join(",");
}

export { MAX_MANIFESTS_PER_ROOT, customToolsFingerprint, findCustomTool, import_node_fs6, import_node_path10, listEnabledCustomTools, loadCustomTools, toStatusEntries };
export { CUSTOM_TOOL_OUTPUT_SCHEMA, CUSTOM_TOOLS_DIR_NAME } from './custom-tool-contract.js';
export { executeCustomTool } from './custom-tool-sandbox.js';
