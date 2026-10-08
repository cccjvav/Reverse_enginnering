// EXTRACTED from src/global-skill-import.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var normalizedName = (name) => name.toLowerCase().replace(/-/g, "_");
function targetRevision(target) {
  try {
    const info = (0, import_node_fs11.lstatSync)(target);
    return `${info.ino}:${info.mtimeMs}:${info.isDirectory() ? (0, import_node_fs11.readdirSync)(target).sort().join("/") : "file"}`;
  } catch {
    return "absent";
  }
}
async function prepareGlobalSkillImport(source, options = {}) {
  const origin = options.origin ?? "internal", log = options.log;
  const directory = globalSkillsDirectory();
  if (!directory) throw new Error("\u5C1A\u672A\u914D\u7F6E\u5168\u5C40 Skill \u76EE\u5F55\u3002");
  const info = (0, import_node_fs11.lstatSync)(source);
  if (info.isSymbolicLink()) throw new Error("\u8BF7\u9009\u62E9\u5B9E\u9645\u7684 Skill \u538B\u7F29\u5305\u6216\u76EE\u5F55\uFF0C\u4E0D\u652F\u6301\u7B26\u53F7\u94FE\u63A5\u3002");
  const archive = info.isFile();
  if (archive && /^skill\.md$/i.test(import_node_path16.default.basename(source))) throw new Error(`\u8BF7\u9009\u62E9\u5305\u542B\u8BE5\u6587\u4EF6\u7684 Skill \u6587\u4EF6\u5939\uFF0C\u800C\u4E0D\u662F\u6587\u4EF6\u672C\u8EAB\u3002${DIRECTORY_SOURCE_MESSAGE}`);
  if (info.isDirectory()) {
    assertSkillDirectorySource(source);
    const resolvedSource = (0, import_node_fs11.realpathSync)(source);
    if (import_node_path16.default.resolve(directory) === resolvedSource || import_node_path16.default.resolve(directory).startsWith(resolvedSource + import_node_path16.default.sep)) throw new Error("\u5BFC\u5165\u6E90\u4E0D\u80FD\u5305\u542B\u5168\u5C40\u76EE\u6807\u76EE\u5F55\uFF0C\u8BF7\u9009\u62E9\u5177\u4F53 Skill \u5B50\u6587\u4EF6\u5939\u3002");
  } else if (!archive) throw new Error("\u8BF7\u9009\u62E9\u542B skill.md \u7684 Skill \u6587\u4EF6\u5939\uFF0C\u6216 .zip / .tar.gz \u538B\u7F29\u5305\u3002");
  (0, import_node_fs11.mkdirSync)(directory, { recursive: true, mode: 448 });
  const swept = recoverSkillImports(directory);
  if (swept.rolledBack.length || swept.rolledForward.length || swept.removed.length) log?.(`[global-skills] recovered interrupted imports: ${JSON.stringify(swept)}`);
  const staging = (0, import_node_fs11.mkdtempSync)(import_node_path16.default.join(directory, ".import-"));
  try {
    writeStagingOwner(staging);
    const input = import_node_path16.default.join(staging, "input");
    (0, import_node_fs11.mkdirSync)(input);
    const snapshot = archive ? await extractSkillArchive(source, input, { timeoutMs: options.timeoutMs }) : await copySkillDirectory(source, input);
    const root = locateUniqueSkillRoot(input);
    const directoryName = archive ? void 0 : import_node_path16.default.basename(import_node_path16.default.resolve(source));
    const result = importSkill(import_node_path16.default.join(staging, "prepared"), root, log, { directoryName });
    const staged = (0, import_node_fs11.lstatSync)(result.directory);
    if (!staged.isDirectory() || staged.isSymbolicLink()) throw new Error("Skill \u6682\u5B58\u76EE\u5F55\u5F02\u5E38\u3002");
    const [manifest] = loadSkillTools(import_node_path16.default.join(staging, "prepared"), log);
    if (!manifest) throw new Error("Skill \u672A\u901A\u8FC7\u52A0\u8F7D\u68C0\u67E5\uFF1A\u6839\u76EE\u5F55\u987B\u5305\u542B\u53EF\u8BFB\u53D6\u7684 skill.md\uFF08\u6587\u4EF6\u540D\u4E0D\u533A\u5206\u5927\u5C0F\u5199\uFF09\u3002\u672A\u5199\u5165\u5168\u5C40\u76EE\u5F55\u3002");
    const name = directoryName ?? manifest.name;
    const target = import_node_path16.default.join(directory, name);
    if (import_node_path16.default.dirname(target) !== directory) throw new Error("Skill \u76EE\u6807\u8DEF\u5F84\u65E0\u6548\uFF1B\u672A\u8986\u76D6\u3002");
    assertSkillTargetPaths(result.directory, target);
    const installed = loadGlobalSkills(log, directory);
    const existing = installed.find((tool) => tool.skillDir && import_node_path16.default.resolve(tool.skillDir) === import_node_path16.default.resolve(target));
    const identityClash = installed.find((tool) => tool !== existing && tool.name === manifest.name);
    if (identityClash) throw new Error(`\u5168\u5C40 Skill \u201C${name}\u201D \u7684\u6807\u8BC6\u5DF2\u5B58\u5728\u3002\u672A\u8986\u76D6\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u5939\u540D\u79F0\u6216 skill.md \u7684 name\u3002`);
    const folders = globalSkillFolderNames(directory);
    const clash = folders.find((folder) => normalizedName(folder) === normalizedName(name));
    let mode = "create";
    if (existing || clash) {
      if (!existing?.skillDir || import_node_path16.default.resolve(existing.skillDir) !== import_node_path16.default.resolve(target)) throw new Error(`\u5168\u5C40 Skill \u201C${name}\u201D \u5DF2\u5B58\u5728\u3002\u672A\u8986\u76D6\uFF0C\u8BF7\u4FEE\u6539\u6587\u4EF6\u5939\u540D\u79F0\u540E\u91CD\u65B0\u5BFC\u5165\u3002`);
      mode = "replace";
    }
    return { origin, source, directory, name, mode, target, snapshot, result, staging, prepared: result.directory, targetRevision: targetRevision(target) };
  } catch (error2) {
    removeTree(staging);
    throw error2;
  }
}
function commitGlobalSkillImport(prepared, options = {}) {
  const { directory, name, target } = prepared;
  if (prepared.mode === "replace" && !options.replace) throw new Error(`\u5168\u5C40 Skill \u201C${name}\u201D \u5DF2\u5B58\u5728\u3002\u672A\u8986\u76D6\uFF0C\u8BF7\u4FEE\u6539\u65B0 Skill \u7684 name \u540E\u91CD\u65B0\u5BFC\u5165\u3002`);
  if (globalSkillsDirectory() !== directory) throw new Error("\u53E6\u4E00\u7A97\u53E3\u5DF2\u66F4\u6539\u5168\u5C40\u4F4D\u7F6E\uFF0C\u8BF7\u91CD\u65B0\u5BFC\u5165\u786E\u8BA4\u76EE\u6807\u76EE\u5F55\u3002");
  try {
    (0, import_node_fs11.statSync)(prepared.prepared);
  } catch {
    throw new Error("\u5BFC\u5165\u6682\u5B58\u5DF2\u88AB\u6E05\u7406\uFF0C\u8BF7\u91CD\u65B0\u5BFC\u5165\u3002");
  }
  if (targetRevision(target) !== prepared.targetRevision) throw new Error("\u786E\u8BA4\u671F\u95F4\u76EE\u6807\u4F4D\u7F6E\u53D1\u751F\u4E86\u53D8\u5316\uFF08\u53EF\u80FD\u662F\u53E6\u4E00\u7A97\u53E3\u5BFC\u5165\u6216\u5220\u9664\u4E86\u540C\u540D Skill\uFF09\uFF0C\u672A\u5199\u5165\u3002\u8BF7\u91CD\u65B0\u5BFC\u5165\u3002");
  const committed = commitStagedSkill(directory, name, prepared.prepared, prepared.staging, { replace: prepared.mode === "replace", verify: (dir) => {
    const info = (0, import_node_fs11.lstatSync)(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Skill \u6682\u5B58\u76EE\u5F55\u5F02\u5E38\u3002");
  }, hook: options.hook });
  options.log?.(`[global-skills] ${prepared.mode === "replace" ? "replaced" : "imported"} ${name} into ${committed}`);
  return { ...prepared.result, name, directory: committed };
}
function discardGlobalSkillImport(prepared) {
  removeTree(prepared.staging);
}
