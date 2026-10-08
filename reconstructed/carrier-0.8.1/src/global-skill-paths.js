// EXTRACTED from src/global-skill-paths.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var import_node_path = __toESM(require("node:path"), 1);
var import_node_fs = require("node:fs");
var import_promises = require("node:fs/promises");
var GLOBAL_SKILLS_VERSION = "global-skills-v1";
var directoryProvider;
function configureGlobalSkills(provider) {
  directoryProvider = provider;
}
function globalSkillsDirectory() {
  const directory = directoryProvider?.();
  if (directory !== void 0 && !import_node_path.default.isAbsolute(directory)) throw new Error("\u5168\u5C40 Skill \u76EE\u5F55\u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84\u3002");
  return directory;
}
function defaultGlobalSkillsDirectory(appRoot, user, platform = process.platform, appImage) {
  const p = platform === "win32" ? import_node_path.default.win32 : import_node_path.default.posix;
  let parent;
  if (platform === "linux" && appImage) parent = p.dirname(appImage);
  else if (platform === "darwin" && /\.app(?:\/|$)/i.test(appRoot)) {
    parent = p.dirname(appRoot.slice(0, appRoot.search(/\.app(?:\/|$)/i) + 4));
  } else {
    const normalized = appRoot.replace(/[\\/]+$/, "");
    const install = /[\\/]resources[\\/]app$/i.test(normalized) ? p.dirname(p.dirname(normalized)) : normalized;
    parent = p.dirname(install);
  }
  const safeUser = Buffer.from(user, "utf8").toString("hex");
  return p.join(parent, "ShunCode-Skills", safeUser || "user");
}
var LINK_MESSAGE = "Skill \u4E0D\u5141\u8BB8\u7B26\u53F7\u94FE\u63A5\u3001\u76EE\u5F55\u8054\u63A5\u6216\u8D8A\u754C\u8DEF\u5F84\u3002";
var SPECIAL_MESSAGE = "Skill \u4E0D\u5141\u8BB8\u8BBE\u5907\u3001\u7BA1\u9053\u7B49\u7279\u6B8A\u6587\u4EF6\u3002";
async function assertSafeSkillTreeAsync(directory) {
  let files = 0, bytes = 0;
  const pending = [directory];
  while (pending.length) {
    const dir = pending.pop();
    const info = await (0, import_promises.lstat)(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(LINK_MESSAGE);
    for await (const entry of await (0, import_promises.opendir)(dir)) {
      const full = import_node_path.default.join(dir, entry.name);
      const stat9 = await (0, import_promises.lstat)(full);
      if (stat9.isSymbolicLink()) throw new Error(LINK_MESSAGE);
      if (stat9.isDirectory()) pending.push(full);
      else if (stat9.isFile()) {
        files++;
        bytes += stat9.size;
      } else throw new Error(SPECIAL_MESSAGE);
    }
  }
  return { files, bytes };
}
function isGlobalSkillDirectory(directory) {
  const root = globalSkillsDirectory();
  if (!root || import_node_path.default.dirname(import_node_path.default.resolve(directory)) !== import_node_path.default.resolve(root)) return false;
  try {
    const info = (0, import_node_fs.lstatSync)(directory);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}
