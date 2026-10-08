// EXTRACTED from src/skill-archive-limits.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var SKILL_ARCHIVE_MAX_BYTES = 2 * 1024 * 1024 * 1024 - 1;
var SKILL_ARCHIVE_TOO_LARGE_HINT = "\u538B\u7F29\u5305\u8D85\u8FC7 2 GB\uFF0C\u8D85\u51FA\u5355\u6587\u4EF6\u4E00\u6B21\u8BFB\u5165\u7684\u6280\u672F\u4E0A\u9650\uFF08\u4E0D\u662F Skill \u5927\u5C0F\u9650\u5236\uFF09\u3002\u8BF7\u89E3\u538B\u540E\u76F4\u63A5\u5BFC\u5165 Skill \u6587\u4EF6\u5939\uFF0C\u6587\u4EF6\u5939\u5BFC\u5165\u6CA1\u6709\u5927\u5C0F\u9650\u5236\u3002";
var SKILL_ARCHIVE_ENTRY_RATIO_FLOOR = 1024 * 1024;
var SKILL_ARCHIVE_TOTAL_RATIO_FLOOR = 8 * 1024 * 1024;
var SKILL_ARCHIVE_MAX_WINDOWS_PATH = 259;
function windowsPathTooLong(absolute) {
  return absolute.length > SKILL_ARCHIVE_MAX_WINDOWS_PATH;
}
var SKILL_ARCHIVE_TIMEOUT_MS = 6e4;
var REPACK_HINT = "\u8BF7\u91CD\u65B0\u6253\u5305\u4E3A zip\u3002";
var SkillArchiveError = class extends Error {
  constructor(code, message2) {
    super(message2);
    this.code = code;
    this.name = "SkillArchiveError";
  }
  code;
};
function isJunkArchiveEntry(parts) {
  const last = parts[parts.length - 1] ?? "";
  return parts.includes("__MACOSX") || last.startsWith("._") || [".ds_store", "thumbs.db", "desktop.ini"].includes(last.toLowerCase());
}
