// EXTRACTED from src/skill-fs-retry.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var import_node_fs8 = require("node:fs");
var TRANSIENT_CODES = /* @__PURE__ */ new Set(["EPERM", "EACCES", "EBUSY"]);
var RENAME_RETRY_DELAYS_MS = [25, 50, 100, 175, 400];
var RM_TREE_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };
function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
function isTransientFileError(error2) {
  return TRANSIENT_CODES.has(String(error2?.code ?? ""));
}
function renameWithRetry(from, to, platform = process.platform) {
  for (let attempt = 0; ; attempt++) {
    try {
      (0, import_node_fs8.renameSync)(from, to);
      return;
    } catch (error2) {
      if (platform !== "win32" || !isTransientFileError(error2) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw error2;
      pause(RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}
function removeTree(target) {
  (0, import_node_fs8.rmSync)(target, RM_TREE_OPTIONS);
}
function describeLockedSkill(error2, name, replacing, platform = process.platform) {
  if (platform !== "win32" || !isTransientFileError(error2)) return error2;
  const message2 = replacing ? `\u5168\u5C40 Skill \u201C${name}\u201D \u7684\u6587\u4EF6\u6B63\u5728\u88AB\u4F7F\u7528\uFF08\u53EF\u80FD\u6709\u5DE5\u5177\u6B63\u5728\u8FD0\u884C\uFF0C\u6216\u6587\u4EF6\u88AB\u7F16\u8F91\u5668\u3001\u6740\u6BD2\u8F6F\u4EF6\u6253\u5F00\uFF09\uFF0C\u6682\u65F6\u65E0\u6CD5\u66FF\u6362\u3002\u5DF2\u5B89\u88C5\u7684\u7248\u672C\u4FDD\u6301\u4E0D\u53D8\uFF1B\u8BF7\u5173\u95ED\u76F8\u5173\u7A0B\u5E8F\u540E\u91CD\u8BD5\u3002` : `\u5199\u5165\u5168\u5C40 Skill \u201C${name}\u201D \u65F6\u6587\u4EF6\u88AB\u5360\u7528\uFF08\u53EF\u80FD\u662F\u6740\u6BD2\u8F6F\u4EF6\u6B63\u5728\u626B\u63CF\uFF09\uFF0C\u672A\u5199\u5165\u3002\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002`;
  return Object.assign(new Error(message2), { code: error2.code });
}
