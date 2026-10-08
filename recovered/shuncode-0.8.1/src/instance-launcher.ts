import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Default `shuncode.bridge.cloudflareNamedLocalPort`; additional instances are
 * pre-seeded with `48271 + ordinal - 1` so two Named tunnels never collide by default.
 */
export const DEFAULT_NAMED_LOCAL_PORT = 48271;

/** `<user-data-dir>/User/globalStorage/<extension.id>` → `<user-data-dir>`. */
export function userDataDirectoryOf(globalStorageFsPath: string): string {
  return path.resolve(globalStorageFsPath, "..", "..", "..");
}

/** Short stable identity of one `--user-data-dir` process family. */
export function instanceIdentity(userDataDir: string): string {
  return createHash("sha256").update(path.resolve(userDataDir)).digest("hex").slice(0, 16);
}

/** Outermost `.app` bundle containing the running executable. The Extension
 * Host runs inside `ShunCode Helper (Plugin).app`, which is nested in the main
 * bundle's `Frameworks/`; `open -a` needs the main bundle.
 */
export function applicationBundleOf(executablePath: string): string | undefined {
  let found: string | undefined;
  let current = path.resolve(executablePath);
  for (;;) {
    if (current.endsWith(".app")) found = current;
    const parent = path.dirname(current);
    if (parent === current) return found;
    current = parent;
  }
}

/** Dev-layout escape hatch: launch this executable directly instead of
 * resolving the installed bundle. Dev builds have no `.app`/`ShunCode.exe`
 * layout, so without this a new instance cannot be spawned from them.
 */
export function devExecutableOverride(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.SHUNCODE_DEV_EXE?.trim() || undefined;
}

/** Windows: the `ShunCode.exe` that owns the running executable. The Extension
 * Host usually runs inside it already; otherwise walk up a few levels (a
 * `resources/app/...` helper layout) before giving up.
 */
export function applicationExecutableOf(executablePath: string): string | undefined {
  let current = path.dirname(path.resolve(executablePath));
  for (let depth = 0; depth < 4; depth++) {
    const candidate = path.join(current, "ShunCode.exe");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

/** `~/Library/Application Support/ShunCode` → `ShunCode-2`, `ShunCode-3`, …
 * (`%APPDATA%/ShunCode` on Windows.) Directories of instances that are
 * currently alive are skipped; a directory left by a closed instance is reused
 * so its UI state comes back.
 */
export function nextUserDataDirectory(current: string, inUse: Iterable<string>): { directory: string; ordinal: number } {
  const used = new Set([path.resolve(current), ...[...inUse].map(item => path.resolve(item))]);
  const base = path.resolve(current).replace(/-(\d+)$/, "");
  for (let ordinal = 2; ordinal < 1000; ordinal++) {
    const candidate = `${base}-${ordinal}`;
    if (!used.has(candidate)) return { directory: candidate, ordinal };
  }
  throw new Error("Too many ShunCode instances.");
}

export interface OpenInstancePlan {
  bundle?: string;
  /** Direct executable launch (Windows, or `SHUNCODE_DEV_EXE` on any platform). */
  executable?: string;
  userDataDir: string;
  ordinal: number;
  folderUri?: string;
  /** A saved `.code-workspace` file; mutually exclusive with `folderUri`. */
  fileUri?: string;
  /** `VSCODE_DEV` launches (scripts/code.sh) need the source app root as first argument. */
  developmentAppRoot?: string;
  environment?: Record<string, string>;
}

function localFileUri(value: string | undefined, what: string): string | undefined {
  if (value === undefined) return undefined;
  if (!/^file:\/\//.test(value)) throw new Error(`只能在新实例中打开本地${what}。`);
  return value;
}

/** Arguments for `/usr/bin/open`. `-n` always creates a new process even when
 * the bundle is already running; a distinct `--user-data-dir` gives it its own
 * single-instance lock, workspace storage, UI state and Bridge listener.
 * `--shared-data-dir` is intentionally never passed: every instance keeps using
 * the parent's shared data home (default `~/.shuncode-shared`: shared account
 * storage and the workspace hub). When the parent was started with
 * `--shared-data-dir`, the carrier exported it as `SHUNCODE_SHARED_DATA_HOME`
 * and it travels via `--env`, which the new instance's `appSharedDataHome` honours.
 */
export function buildOpenArguments(plan: OpenInstancePlan): string[] {
  const folderUri = localFileUri(plan.folderUri, "文件夹");
  const fileUri = localFileUri(plan.fileUri, "文件");
  if (folderUri && fileUri) throw new Error("Cannot open both a folder and a file in one instance.");
  const args = ["-n", "-a", plan.bundle ?? ""];
  for (const [key, value] of Object.entries(plan.environment ?? {})) args.push("--env", `${key}=${value}`);
  args.push("--args");
  if (plan.developmentAppRoot) args.push(plan.developmentAppRoot);
  args.push("--user-data-dir", plan.userDataDir);
  if (folderUri) args.push("--folder-uri", folderUri);
  if (fileUri) args.push("--file-uri", fileUri);
  return args;
}

/** Arguments for a direct executable launch (Windows `ShunCode.exe`, or a
 * `SHUNCODE_DEV_EXE` override). A distinct `--user-data-dir` gives the new
 * process its own single-instance lock; environment travels via the child's
 * own environment block instead of `open --env`.
 */
export function buildSpawnArguments(plan: OpenInstancePlan): string[] {
  const folderUri = localFileUri(plan.folderUri, "文件夹");
  const fileUri = localFileUri(plan.fileUri, "文件");
  if (folderUri && fileUri) throw new Error("Cannot open both a folder and a file in one instance.");
  const args: string[] = [];
  const target = folderUri ?? fileUri;
  if (target) args.push(fileURLToPath(target));
  args.push("--user-data-dir", plan.userDataDir);
  return args;
}

/** First launch of a new instance: seed a distinct Named Tunnel local port as
 * the instance-level default. Existing settings are never touched.
 */
export async function seedInstanceSettings(userDataDir: string, ordinal: number): Promise<boolean> {
  const userDirectory = path.join(userDataDir, "User");
  const settings = path.join(userDirectory, "settings.json");
  try { await access(settings); return false; } catch { /* first launch */ }
  await mkdir(userDirectory, { recursive: true, mode: 0o700 });
  const payload = { "shuncode.bridge.cloudflareNamedLocalPort": DEFAULT_NAMED_LOCAL_PORT + ordinal - 1 };
  await writeFile(settings, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  return true;
}

function spawnDetached(executable: string, args: string[], environment?: Record<string, string>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let child;
    try {
      // Detached on purpose: the new instance must outlive this Extension Host.
      child = spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, ...environment } });
    } catch (error) {
      reject(new Error(`无法启动新的 ShunCode 实例：${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    child.on("error", error => reject(new Error(`无法启动新的 ShunCode 实例：${error.message}`)));
    // The promise settles on the launch attempt only, like the macOS `open`
    // path below: it does not wait for the new window to appear.
    child.on("spawn", () => { child.unref(); resolve(); });
  });
}

/**
 * Launch a new instance and report whether the launcher actually accepted it.
 *
 * The child is detached on purpose -- the new instance must outlive this
 * Extension Host -- but it used to be spawned with `stdio: "ignore"` and no
 * listeners, so a failure was invisible: `/usr/bin/open` exits 1 for a missing
 * or damaged bundle while the UI still reported success, which is exactly the
 * "clicked it and nothing happened" symptom.
 *
 * stderr is captured (not inherited) so the reason can be surfaced, and the
 * promise settles on the launch attempt only. It does not wait for the new
 * window: `open` returns as soon as LaunchServices has taken the request.
 */
export function launchInstance(plan: OpenInstancePlan): Promise<void> {
  if (plan.executable) return spawnDetached(plan.executable, buildSpawnArguments(plan), plan.environment);
  if (process.platform !== "darwin" || !plan.bundle) throw new Error("Opening a separate ShunCode instance is only supported on macOS and Windows.");
  return new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/open", buildOpenArguments(plan), { detached: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", chunk => { if (stderr.length < 2000) stderr += chunk; });
    // spawn() itself failed (for example /usr/bin/open missing).
    child.on("error", error => reject(new Error(`无法启动新的 ShunCode 实例：${error.message}`)));
    child.on("exit", code => {
      if (code === 0) { child.unref(); resolve(); return; }
      const detail = stderr.trim() || `open 退出码 ${code ?? "unknown"}`;
      reject(new Error(`无法启动新的 ShunCode 实例：${detail}`));
    });
  });
}
