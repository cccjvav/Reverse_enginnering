// EXTRACTED from src/skill-archive.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var workerFile;
function configureSkillArchiveWorker(file) {
  workerFile = file;
}
var DIRECTORY_SOURCE_MESSAGE = "Skill \u4E0D\u5408\u89C4\uFF1A\u6240\u9009\u6587\u4EF6\u5939\u6839\u76EE\u5F55\u5FC5\u987B\u5305\u542B skill.md\uFF08\u517C\u5BB9 SKILL.md\uFF09\u6587\u4EF6\u3002\u8BF7\u8FDB\u5165\u5177\u4F53 Skill \u6587\u4EF6\u5939\u540E\u70B9\u51FB\u53F3\u4E0B\u89D2\u201C\u9009\u62E9\u6B64\u6587\u4EF6\u5939\u201D\u76F4\u63A5\u5BFC\u5165\uFF0C\u4E0D\u8981\u9009\u62E9\u5916\u5C42\u7236\u76EE\u5F55\u3002";
function assertSkillDirectorySource(directory) {
  const markdown = skillMarkdownName(directory);
  if (!markdown) throw new Error(DIRECTORY_SOURCE_MESSAGE);
  return markdown;
}
function admitSkillArchive(file) {
  const info = (0, import_node_fs7.lstatSync)(file);
  if (info.isSymbolicLink()) throw new SkillArchiveError("unsafe-path", "\u8BF7\u9009\u62E9\u5B9E\u9645\u7684 Skill \u538B\u7F29\u5305\uFF0C\u4E0D\u652F\u6301\u7B26\u53F7\u94FE\u63A5\u3002");
  if (info.isDirectory()) throw new SkillArchiveError("repack-required", DIRECTORY_SOURCE_MESSAGE);
  if (!info.isFile()) throw new SkillArchiveError("repack-required", "\u8BF7\u9009\u62E9\u4E00\u4E2A Skill \u538B\u7F29\u5305\u6587\u4EF6\u3002");
  const kind = archiveKindFromName(file);
  if (!kind) throw new SkillArchiveError("repack-required", unsupportedArchiveMessage(file));
  if (info.size > SKILL_ARCHIVE_MAX_BYTES) throw new SkillArchiveError("too-large", SKILL_ARCHIVE_TOO_LARGE_HINT);
  return kind;
}
async function extractSkillArchive(file, destination, options = {}) {
  admitSkillArchive(file);
  const script = workerFile;
  if (!script || !(0, import_node_fs7.existsSync)(script)) throw new SkillArchiveError("worker", "Skill \u89E3\u538B\u7EC4\u4EF6\u7F3A\u5931\uFF0C\u8BF7\u91CD\u65B0\u5B89\u88C5 ShunCode \u540E\u518D\u5BFC\u5165\u3002");
  const timeoutMs = options.timeoutMs ?? Math.max(SKILL_ARCHIVE_TIMEOUT_MS, SKILL_ARCHIVE_TIMEOUT_MS + Math.ceil((0, import_node_fs7.lstatSync)(file).size / (4 * 1024 * 1024)) * 1e3);
  const job = { file, destination };
  const worker = new import_node_worker_threads.Worker(script, { workerData: job, resourceLimits: { maxOldGenerationSizeMb: 256 } });
  const result = await new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void worker.terminate().finally(() => reject(new SkillArchiveError("timeout", `\u89E3\u538B\u8D85\u8FC7 ${Math.max(1, Math.round(timeoutMs / 1e3))} \u79D2\uFF0C\u5DF2\u7EC8\u6B62\u3002\u8BF7\u786E\u8BA4\u538B\u7F29\u5305\u6CA1\u6709\u635F\u574F\u540E\u91CD\u8BD5\u3002`)));
    }, timeoutMs);
    worker.once("message", (message2) => {
      clearTimeout(timer);
      resolve(message2);
    });
    worker.once("error", (error2) => {
      clearTimeout(timer);
      if (!timedOut) reject(new SkillArchiveError("worker", `\u89E3\u538B\u7EC4\u4EF6\u51FA\u9519\uFF1A${error2.message}`));
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (!timedOut) reject(new SkillArchiveError("worker", `\u89E3\u538B\u7EC4\u4EF6\u610F\u5916\u9000\u51FA\uFF08${code}\uFF09\u3002`));
    });
  }).finally(() => worker.terminate());
  if (!result.ok) throw new SkillArchiveError(result.code, result.message);
  return { kind: result.kind, digest: result.digest, entries: result.entries, bytes: result.bytes };
}
function skillFilesBelow(base, depth, prefix = "") {
  if (depth < 0) return [];
  const found = [];
  for (const entry of (0, import_node_fs7.readdirSync)(import_node_path13.default.join(base, prefix), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "__MACOSX") continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile() && /^skill\.md$/i.test(entry.name)) found.push(relative);
    else if (entry.isDirectory()) found.push(...skillFilesBelow(base, depth - 1, relative));
  }
  return found;
}
function normalizedSkillRoot(root) {
  const marker = skillMarkdownName(root);
  if (marker && marker !== "SKILL.md") (0, import_node_fs7.renameSync)(import_node_path13.default.join(root, marker), import_node_path13.default.join(root, "SKILL.md"));
  return root;
}
function locateUniqueSkillRoot(base) {
  if (skillMarkdownName(base)) return normalizedSkillRoot(base);
  const folders = (0, import_node_fs7.readdirSync)(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "__MACOSX");
  const holders = folders.filter((entry) => skillMarkdownName(import_node_path13.default.join(base, entry.name)) !== void 0);
  if (folders.length === 1 && holders.length === 1) return normalizedSkillRoot(import_node_path13.default.join(base, holders[0].name));
  const layout = "\u6B63\u786E\u7ED3\u6784\uFF1ASKILL.md \u5728\u5305\u7684\u6839\u76EE\u5F55\uFF0C\u6216\u5728\u552F\u4E00\u7684\u9876\u5C42\u6587\u4EF6\u5939\u91CC\uFF08\u4F8B\u5982 my-skill/SKILL.md\uFF0C\u65C1\u8FB9\u53EF\u653E scripts/\u3001references/\u3001assets/\uFF09\u3002";
  if (holders.length > 1) throw new SkillArchiveError("skill-root", `\u538B\u7F29\u5305\u91CC\u6709\u591A\u4E2A Skill\uFF08${holders.slice(0, 3).map((entry) => entry.name).join("\u3001")}${holders.length > 3 ? "\u2026" : ""}\uFF09\uFF0C\u4E00\u6B21\u53EA\u80FD\u5BFC\u5165\u4E00\u4E2A\u3002${layout}`);
  if (holders.length === 1) throw new SkillArchiveError("skill-root", `\u538B\u7F29\u5305\u9876\u5C42\u9664 ${holders[0].name}/ \u5916\u8FD8\u6709\u5176\u4ED6\u6587\u4EF6\u5939\uFF0C\u770B\u8D77\u6765\u6DF7\u5165\u4E86\u6574\u4E2A\u9879\u76EE\u3002\u8BF7\u53EA\u6253\u5305 Skill \u6587\u4EF6\u5939\u672C\u8EAB\u3002${layout}`);
  const deeper = skillFilesBelow(base, 4);
  if (deeper.length) throw new SkillArchiveError("skill-root", `SKILL.md \u7684\u4F4D\u7F6E\u8FC7\u6DF1\uFF08${deeper[0]}\uFF09\u3002${layout}`);
  throw new SkillArchiveError("skill-root", `\u538B\u7F29\u5305\u91CC\u6CA1\u6709 SKILL.md\u3002${layout}`);
}
function assertSkillTargetPaths(prepared, target, platform = process.platform) {
  if (platform !== "win32") return;
  const join = (...parts) => parts.join("\\");
  const walk = (relative) => {
    for (const entry of (0, import_node_fs7.readdirSync)(import_node_path13.default.join(prepared, ...relative), { withFileTypes: true })) {
      const child = [...relative, entry.name];
      if (windowsPathTooLong(join(target, ...child))) {
        throw new SkillArchiveError("unsafe-path", `\u5B89\u88C5\u540E\u7684\u8DEF\u5F84\u8D85\u8FC7 Windows \u7684 ${SKILL_ARCHIVE_MAX_WINDOWS_PATH + 1} \u4E2A\u5B57\u7B26\u4E0A\u9650\uFF1A${child.join("/")}\u3002\u8BF7\u7F29\u77ED Skill \u540D\u79F0\u3001\u76EE\u5F55\u5C42\u7EA7\u6216\u6587\u4EF6\u540D\u540E\u91CD\u65B0\u6253\u5305\uFF0C\u6216\u628A\u5168\u5C40 Skill \u76EE\u5F55\u6362\u5230\u66F4\u77ED\u7684\u4F4D\u7F6E\u3002`);
      }
      if (entry.isDirectory()) walk(child);
    }
  };
  walk([]);
}
async function copySkillDirectory(source, destination) {
  const markdown = assertSkillDirectorySource(source);
  await assertSafeSkillTreeAsync(source);
  const hash2 = (0, import_node_crypto5.createHash)("sha256");
  let entries = 0, bytes = 0;
  await (0, import_promises9.cp)(source, destination, {
    recursive: true,
    errorOnExist: false,
    force: false,
    verbatimSymlinks: true,
    // destination is a fresh, empty staging dir
    filter: async (from) => {
      const relative = import_node_path13.default.relative(source, from);
      if (relative && isJunkArchiveEntry(relative.split(import_node_path13.default.sep))) return false;
      const info = await (0, import_promises9.lstat)(from);
      if (info.isSymbolicLink()) throw new SkillArchiveError("link-or-special", "Skill \u4E0D\u5141\u8BB8\u7B26\u53F7\u94FE\u63A5\u6216\u76EE\u5F55\u8054\u63A5\u3002");
      if (info.isFile()) {
        entries++;
        bytes += info.size;
        hash2.update(`${relative}\0${info.size}\0${info.mtimeMs}
`);
      }
      return true;
    }
  });
  if (markdown !== "SKILL.md") await (0, import_promises9.rename)(import_node_path13.default.join(destination, markdown), import_node_path13.default.join(destination, "SKILL.md"));
  return { kind: "directory", digest: hash2.digest("hex"), entries, bytes };
}
