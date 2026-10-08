// EXTRACTED from src/explicit-folder-target.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var import_promises13 = require("node:fs/promises");
var import_node_os10 = require("node:os");
var import_node_path31 = __toESM(require("node:path"), 1);
var CHAT_ACTIVE_FOLDER_METADATA_KEY = "shuncodeActiveFolderRoot";
async function retainedFolderTarget(history, ownerId) {
  for (let index = history.length - 1; index >= 0; index--) {
    const entry = history[index];
    const metadata = entry?.result?.metadata;
    if (metadata?.shuncode !== true || metadata.shuncodeChatTaskOwnerId !== ownerId) continue;
    const candidate = metadata[CHAT_ACTIVE_FOLDER_METADATA_KEY];
    if (typeof candidate !== "string" || !import_node_path31.default.isAbsolute(candidate)) continue;
    try {
      const folder = await (0, import_promises13.realpath)(candidate);
      if ((await (0, import_promises13.stat)(folder)).isDirectory()) return folder;
    } catch {
    }
    return void 0;
  }
  return void 0;
}
function requestsOpenWorkspace(prompt) {
  return /(?:回到|返回|切回|改回|退回)(?:当前|原来|打开的)?工作区|(?:back|switch|return)\s+to\s+(?:the\s+)?(?:open\s+)?workspace/i.test(prompt);
}
var quotedPath = /[`"“‘]([^`"”’\r\n]{1,1024})[`"”’]/g;
var barePath = /(?:^|[\s(（:：])((?:[A-Za-z]:[\\/]|\/(?!\/)|~[\\/]|\.{1,2}[\\/]|\\\\[^\\\s]+\\[^\\\s]+\\)[^\s,，。;；)）`"“’]{0,1024})/gm;
function localPath(value, workspaceRoot3) {
  const raw = value.trim().replace(/[,.，。;；:：)）]+$/, "");
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return import_node_path31.default.resolve((0, import_node_os10.homedir)(), raw.slice(2));
  if (import_node_path31.default.isAbsolute(raw)) return import_node_path31.default.resolve(raw);
  if (/^\.{1,2}[\\/]/.test(raw)) return import_node_path31.default.resolve(workspaceRoot3, raw);
  return void 0;
}
async function explicitFolderTargets(prompt, workspaceRoot3) {
  const text2 = prompt.replace(/```[\s\S]*?```/g, "");
  const candidates = [
    ...Array.from(text2.matchAll(quotedPath), (match) => [match[1]]),
    // Bare paths can contain spaces. Try the longest existing prefix first;
    // trailing prose must not become part of a selected folder.
    ...Array.from(text2.matchAll(barePath), (match) => {
      const tail = text2.slice((match.index ?? 0) + match[0].length).match(/^(?:[ \t]+[^\s,，。;；)）`"“’]{1,120}){1,4}/)?.[0] ?? "";
      const words = `${match[1]}${tail}`.trim().split(/[ \t]+/);
      return words.map((_, index) => words.slice(0, words.length - index).join(" "));
    })
  ];
  const roots2 = [];
  for (const alternatives of candidates.slice(0, 12)) {
    for (const candidate of alternatives) {
      const requested = localPath(candidate, workspaceRoot3);
      if (!requested) continue;
      let folder = requested;
      try {
        const info = await (0, import_promises13.stat)(requested);
        if (info.isFile()) folder = import_node_path31.default.dirname(requested);
        else if (!info.isDirectory()) continue;
      } catch (error2) {
        if (error2.code !== "ENOENT") continue;
        if (!import_node_path31.default.extname(requested) || /\s/.test(import_node_path31.default.extname(requested))) continue;
        folder = import_node_path31.default.dirname(requested);
        try {
          if (!(await (0, import_promises13.stat)(folder)).isDirectory()) continue;
        } catch {
          continue;
        }
      }
      try {
        const canonical2 = await (0, import_promises13.realpath)(folder);
        if (!roots2.includes(canonical2)) roots2.push(canonical2);
        break;
      } catch {
      }
    }
    if (roots2.length >= 4) break;
  }
  return roots2;
}
