/**
 * Host side of configure_mcp runtime provisioning.
 *
 * The Bridge facade must stay free of process spawning (its migration contract
 * pins that), so probing PATH and running a package-manager install live here.
 * No shell is used: arguments are passed as an argv array, output is captured
 * and truncated, and every run is bounded by a timeout.
 */
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

export interface ProvisionResult { ok: boolean; output: string }

/** Run one command without a shell; resolves instead of throwing so callers can report it. */
export function runProvisionCommand(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  log?: (message: string) => void,
): Promise<ProvisionResult> {
  return new Promise((resolve) => {
    let output = "";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, [...args], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ ok: false, output: error instanceof Error ? error.message : String(error) });
      return;
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, Math.max(1_000, timeoutMs));
    const collect = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.length > 64_000) output = output.slice(-64_000);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `${output}\n${error.message}`.trim() });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      log?.(`[configure_mcp] ${command} ${args.join(" ")} -> exit ${code ?? "null"}`);
      resolve({ ok: code === 0, output });
    });
  });
}

/** PATH lookup using the platform resolver, so it matches what the stdio launch will find. */
export async function hasExecutableOnPath(command: string, bundledBinDir?: string): Promise<boolean> {
  // managedStdioEnvironment adds this directory to PATH when launching a server.
  if (bundledBinDir && (command === "uv" || command === "uvx")) {
    try {
      await access(path.join(bundledBinDir, command + (process.platform === "win32" ? ".exe" : "")));
      return true;
    } catch { /* fall through to the system PATH */ }
  }
  const probe = process.platform === "win32" ? "where" : "which";
  const result = await runProvisionCommand(probe, [command], 15_000);
  return result.ok;
}
