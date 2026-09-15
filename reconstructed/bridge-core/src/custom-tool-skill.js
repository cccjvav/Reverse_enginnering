// RECONSTRUCTED from src/custom-tool-skill.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.
import { DEFAULT_TIMEOUT_MS, MAX_DESCRIPTION_LENGTH, MAX_TIMEOUT_MS, MIN_DESCRIPTION_LENGTH, MIN_TIMEOUT_MS, RESERVED_TOOL_NAMES, SKILLS_DIR_NAME, TOOL_NAME_PATTERN, isRecord } from './custom-tool-contract.js';

import * as import_node_fs4 from "node:fs";

import * as import_node_path8 from "node:path";

var MAX_SKILLS_PER_ROOT = 32;

var MAX_SKILL_BYTES = 65536;

var SKILL_ENTRY_CANDIDATES = [
  "scripts/run.mjs",
  "scripts/run.js",
  "scripts/run.cjs",
  "scripts/run.ps1",
  "scripts/run.cmd",
  "scripts/run.bat",
  "scripts/run.py",
  "scripts/run.sh",
  "run.mjs",
  "run.js",
  "run.cjs",
  "run.ps1",
  "run.cmd",
  "run.bat",
  "run.py",
  "run.sh"
];

var SKILL_SIDECAR_FILE = "skill-tool.json";

var SKILL_LOAD_REASONS = {
  "skills-disabled": "Skill \u603B\u5F00\u5173\u5DF2\u5173\u95ED\u3002",
  "no-skill-md": "\u76EE\u5F55\u4E0B\u7F3A\u5C11 SKILL.md\u3002",
  "skill-md-too-large": `SKILL.md \u8D85\u8FC7 ${MAX_SKILL_BYTES / 1024}KB \u4E0A\u9650\u3002`,
  "invalid-frontmatter": "SKILL.md \u7684 frontmatter \u4E0D\u5B8C\u6574\u3002",
  "invalid-name": "Skill \u540D\u79F0\u4E0D\u5408\u6CD5\u3002",
  "reserved-name": "Skill \u540D\u79F0\u4E0E\u5185\u7F6E\u5DE5\u5177\u91CD\u540D\u3002",
  "description-too-short": `Skill \u63CF\u8FF0\u4E0D\u8DB3 ${MIN_DESCRIPTION_LENGTH} \u5B57\u3002`,
  "entry-configured-missing": "SKILL.md \u91CC\u58F0\u660E\u7684 entry \u6587\u4EF6\u4E0D\u5B58\u5728\u3002",
  "entry-missing": "\u7F3A\u5C11\u53EF\u6267\u884C\u5165\u53E3\u811A\u672C\u3002",
  "entry-escapes-workspace": "entry \u6307\u5411\u4E86\u5DE5\u4F5C\u533A\u4E4B\u5916\u7684\u8DEF\u5F84\u3002",
  "entry-unsupported": "\u5165\u53E3\u811A\u672C\u6269\u5C55\u540D\u4E0D\u53D7\u652F\u6301\u3002",
  "over-cap": `\u5355\u4E2A\u5DE5\u4F5C\u533A\u6700\u591A\u52A0\u8F7D ${MAX_SKILLS_PER_ROOT} \u4E2A Skill\uFF0C\u8D85\u51FA\u7684\u4E0D\u4F1A\u52A0\u8F7D\u3002`,
  "duplicate-name": "\u8BE5\u540D\u79F0\u5DF2\u88AB\u540C\u76EE\u5F55\u7684 JSON \u5DE5\u5177\u5360\u7528\u3002"
};

var SKILL_LOAD_FIXES = {
  "skills-disabled": "enable-skills",
  "no-skill-md": "open-folder",
  "skill-md-too-large": "open-skill-md",
  "invalid-frontmatter": "open-skill-md",
  "invalid-name": "open-folder",
  "reserved-name": "open-folder",
  "description-too-short": "open-skill-md",
  "entry-configured-missing": "open-skill-md",
  "entry-missing": "generate-runner",
  "entry-escapes-workspace": "open-skill-md",
  "entry-unsupported": "open-skill-md",
  "over-cap": "open-folder",
  "duplicate-name": "open-folder"
};

function failSkill(dirName, reasonCode) {
  return {
    dirName,
    loaded: false,
    reasonCode,
    reason: SKILL_LOAD_REASONS[reasonCode] ?? "\u52A0\u8F7D\u5931\u8D25\uFF0C\u539F\u56E0\u672A\u77E5\u3002",
    fix: SKILL_LOAD_FIXES[reasonCode] ?? "open-folder"
  };
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value.charAt(0);
    const last = value.charAt(value.length - 1);
    if (first === '"' && last === '"' || first === "'" && last === "'") return value.slice(1, -1);
  }
  return value;
}

function parseFrontmatter(raw) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return void 0;
  const frontmatter = {};
  let pendingKey;
  let pendingFold;
  const pendingLines = [];
  const flush = () => {
    if (pendingKey === void 0 || pendingFold === void 0) return;
    frontmatter[pendingKey] = pendingLines.join(pendingFold === "space" ? " " : "\n").trim();
    pendingKey = void 0;
    pendingFold = void 0;
    pendingLines.length = 0;
  };
  let bodyStart = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "---") {
      bodyStart = index + 1;
      break;
    }
    if (pendingKey !== void 0 && /^\s/.test(line)) {
      if (line.trim()) pendingLines.push(line.trim());
      continue;
    }
    flush();
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    const key = match?.[1];
    if (!match || key === void 0) continue;
    const value = (match[2] ?? "").trim();
    if (value === ">" || value === ">-" || value === ">+") {
      pendingKey = key;
      pendingFold = "space";
      continue;
    }
    if (value === "|" || value === "|-" || value === "|+") {
      pendingKey = key;
      pendingFold = "newline";
      continue;
    }
    frontmatter[key] = unquote(value);
  }
  if (bodyStart < 0) return void 0;
  flush();
  return { frontmatter, body: lines.slice(bodyStart).join("\n") };
}

function parseSkillDocument(raw) {
  const normalized = raw.replace(/\r\n/g, "\n");
  const parsed = parseFrontmatter(normalized);
  if (parsed) return parsed;
  if (normalized.split("\n")[0]?.trim() === "---") return void 0;
  return { frontmatter: {}, body: normalized };
}

function buildDescription(frontmatter, body) {
  const parts = [];
  if (frontmatter.description?.trim()) parts.push(frontmatter.description.trim());
  if (parts.join("\n\n").length < MIN_DESCRIPTION_LENGTH) for (const paragraph of body.split(/\n\s*\n/)) {
    const text = paragraph.replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
    if (parts.join("\n\n").length >= MIN_DESCRIPTION_LENGTH) break;
  }
  const combined = parts.join("\n\n");
  if (combined.length < MIN_DESCRIPTION_LENGTH) return void 0;
  return combined.slice(0, MAX_DESCRIPTION_LENGTH);
}

function readSidecar(skillDir, label, log) {
  const file = import_node_path8.default.join(skillDir, SKILL_SIDECAR_FILE);
  if (!(0, import_node_fs4.existsSync)(file)) return {};
  let value;
  try {
    value = JSON.parse((0, import_node_fs4.readFileSync)(file, "utf8"));
  } catch {
    log?.(`[custom-tools] skill ${label} sidecar is not valid JSON; ignoring.`);
    return {};
  }
  if (!isRecord(value)) {
    log?.(`[custom-tools] skill ${label} sidecar is not an object; ignoring.`);
    return {};
  }
  const result = {};
  if (value.inputSchema !== void 0) {
    if (isRecord(value.inputSchema) && value.inputSchema.type === "object") result.inputSchema = value.inputSchema;
    else log?.(`[custom-tools] skill ${label} sidecar has an invalid inputSchema; ignoring.`);
  }
  if (value.timeout_ms !== void 0) {
    if (typeof value.timeout_ms === "number" && Number.isInteger(value.timeout_ms) && value.timeout_ms >= MIN_TIMEOUT_MS && value.timeout_ms <= MAX_TIMEOUT_MS) result.timeoutMs = value.timeout_ms;
    else log?.(`[custom-tools] skill ${label} sidecar has an invalid timeout_ms; ignoring.`);
  }
  if (value.enabled !== void 0) {
    if (typeof value.enabled === "boolean") result.enabled = value.enabled;
    else log?.(`[custom-tools] skill ${label} sidecar has an invalid enabled flag; ignoring.`);
  }
  return result;
}

function findSkillEntryScript(skillDir, configured) {
  const candidates = configured ? [configured] : [...SKILL_ENTRY_CANDIDATES];
  for (const rel of candidates) {
    if (!rel || import_node_path8.default.isAbsolute(rel) || import_node_path8.default.normalize(rel).split(import_node_path8.default.sep).includes("..")) continue;
    const abs = import_node_path8.default.join(skillDir, rel);
    try {
      if ((0, import_node_fs4.statSync)(abs).isFile()) return abs;
    } catch {
    }
  }
  return void 0;
}

function entryCommand(root, skillDir, label, configured, log, collect) {
  const script = findSkillEntryScript(skillDir, configured);
  if (!script) {
    log?.(configured ? `[custom-tools] skill ${label} entry not found: ${configured}; skipping.` : `[custom-tools] skill ${label} has no supported entry script; skipping.`);
    collect?.(configured ? "entry-configured-missing" : "entry-missing");
    return void 0;
  }
  const rel = import_node_path8.default.relative(root, script);
  if (!rel || rel.startsWith("..") || import_node_path8.default.isAbsolute(rel)) {
    log?.(`[custom-tools] skill ${label} entry escapes the workspace; skipping.`);
    collect?.("entry-escapes-workspace");
    return void 0;
  }
  const lower = script.toLowerCase();
  if (/\.(mjs|js|cjs)$/.test(lower)) return ["node", rel];
  if (lower.endsWith(".ps1")) return ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", rel];
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) return ["cmd.exe", "/d", "/s", "/c", rel];
  if (lower.endsWith(".py")) return ["py.exe", rel];
  if (lower.endsWith(".sh")) return ["bash.exe", rel];
  log?.(`[custom-tools] skill ${label} entry has an unsupported extension: ${rel}; skipping.`);
  collect?.("entry-unsupported");
  return void 0;
}

function readSkillManifest(root, skillDir, dirName, log, collect) {
  const label = `${SKILLS_DIR_NAME}/${dirName}`;
  const sourcePath = import_node_path8.default.join(skillDir, "SKILL.md");
  let raw;
  try {
    raw = (0, import_node_fs4.readFileSync)(sourcePath, "utf8");
  } catch {
    log?.(`[custom-tools] skill ${label} has no SKILL.md; skipping.`);
    collect?.("no-skill-md");
    return void 0;
  }
  if (raw.length > MAX_SKILL_BYTES) {
    log?.(`[custom-tools] skill ${label} SKILL.md is too large; skipping.`);
    collect?.("skill-md-too-large");
    return void 0;
  }
  const parsed = parseSkillDocument(raw);
  if (!parsed) {
    log?.(`[custom-tools] skill ${label} SKILL.md has invalid frontmatter; skipping.`);
    collect?.("invalid-frontmatter");
    return void 0;
  }
  const rawName = (parsed.frontmatter.name ?? dirName).trim();
  const name = rawName.replace(/-/g, "_");
  if (!TOOL_NAME_PATTERN.test(name)) {
    log?.(`[custom-tools] skill ${label} has an invalid tool name: ${rawName}; skipping.`);
    collect?.("invalid-name");
    return void 0;
  }
  if (RESERVED_TOOL_NAMES.has(name)) {
    log?.(`[custom-tools] skill ${label} shadows a built-in tool: ${name}; skipping.`);
    collect?.("reserved-name");
    return void 0;
  }
  const description = buildDescription(parsed.frontmatter, parsed.body);
  if (!description) {
    log?.(`[custom-tools] skill ${label} description is too short; skipping.`);
    collect?.("description-too-short");
    return void 0;
  }
  const command = entryCommand(root, skillDir, label, parsed.frontmatter.entry?.trim() || void 0, log, collect);
  if (!command) return void 0;
  const sidecar = readSidecar(skillDir, label, log);
  return {
    name,
    title: (parsed.frontmatter.title ?? name).trim().slice(0, 80) || name,
    description,
    inputSchema: sidecar.inputSchema ?? { type: "object", properties: {}, additionalProperties: true },
    command,
    timeoutMs: sidecar.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    enabled: sidecar.enabled ?? true,
    sourcePath,
    skillDir
  };
}

function loadSkillTools(root, log) {
  const result = [];
  let entries;
  const skillsRoot = import_node_path8.default.join(root, SKILLS_DIR_NAME);
  try {
    entries = (0, import_node_fs4.readdirSync)(skillsRoot);
  } catch {
    return result;
  }
  const skillDirs = entries.filter((entry) => !entry.startsWith(".")).filter((entry) => {
    try {
      return (0, import_node_fs4.statSync)(import_node_path8.default.join(skillsRoot, entry)).isDirectory();
    } catch {
      return false;
    }
  }).sort().slice(0, MAX_SKILLS_PER_ROOT);
  for (const dir of skillDirs) {
    const skillDir = import_node_path8.default.join(skillsRoot, dir);
    const manifest = readSkillManifest(root, skillDir, dir, log);
    if (manifest) result.push(manifest);
  }
  return result;
}

function resolveSkillDir(root, name) {
  const skillsRoot = import_node_path8.default.join(root, SKILLS_DIR_NAME);
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed === "." || trimmed === "..") return void 0;
  const direct = import_node_path8.default.join(skillsRoot, trimmed);
  try {
    if ((0, import_node_fs4.statSync)(direct).isDirectory()) return direct;
  } catch {
  }
  const wanted = trimmed.replace(/-/g, "_");
  let entries;
  try {
    entries = (0, import_node_fs4.readdirSync)(skillsRoot);
  } catch {
    return void 0;
  }
  for (const entry of entries) {
    if (entry.replace(/-/g, "_") !== wanted) continue;
    const full = import_node_path8.default.join(skillsRoot, entry);
    try {
      if ((0, import_node_fs4.statSync)(full).isDirectory()) return full;
    } catch {
    }
  }
  return void 0;
}

function diagnoseSkillTools(root, log, options = {}) {
  const skillsRoot = import_node_path8.default.join(root, SKILLS_DIR_NAME);
  let entries;
  try {
    entries = (0, import_node_fs4.readdirSync)(skillsRoot);
  } catch {
    return [];
  }
  const skillDirs = entries.filter((entry) => !entry.startsWith(".")).filter((entry) => {
    try {
      return (0, import_node_fs4.statSync)(import_node_path8.default.join(skillsRoot, entry)).isDirectory();
    } catch {
      return false;
    }
  }).sort();
  return skillDirs.map((dir, index) => {
    if (options.skillsEnabled === false) return failSkill(dir, "skills-disabled");
    if (index >= MAX_SKILLS_PER_ROOT) return failSkill(dir, "over-cap");
    let code;
    const manifest = readSkillManifest(root, import_node_path8.default.join(skillsRoot, dir), dir, log, (found) => {
      if (code === void 0) code = found;
    });
    if (manifest) return { dirName: dir, loaded: true, name: manifest.name };
    return failSkill(dir, code ?? "unknown");
  });
}

export { MAX_SKILLS_PER_ROOT, MAX_SKILL_BYTES, SKILL_ENTRY_CANDIDATES, SKILL_LOAD_FIXES, SKILL_LOAD_REASONS, SKILL_SIDECAR_FILE, buildDescription, diagnoseSkillTools, entryCommand, failSkill, findSkillEntryScript, import_node_fs4, import_node_path8, loadSkillTools, parseFrontmatter, parseSkillDocument, readSidecar, readSkillManifest, resolveSkillDir, unquote };
