import * as vscode from "vscode";
import { readdirSync, lstatSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureGlobalSkills, defaultGlobalSkillsDirectory, GLOBAL_SKILLS_VERSION, globalSkillsDirectory, isGlobalSkillDirectory } from "../../../src/global-skill-paths.js";
import { GlobalSkillSettings } from "../../../src/global-skill-settings.js";
import { diagnoseGlobalSkills, loadGlobalSkills } from "../../../src/global-skill-catalog.js";
import { commitGlobalSkillImport, discardGlobalSkillImport, prepareGlobalSkillImport, type PreparedGlobalSkillImport, type SkillImportOrigin } from "../../../src/global-skill-import.js";
import { configureSkillArchiveWorker } from "../../../src/skill-archive.js";
import { recoverSkillImports } from "../../../src/skill-import-recovery.js";
import { detectMigratableSkills, migrateGlobalSkills, type GlobalSkillMigrationReport } from "../../../src/global-skill-migration.js";
import { loadSkillTools, diagnoseSkillTools, resolveSkillDir, skillMarkdownName, type SkillFixAction } from "../../../src/custom-tool-skill.js";
import { loadCustomTools } from "../../../src/custom-tools.js";
import { toggleCustomTool, deleteCustomTool } from "../../../src/custom-tool-admin.js";
import { generateSkillRunner, type SkillImportResult, type SkillRunnerResult } from "../../../src/custom-tool-skill-import.js";
import { type AgentSkillItem, type AgentSkillListing } from "./skill-list-tool.js";

let settings: GlobalSkillSettings;
let output: vscode.OutputChannel;
let lastImported: { directory: string; at: number } | undefined;
const roots = (): string[] => vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [];
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
function probeDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const probe = mkdtempSync(path.join(directory, ".write-test-"));
  rmSync(probe, { recursive: true });
}

export const MIGRATE_ACTION = "切换并迁移";
export const SWITCH_ONLY_ACTION = "仅切换";

function migrationSummary(report: GlobalSkillMigrationReport): string {
  const lines = [`已迁移 ${report.migrated.length} 个 Skill 到新的全局目录（原目录文件完好保留）。`];
  if (report.skipped.length) lines.push(`未迁移 ${report.skipped.length} 个：`, ...report.skipped.map(item => `- ${item.name}：${item.reason}`));
  return lines.join("\n");
}

/**
 * Switch the global location. Skills found in the previous directory are offered for a one-click migration
 * (transactional copy + validation into the new directory); the previous directory is never modified.
 */
async function chooseLocation(): Promise<{ changed: boolean; migration?: GlobalSkillMigrationReport }> {
  const selection = await vscode.window.showOpenDialog({ title: "选择全局 Skill 目录（所有工作区共享）", canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "使用此全局目录" });
  const selected = selection?.[0]?.fsPath;
  if (!selected) return { changed: false };
  const directory = realpathSync(selected);
  if (/\.app(?:[\\/]|$)/i.test(directory) || roots().some(root => directory === realpathSync(root) || directory.startsWith(realpathSync(root) + path.sep))) throw new Error("请选择工作区之外的独立全局目录；不能放在 macOS .app 内。");
  probeDirectory(directory);
  let previous: string | undefined;
  try { previous = settings.getDirectory(); } catch { previous = undefined; }
  const pending = detectMigratableSkills(previous, directory);
  let migrate = false;
  if (pending.length) {
    const names = pending.slice(0, 8).map(skill => skill.name).join("、") + (pending.length > 8 ? ` 等` : "");
    const choice = await vscode.window.showWarningMessage(`将所有工作区的全局 Skill 位置切换为：\n${directory}\n\n在原目录 ${previous} 检测到 ${pending.length} 个已有 Skill：${names}\n是否自动迁移到新目录？迁移为事务复制并逐个校验，原目录文件完好保留；新目录中的同名 Skill 不会被覆盖。`, { modal: true }, MIGRATE_ACTION, SWITCH_ONLY_ACTION);
    if (!choice) return { changed: false };
    migrate = choice === MIGRATE_ACTION;
  } else {
    const confirmed = await vscode.window.showWarningMessage(`将所有工作区的全局 Skill 位置切换为：\n${directory}\n原目录中没有检测到需要迁移的 Skill。`, { modal: true }, "切换全局位置");
    if (!confirmed) return { changed: false };
  }
  settings.setDirectory(directory);
  sweepInterruptedImports();
  if (!migrate || !previous) return { changed: true };
  const migration = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在迁移 ${pending.length} 个 Skill…` },
    () => migrateGlobalSkills(previous!, pending, text => output.appendLine(text)));
  const summary = migrationSummary(migration);
  output.appendLine(`[skills] ${summary.replace(/\n/g, " ")}`);
  if (migration.skipped.length) void vscode.window.showWarningMessage(summary);
  else void vscode.window.showInformationMessage(summary);
  return { changed: true, migration };
}
async function writableDirectory(): Promise<string> {
  try {
    const directory = settings.getDirectory();
    probeDirectory(directory);
    return directory;
  } catch (error) {
    const choice = await vscode.window.showWarningMessage(`全局 Skill 目录不可用：${message(error)}\n请选择另一个全局位置；不会回退到当前项目。`, { modal: true }, "选择其他全局位置");
    if (!choice || !(await chooseLocation()).changed) throw new Error("已取消导入；没有写入项目目录。");
    return settings.getDirectory();
  }
}
function describeImport(prepared: PreparedGlobalSkillImport): string {
  const { bytes, entries } = prepared.snapshot;
  const size = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return [
    `名称：${prepared.name}`,
    prepared.mode === "replace" ? "方式：替换已安装的同名 Skill（旧版本先备份，失败自动恢复）" : "方式：新增",
    `内容：${entries} 个文件，${size}`,
    `来源：${prepared.source}`,
    `目标：${prepared.target}`,
  ].join("\n");
}

/**
 * One pipeline for every entry (R2 §5.2): prepare (worker extraction or the folder adapter, checks, preview),
 * the user confirms what will be written, then the journaled commit. Nothing in the package is executed.
 * `legacy` is the default for old callers; folder and archive validation is shared.
 */
export async function importGlobalSkillWithPrompt(source: string, origin: SkillImportOrigin = "legacy"): Promise<SkillImportResult> {
  const directory = await writableDirectory();
  const log = (text: string) => output.appendLine(text);
  const prepared = await prepareGlobalSkillImport(source, { origin, log });
  try {
    const confirm = await vscode.window.showWarningMessage(`将 Skill 导入全局目录，所有工作区均可发现并调用。Skill 脚本具有当前用户权限，请仅导入信任的来源。\n${describeImport(prepared)}`, { modal: true }, prepared.mode === "replace" ? "替换并导入" : "信任并导入");
    if (!confirm) throw new Error("已取消导入。");
    if (settings.getDirectory() !== directory) throw new Error("另一窗口已更改全局位置，请重新导入确认目标目录。");
    const result = commitGlobalSkillImport(prepared, { replace: prepared.mode === "replace", log });
    // Remember the actual chosen/default directory across app relocation/upgrades.
    try {
      if (settings.getDirectory() === directory) settings.setDirectory(directory);
      else void vscode.window.showWarningMessage(`Skill 已导入 ${result.directory}，但另一窗口已切换全局位置。文件仍保留在上述目录。`);
    } catch (error) {
      output.appendLine(`[skills] imported, but could not remember location: ${message(error)}`);
      void vscode.window.showWarningMessage(`Skill 已导入 ${result.directory}，但保存全局位置失败：${message(error)}`);
    }
    lastImported = { directory: result.directory, at: Date.now() };
    return result;
  } finally {
    discardGlobalSkillImport(prepared);
  }
}

/** "Copy to global" for a project skill: the folder adapter feeding the same transactional pipeline. */
export function promoteWorkspaceSkill(directory: string): Promise<SkillImportResult> {
  return importGlobalSkillWithPrompt(directory, "promote");
}

/** Where a page or command caller says the path came from; only the public origins are accepted from outside. */
function importOrigin(options: unknown, fallback: "dialog" | "legacy"): SkillImportOrigin {
  if (options === undefined || options === null) return fallback;
  const origin = typeof options === "object" ? (options as { origin?: unknown }).origin : undefined;
  if (origin === "dialog" || origin === "drop" || origin === "legacy") return origin;
  throw new Error("Skill 导入来源只能是 dialog、drop 或 legacy。");
}

function sweepInterruptedImports(): void {
  try {
    const report = recoverSkillImports(settings.getDirectory());
    if (report.rolledBack.length || report.rolledForward.length || report.removed.length) output.appendLine(`[skills] settled interrupted imports: ${JSON.stringify(report)}`);
  } catch (error) {
    output.appendLine(`[skills] import recovery skipped: ${message(error)}`);
  }
}

export interface SkillPageEntry {
  id: string;
  scope: "global" | "workspace";
  directory: string;
  name?: string;
  title: string;
  description: string;
  loaded: boolean;
  enabled: boolean;
  managed: boolean;
  reason?: string;
  /** Stable load-check code, same verdict as BridgeManager.diagnoseSkills(); absent while the skill is loaded. */
  reasonCode?: string;
  /** One-click fix the page can offer for reasonCode. */
  fix?: SkillFixAction;
}

/** JSON manifest tool as exposed by Bridge (skills excluded), for the page's "existing custom tools (JSON)" section. */
export interface SkillPageJsonTool {
  name: string;
  title: string;
  description: string;
  enabled: boolean;
  sourcePath: string;
  /** Workspace folder that owns the manifest. */
  workspace?: string;
}

const SKILLS_ENABLED_SETTING = "bridge.skillsEnabled";
const SKILLS_DISABLED_REASON = "Skill 总开关已关闭。";
const SHADOWED_REASON = "同名全局 Skill / 更高优先级工具已占用名称";

/**
 * Settings layer that decides `shuncode.bridge.skillsEnabled`. The setting is window-scoped,
 * so VS Code ignores folder-level values and there is no folder layer to report or write.
 */
export type SkillAvailabilitySource = "default" | "user" | "workspace";
export interface SkillAvailability {
  effective: boolean;
  source: SkillAvailabilitySource;
  userValue?: boolean;
  workspaceValue?: boolean;
  /** Layer written by `setEnabled(value)` / `setEnabled(value, "effective")`. */
  effectiveTarget: "user" | "workspace";
  hasWorkspace: boolean;
  /** File behind the workspace layer: `.vscode/settings.json`, or the saved `.code-workspace` file. */
  workspaceSettingsFile?: string;
}

/** Same unscoped read as the Bridge loader, so the page reports what Bridge actually loads. */
function readSkillsEnabled(): boolean {
  return vscode.workspace.getConfiguration("shuncode").get<boolean>(SKILLS_ENABLED_SETTING, true);
}

export function skillAvailability(): SkillAvailability {
  const inspected = vscode.workspace.getConfiguration("shuncode").inspect<boolean>(SKILLS_ENABLED_SETTING);
  const userValue = typeof inspected?.globalValue === "boolean" ? inspected.globalValue : undefined;
  const workspaceValue = typeof inspected?.workspaceValue === "boolean" ? inspected.workspaceValue : undefined;
  const source: SkillAvailabilitySource = workspaceValue !== undefined ? "workspace" : userValue !== undefined ? "user" : "default";
  const hasWorkspace = roots().length > 0;
  // No explicit layer yet: keep the historical rule (open project -> workspace settings, empty window -> user settings).
  const effectiveTarget = source === "default" ? (hasWorkspace ? "workspace" : "user") : source;
  const workspaceFile = vscode.workspace.workspaceFile;
  const workspaceSettingsFile = !hasWorkspace ? undefined
    : workspaceFile ? (workspaceFile.scheme === "file" ? workspaceFile.fsPath : undefined) : path.join(roots()[0]!, ".vscode", "settings.json");
  return { effective: readSkillsEnabled(), source, userValue, workspaceValue, effectiveTarget, hasWorkspace, workspaceSettingsFile };
}

async function setSkillsEnabled(enabled: unknown, target: unknown): Promise<SkillAvailability> {
  if (typeof enabled !== "boolean") throw new Error("Skill 开关必须是布尔值。");
  const requested = target ?? "effective";
  if (requested !== "effective" && requested !== "user" && requested !== "workspace" && requested !== "all-projects") throw new Error("Skill 开关的写入位置只能是 effective、user、workspace 或 all-projects。");
  const current = skillAvailability();
  if (requested === "all-projects") {
    // "Use as the default for all projects": write the user layer, then drop this project's override so it follows that default.
    const config = vscode.workspace.getConfiguration("shuncode");
    await config.update(SKILLS_ENABLED_SETTING, enabled, vscode.ConfigurationTarget.Global);
    if (current.workspaceValue !== undefined) await config.update(SKILLS_ENABLED_SETTING, undefined, vscode.ConfigurationTarget.Workspace);
    return skillAvailability();
  }
  const layer = requested === "effective" ? current.effectiveTarget : requested;
  if (layer === "workspace" && !current.hasWorkspace) throw new Error("没有打开项目，无法写入项目设置。");
  await vscode.workspace.getConfiguration("shuncode").update(SKILLS_ENABLED_SETTING, enabled, layer === "workspace" ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
  return skillAvailability();
}

function catalogEntries(): SkillPageEntry[] {
  const skillsOn = readSkillsEnabled();
  const globals = loadGlobalSkills();
  const projects = roots().flatMap(root => loadSkillTools(root));
  const selected = loadCustomTools(roots());
  const projectDiagnoses = roots().flatMap(root => diagnoseSkillTools(root).map(item => ({ ...item, scope: "workspace" as const, directory: path.join(root, ".shuncode/mcp-tools", item.dirName) })));
  return [...diagnoseGlobalSkills(), ...projectDiagnoses].map(item => {
    const directory = item.directory!;
    const tool = [...globals, ...projects].find(candidate => candidate.skillDir === directory);
    const managed = !!tool && selected.find(candidate => candidate.name === tool.name)?.skillDir === directory;
    const shadowed = item.loaded && !managed;
    // Verdict order matches BridgeManager.diagnoseSkills(): master switch, then name shadowing, then the loader check.
    const verdict: { reasonCode?: string; fix?: SkillFixAction } = !skillsOn ? { reasonCode: "skills-disabled", fix: "enable-skills" }
      : shadowed ? { reasonCode: "duplicate-name", fix: "open-folder" }
        : item.loaded ? {} : { reasonCode: item.reasonCode ?? "unknown", fix: item.fix };
    return { id: JSON.stringify([item.scope, directory]), scope: item.scope ?? "workspace", directory,
      name: tool?.name || item.name, title: item.dirName, description: tool?.description || "",
      loaded: item.loaded, enabled: tool?.enabled ?? false, managed,
      reason: shadowed ? SHADOWED_REASON : item.reason, ...verdict };
  });
}
/**
 * Installed-skill listing for the Bridge `list_skills` tool (0.7.7): the same
 * source as the Skill page (catalogEntries), shaped for an AI client. `loaded`
 * means the tool is actually callable. Read-only; must never throw (a center
 * that is not activated yet yields an empty listing).
 */
export function listInstalledSkillsForAgent(): AgentSkillListing {
  if (!settings) throw new Error("Skill catalog is not initialized yet; retry after extension activation.");
  const directory = settings.getDirectory();
  const enabled = readSkillsEnabled();
  // Discovery reads paths only. Workspace trust and legacy runner validation do
  // not turn instruction folders into executable MCP tools.
  return { directory, enabled, skills: catalogEntries().map(entry => {
    let skillFile: string | null = null;
    try {
      const markdown = skillMarkdownName(entry.directory);
      if (markdown) {
        const candidate = path.join(entry.directory, markdown);
        if (lstatSync(candidate).isFile()) skillFile = candidate;
      }
    } catch { /* Keep the installed directory visible with a missing-file diagnostic. */ }
    return { name: entry.name ?? path.basename(entry.directory), title: entry.title,
      description: entry.description, scope: entry.scope, directory: entry.directory, skillFile,
      loaded: skillFile !== null, enabled: entry.enabled,
      ...(skillFile ? {} : { reasonCode: "skill-file-missing", reason: "Skill 不合规：缺少唯一的根目录 skill.md / SKILL.md 普通文件。" }) };
  }) };
}

const isInside = (root: string, file: string): boolean => {
  const relative = path.relative(root, file);
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
};
function jsonTools(): SkillPageJsonTool[] {
  const folders = roots();
  // Same loader and precedence as Bridge's custom tool list, minus skills.
  return loadCustomTools(folders, undefined, { skillsEnabled: readSkillsEnabled() }).filter(tool => !tool.skillDir).map(tool => ({
    name: tool.name, title: tool.title, description: tool.description, enabled: tool.enabled, sourcePath: tool.sourcePath,
    workspace: folders.find(root => isInside(root, tool.sourcePath)),
  }));
}
function diagnosisFor(entry: SkillPageEntry) {
  return { scope: entry.scope, directory: entry.directory, dirName: path.basename(entry.directory), name: entry.name,
    loaded: entry.reasonCode === undefined, reasonCode: entry.reasonCode,
    reason: entry.reasonCode === "skills-disabled" ? SKILLS_DISABLED_REASON : entry.reason,
    fix: entry.fix ?? (entry.reasonCode ? "open-folder" : "none") };
}
/** Same resolution and safety checks as BridgeManager.generateSkillRunner(); never overwrites an existing or declared entry. */
function generateRunnerFor(entry: SkillPageEntry): SkillRunnerResult {
  const dirName = path.basename(entry.directory);
  const log = (text: string) => output.appendLine(text);
  if (entry.scope === "global") {
    const directory = globalSkillsDirectory();
    const resolved = directory ? resolveSkillDir(directory, dirName, directory) : undefined;
    if (!directory || !resolved || path.resolve(resolved) !== path.resolve(entry.directory) || !isGlobalSkillDirectory(resolved)) throw new Error("全局 Skill 路径不安全，已拒绝写入。");
    return generateSkillRunner(directory, dirName, log, directory);
  }
  const root = roots().find(candidate => path.resolve(candidate, ".shuncode/mcp-tools", dirName) === path.resolve(entry.directory));
  if (!root) throw new Error("Skill 来源已改变，请刷新后重试。");
  return generateSkillRunner(root, dirName, log);
}
function entryById(id: unknown): SkillPageEntry {
  if (typeof id !== "string") throw new Error("Skill 标识无效。");
  const entry = catalogEntries().find(item => item.id === id);
  if (!entry) throw new Error("Skill 来源已改变，请刷新后重试。");
  return entry;
}

/** Backend for the independent Skill settings page, not an Activity Bar tree. */
export function registerSkillCenter(context: vscode.ExtensionContext, channel: vscode.OutputChannel): void {
  output = channel;
  settings = new GlobalSkillSettings(path.join(os.homedir(), ".shuncode", "global-skills.json"), defaultGlobalSkillsDirectory(vscode.env.appRoot, os.userInfo().username, process.platform, process.env.APPIMAGE));
  configureGlobalSkills(() => settings.getDirectory());
  // Archives are decoded in a worker bundled beside extension.js (scripts/build-vscode-extension.mjs).
  configureSkillArchiveWorker(context.extensionPath ? path.join(context.extensionPath, "dist", "skill-archive-worker.js") : undefined);
  output.appendLine(`[skills] ${GLOBAL_SKILLS_VERSION}; skill-settings-page-v1`);
  sweepInterruptedImports();
  const openPage = () => vscode.commands.executeCommand("aiCustomization.openManagementEditor", "skillCenter");
  const register = (id: string, action: (...args: any[]) => unknown): vscode.Disposable => vscode.commands.registerCommand(id, async (...args: any[]) => {
    try { return await action(...args); } catch (error) { output.appendLine(`[skills] ${message(error)}`); throw error; }
  });
  context.subscriptions.push({ dispose() { configureGlobalSkills(undefined); configureSkillArchiveWorker(undefined); lastImported = undefined; } },
    register("shuncode.skills.center", openPage),
    register("shuncode.skills.search", openPage),
    register("shuncode.skills.refresh", openPage),
    register("shuncode.skills.getCatalog", () => {
      const availability = skillAvailability();
      return {
        version: "skill-settings-page-v1", directory: settings.getDirectory(), entries: catalogEntries(),
        skillsEnabled: availability.effective, availability, jsonTools: jsonTools(),
        trusted: vscode.workspace.isTrusted,
        highlightedDirectory: lastImported && Date.now() - lastImported.at < 7000 ? lastImported.directory : undefined,
      };
    }),
    register("shuncode.skills.setEnabled", async (enabled: unknown, target?: unknown) => setSkillsEnabled(enabled, target)),
    register("shuncode.skills.changeLocation", async () => chooseLocation()),
    register("shuncode.skills.openDirectory", async () => { const directory = await writableDirectory(); await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(directory)); }),
    register("shuncode.skills.import", async (source?: unknown, options?: unknown) => {
      if (source !== undefined && source !== null && (typeof source !== "string" || !source.trim())) throw new Error("Skill 来源必须是本地路径。");
      const origin = importOrigin(options, typeof source === "string" ? "legacy" : "dialog");
      // Native Windows dialogs cannot reliably select files and folders together: use separate entry points.
      const kind = typeof options === "object" && options !== null ? (options as { kind?: unknown }).kind : undefined;
      if (kind !== undefined && kind !== "folder" && kind !== "archive") throw new Error("Skill 选择类型无效。");
      const archive = kind === "archive";
      const selection = typeof source === "string" ? undefined : await vscode.window.showOpenDialog({
        title: archive ? "导入全局 Skill 压缩包" : "选择 Skill 文件夹（进入该文件夹后点击右下角按钮直接导入）",
        canSelectFiles: archive, canSelectFolders: !archive, canSelectMany: false, openLabel: archive ? "导入压缩包" : "选择此文件夹",
        ...(archive ? { filters: { "Skill 压缩包（.zip、.tar.gz、.tgz）": ["zip", "tgz", "gz"] } } : {}),
      });
      const sourcePath = typeof source === "string" ? source : selection?.[0]?.fsPath;
      if (!sourcePath) return { cancelled: true };
      const result = await importGlobalSkillWithPrompt(sourcePath, origin);
      await openPage();
      return { result };
    }),
    register("shuncode.skills.openSkill", async (name: unknown) => {
      if (typeof name !== "string") throw new Error("Skill 名称无效。");
      const entry = catalogEntries().find(item => item.scope === "global" && (item.name === name || path.basename(item.directory) === name));
      if (!entry) throw new Error("未找到全局 Skill，请刷新。");
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(entry.directory));
    }),
    register("shuncode.skills.action", async (id: unknown, action: unknown) => {
      const entry = entryById(id);
      if (action === "folder") { await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(entry.directory)); return; }
      if (action === "document") {
        const marker = skillMarkdownName(entry.directory), file = marker ? path.join(entry.directory, marker) : "";
        if (!file || !existsSync(file)) throw new Error("目录中没有唯一的 skill.md / SKILL.md。");
        await vscode.window.showTextDocument(vscode.Uri.file(file)); return;
      }
      if (action === "promote") {
        if (entry.scope !== "workspace") throw new Error("该 Skill 已是全局来源。");
        return { result: await promoteWorkspaceSkill(entry.directory) };
      }
      if (action === "diagnose") return { diagnosis: diagnosisFor(entry) };
      if (action === "generate-runner") return { result: generateRunnerFor(entry) };
      if (action !== "toggle" && action !== "delete") throw new Error("未知 Skill 操作。");
      if (!entry.loaded || !entry.managed || !entry.name) throw new Error("此 Skill 未加载或被同名版本覆盖，请打开目录检查。");
      if (action === "delete") {
        const confirm = await vscode.window.showWarningMessage(`永久删除 ${entry.title}？${entry.scope === "global" ? "这将影响所有工作区。" : "仅删除项目副本。"}\n${entry.directory}`, { modal: true }, "永久删除");
        if (!confirm) return { cancelled: true };
        const current = entryById(id);
        if (!current.managed || current.name !== entry.name) throw new Error("Skill 来源已改变，已取消删除。");
        deleteCustomTool(roots(), entry.name);
      } else toggleCustomTool(roots(), entry.name);
    }),
  );
}
