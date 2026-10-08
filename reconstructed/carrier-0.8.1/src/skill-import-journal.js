// EXTRACTED from src/skill-import-journal.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var import_node_crypto6 = require("node:crypto");
var import_node_fs9 = require("node:fs");
var import_node_os = require("node:os");
var import_node_path14 = __toESM(require("node:path"), 1);
var IMPORT_JOURNAL_DIR = ".shuncode-import-journal";
var IMPORTING_MARKER = ".shuncode-importing";
var STAGING_OWNER_FILE = ".shuncode-staging.json";
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var journalFile = (directory, id) => import_node_path14.default.join(directory, IMPORT_JOURNAL_DIR, `${id}.json`);
function writeAtomic(file, value) {
  const temporary = `${file}.${(0, import_node_crypto6.randomUUID)()}.tmp`;
  try {
    (0, import_node_fs9.writeFileSync)(temporary, JSON.stringify(value) + "\n", { flag: "wx", mode: 384 });
    renameWithRetry(temporary, file);
  } finally {
    (0, import_node_fs9.rmSync)(temporary, { force: true });
  }
}
function writeImportJournal(directory, journal) {
  for (let attempt = 0; ; attempt++) {
    (0, import_node_fs9.mkdirSync)(import_node_path14.default.join(directory, IMPORT_JOURNAL_DIR), { recursive: true, mode: 448 });
    try {
      writeAtomic(journalFile(directory, journal.id), journal);
      return;
    } catch (error2) {
      if (error2.code !== "ENOENT" || attempt > 0) throw error2;
    }
  }
}
function removeImportJournal(directory, id) {
  (0, import_node_fs9.rmSync)(journalFile(directory, id), { force: true });
  try {
    (0, import_node_fs9.rmdirSync)(import_node_path14.default.join(directory, IMPORT_JOURNAL_DIR));
  } catch {
  }
}
function readImportJournals(directory) {
  const folder = import_node_path14.default.join(directory, IMPORT_JOURNAL_DIR);
  if (!(0, import_node_fs9.existsSync)(folder)) return [];
  const journals = [];
  for (const name of (0, import_node_fs9.readdirSync)(folder)) {
    if (!name.endsWith(".json")) continue;
    try {
      const value = JSON.parse((0, import_node_fs9.readFileSync)(import_node_path14.default.join(folder, name), "utf8"));
      if (value?.version !== 1 || !UUID.test(value.id) || name !== `${value.id}.json`) continue;
      const child = (file, pattern) => typeof file === "string" && import_node_path14.default.dirname(file) === directory && pattern.test(import_node_path14.default.basename(file));
      if (!child(value.target, /^[^.][^/\\]*$/) || !child(value.staging, /^\.import-/) || value.backup !== void 0 && value.backup !== import_node_path14.default.join(directory, `.backup-${value.id}`)) continue;
      if (!["reserved", "backup", "moved", "committed"].includes(value.stage)) continue;
      journals.push(value);
    } catch {
    }
  }
  return journals;
}
function markerOwnedBy(directory, id) {
  try {
    return (0, import_node_fs9.readFileSync)(import_node_path14.default.join(directory, IMPORTING_MARKER), "utf8").trim().split(/\s+/).includes(id);
  } catch {
    return false;
  }
}
function settleImportJournal(journal) {
  const directory = import_node_path14.default.dirname(journal.target);
  const ours = markerOwnedBy(journal.target, journal.id);
  let outcome;
  if (journal.stage === "moved" || journal.stage === "committed") {
    if (ours) (0, import_node_fs9.rmSync)(import_node_path14.default.join(journal.target, IMPORTING_MARKER), { force: true });
    if (journal.backup) removeTree(journal.backup);
    outcome = "rolled-forward";
  } else {
    if (ours) removeTree(journal.target);
    if (journal.backup && (0, import_node_fs9.existsSync)(journal.backup) && !(0, import_node_fs9.existsSync)(journal.target)) renameWithRetry(journal.backup, journal.target);
    outcome = "rolled-back";
  }
  removeTree(journal.staging);
  removeImportJournal(directory, journal.id);
  return outcome;
}
function writeStagingOwner(staging) {
  (0, import_node_fs9.writeFileSync)(import_node_path14.default.join(staging, STAGING_OWNER_FILE), JSON.stringify({ pid: process.pid, host: (0, import_node_os.hostname)(), createdAt: Date.now() }) + "\n", { flag: "wx", mode: 384 });
}
function readStagingOwner(staging) {
  try {
    const value = JSON.parse((0, import_node_fs9.readFileSync)(import_node_path14.default.join(staging, STAGING_OWNER_FILE), "utf8"));
    return Number.isInteger(value?.pid) && typeof value.host === "string" && Number.isFinite(value.createdAt) ? value : void 0;
  } catch {
    return void 0;
  }
}
function commitStagedSkill(directory, name, prepared, staging, options) {
  const id = (0, import_node_crypto6.randomUUID)();
  const target = import_node_path14.default.join(directory, name);
  if (import_node_path14.default.dirname(target) !== directory || name.startsWith(".")) throw new Error("Skill \u76EE\u6807\u8DEF\u5F84\u65E0\u6548\uFF1B\u672A\u5199\u5165\u3002");
  let journal = { version: 1, id, pid: process.pid, host: (0, import_node_os.hostname)(), name, target, staging, stage: "reserved", updatedAt: Date.now() };
  const record4 = (stage, extra = {}) => {
    journal = { ...journal, ...extra, stage, updatedAt: Date.now() };
    writeImportJournal(directory, journal);
    options.hook?.(stage);
  };
  if ((0, import_node_fs9.existsSync)(import_node_path14.default.join(prepared, IMPORTING_MARKER))) throw new Error(`Skill \u4F7F\u7528\u4E86\u4FDD\u7559\u6587\u4EF6\u540D ${IMPORTING_MARKER}\u3002`);
  (0, import_node_fs9.writeFileSync)(import_node_path14.default.join(prepared, IMPORTING_MARKER), `global-skills-v1 ${id}
`, { flag: "wx", mode: 384 });
  try {
    record4("reserved");
    if (options.replace) {
      record4("backup", { backup: import_node_path14.default.join(directory, `.backup-${id}`) });
      renameWithRetry(target, journal.backup);
      options.hook?.("backup-moved");
    } else if ((0, import_node_fs9.existsSync)(target)) {
      throw new Error(`\u5168\u5C40 Skill \u201C${name}\u201D \u5DF2\u5B58\u5728\uFF08\u53EF\u80FD\u662F\u53E6\u4E00\u7A97\u53E3\u521A\u5BFC\u5165\uFF09\u3002\u672A\u8986\u76D6\uFF0C\u8BF7\u5237\u65B0\u540E\u518D\u8BD5\u3002`);
    }
    renameWithRetry(prepared, target);
    options.hook?.("renamed");
    options.verify(target);
    record4("moved");
    (0, import_node_fs9.rmSync)(import_node_path14.default.join(target, IMPORTING_MARKER));
    record4("committed");
  } catch (error2) {
    const outcome = settleImportJournal(journal);
    if (outcome === "rolled-back") throw describeLockedSkill(error2, name, options.replace);
    return target;
  }
  if (journal.backup) removeTree(journal.backup);
  removeImportJournal(directory, id);
  return target;
}
