import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, chmodSync, unlinkSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TunnelLeaseInput {
  provider: "cloudflare" | "cloudflare-named" | "ngrok";
  configuredDomain: string;
  configuredNamedDomain: string;
  namedTunnelToken: string;
}

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Only fixed endpoints need a lease. Do not persist/log the Named credential.
 * Domain ownership spans profiles and providers; a Named connector must not be
 * reused by another workspace even if it supplies a different public hostname.
 * ngrok additionally takes a provider-wide lease: one account runs a single
 * ngrok agent, so the third provider is singleton per machine (per user)
 * regardless of which reserved domain — if any — each window configured.
 */
export function bridgeTunnelLeaseResources(input: TunnelLeaseInput): string[] {
  if (input.provider === "cloudflare") return [];
  if (input.provider === "ngrok") {
    const resources = ["provider:ngrok"];
    const domain = input.configuredDomain;
    if (domain) resources.push(`domain:${domain.trim().toLowerCase()}`);
    return resources;
  }
  const domain = input.configuredNamedDomain;
  const resources = domain ? [`domain:${domain.trim().toLowerCase()}`] : [];
  if (input.namedTunnelToken) {
    resources.push(`named-credential:${hash(input.namedTunnelToken)}`);
  }
  return resources;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
  });
}

const uid = (): number => (typeof process.getuid === "function" ? process.getuid() : 0);

/** Linux: abstract Unix sockets (no file system entry; the kernel releases them
 * when the owning Extension Host exits).
 */
function linuxLeaseAddress(resource: string): string {
  return `\0shuncode-bridge-v1-${uid()}-${hash(resource).slice(0, 48)}`;
}

/** Windows: fully-qualified named-pipe lease names. Both filesystem socket paths
 * and bare pipe names fail with EACCES on win32; only the `\\?\pipe\<name>`
 * form binds (verified: double-bind then reports EADDRINUSE as expected). No
 * filesystem entry is created and no stale file can remain. Like Linux
 * abstract sockets, the kernel releases the name when the owning process
 * exits, so no stale-recycle probe is needed: EADDRINUSE always means a live
 * owner. The uid keeps one user's leases away from another's; visibility is
 * otherwise machine- and session-wide.
 */
function win32LeaseName(resource: string): string {
  return `\\\\?\\pipe\\shuncode-bridge-v1-${uid()}-${hash(resource).slice(0, 48)}`;
}

/** macOS has no abstract namespace: use a path socket inside the per-user
 * temporary directory (`$TMPDIR` is a private `/var/folders/...` tree). The
 * name is kept short because `sun_path` is limited to 104 bytes on Darwin.
 * A force-killed owner leaves a stale socket file; it is recycled by a
 * connect() probe (ECONNREFUSED = nobody listens), never by PID files or
 * process-name scans. Only the same user's ShunCode processes take part.
 */
export function pathLeaseDirectory(): string {
  const name = `shuncode-lease-${uid()}`;
  const preferred = path.join(os.tmpdir(), name);
  // 24 hex chars + ".sock" + separator must still fit into sun_path.
  return Buffer.byteLength(preferred) + 1 + 24 + 5 < 104 ? preferred : path.join("/tmp", name);
}

function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    // Defensive only: win32 leases use pipe names, never this directory.
    return;
  }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Bridge lease directory ${directory} is not a private directory.`);
  if (stat.uid !== uid()) throw new Error(`Bridge lease directory ${directory} is owned by another user.`);
  if ((stat.mode & 0o077) !== 0) chmodSync(directory, 0o700);
}

/** Socket file used for one resource (exported for tests and diagnostics). */
export function pathLeaseSocket(resource: string): string {
  return path.join(pathLeaseDirectory(), `${hash(resource).slice(0, 24)}.sock`);
}

function pathLeaseAddress(resource: string): string {
  ensurePrivateDirectory(pathLeaseDirectory());
  return pathLeaseSocket(resource);
}

function listenOnce(server: Server, address: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(address);
  });
}

/** true = a live owner accepted the connection; false = nobody listens (stale file). */
function probeAlive(address: string): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const socket = connect(address);
    const done = (alive: boolean) => { socket.removeAllListeners(); socket.destroy(); resolve(alive); };
    socket.once("connect", () => done(true));
    socket.once("error", (error: NodeJS.ErrnoException) => done(!(error.code === "ECONNREFUSED" || error.code === "ENOENT")));
    socket.setTimeout(2_000, () => done(true));
  });
}

function fileIdentity(address: string): string | undefined {
  try {
    const stat = lstatSync(address);
    return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.ctimeMs}`;
  } catch {
    return undefined;
  }
}

async function listenPathLease(server: Server, address: string, conflictMessage: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await listenOnce(server, address);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt === 1) {
        throw (error as NodeJS.ErrnoException).code === "EADDRINUSE" ? new BridgeTunnelLeaseConflictError(conflictMessage) : error;
      }
      const identity = fileIdentity(address);
      if (await probeAlive(address)) throw new BridgeTunnelLeaseConflictError(conflictMessage);
      // Stale socket left by a force-killed owner. Only remove the exact file we
      // probed: if another process already replaced it, retry against the new one.
      if (identity !== undefined && fileIdentity(address) === identity) {
        try { unlinkSync(address); } catch (unlinkError) { if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError; }
      }
    }
  }
}

/**
 * Thrown when another ShunCode window/instance already holds a tunnel lease.
 * Carries a marker flag (in addition to instanceof) so the fallback logic can
 * recognise it across module-duplication boundaries.
 */
export class BridgeTunnelLeaseConflictError extends Error {
  readonly isBridgeTunnelLeaseConflict = true as const;
  constructor(message: string) {
    super(message);
    this.name = "BridgeTunnelLeaseConflictError";
  }
}

/** True only for a cross-window lease conflict — never for install/config errors. */
export function isBridgeTunnelLeaseConflict(error: unknown): boolean {
  return error instanceof BridgeTunnelLeaseConflictError
    || (typeof error === "object" && error !== null && (error as { isBridgeTunnelLeaseConflict?: unknown }).isBridgeTunnelLeaseConflict === true);
}

/** Atomic, per-user, cross-process leases for fixed Bridge endpoints and shared
 * chat records. They coordinate ShunCode windows/instances, not arbitrary
 * programs or hosts; an untracked orphan is never assumed safe to terminate.
 * The kernel (Linux abstract sockets and Windows named-pipe names) or
 * `server.close()` (macOS path sockets, unlinked by libuv) releases a lease;
 * a crashed macOS owner leaves a stale file that the next acquirer recycles
 * after a failed connect() probe.
 */
export async function acquireBridgeTunnelLease(resources: readonly string[], conflictMessage = "This fixed Bridge endpoint or Named Tunnel credential is already in use by another ShunCode window. Use a different domain/tunnel, or stop its owning Bridge first. No other process was stopped."): Promise<() => Promise<void>> {
  const held: Server[] = [];
  const kernelReleased = process.platform === "linux" || process.platform === "win32";
  try {
    for (const resource of [...new Set(resources)].sort()) {
      const server = createServer(socket => socket.destroy());
      if (kernelReleased) {
        const address = process.platform === "win32" ? win32LeaseName(resource) : linuxLeaseAddress(resource);
        try {
          await listenOnce(server, address);
        } catch (error) {
          throw (error as NodeJS.ErrnoException).code === "EADDRINUSE" ? new BridgeTunnelLeaseConflictError(conflictMessage) : error;
        }
      } else {
        await listenPathLease(server, pathLeaseAddress(resource), conflictMessage);
      }
      server.unref();
      held.push(server);
    }
  } catch (error) {
    await Promise.all(held.map(closeServer));
    throw error;
  }
  let releasing: Promise<void> | undefined;
  return () => releasing ??= Promise.all(held.map(closeServer)).then(() => undefined);
}

/** Ownership record for the tunnel child of the current lease holder. Written
 * after spawn and cleared after a clean stop; a holder that dies without
 * cleanup (crash, hard kill) leaves it behind so the next holder can verify
 * and reclaim the orphan. The file lives in the same per-user directory as
 * the macOS path leases and is keyed by the exact lease resources, so each
 * singleton scope (ngrok provider, named domain+credential) has its own
 * record. Non-singleton quick tunnels (resources === []) never write or
 * reclaim: several windows own their own cloudflared children and a shared
 * record could not tell them apart.
 */
export interface TunnelOwnershipRecord {
  /** OS pid of the tunnel child at spawn time. */
  readonly pid: number;
  /** Image name used for identity verification, e.g. `ngrok.exe`. */
  readonly image: string;
  /** Tunnel provider that spawned the child. */
  readonly provider: "ngrok" | "cloudflare-named";
  /** Reserved endpoint domain (ngrok) or named domain, lowercased. */
  readonly domain: string;
  /** Local HTTP port the tunnel forwards to (command-line marker). */
  readonly localPort: number;
  /** `Date.now()` at spawn, matched against process start time (PID reuse). */
  readonly startedAt: number;
}

/** Sidecar file for one singleton scope, or undefined for non-singleton use. Exported for tests and diagnostics. */
export function tunnelOwnershipFile(resources: readonly string[]): string | undefined {
  if (!resources.length) return undefined;
  const key = [...new Set(resources)].sort().join("\n");
  return path.join(pathLeaseDirectory(), `tunnel-owner-${hash(key).slice(0, 16)}.json`);
}

/** Best-effort write: ownership tracking must never break tunnel startup. */
export function recordTunnelOwnership(resources: readonly string[], record: TunnelOwnershipRecord): void {
  try {
    const file = tunnelOwnershipFile(resources);
    if (!file) return;
    ensurePrivateDirectory(pathLeaseDirectory());
    writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
  } catch {
    /* diagnostics only; the lease itself is the source of truth */
  }
}

function parseTunnelOwnershipRecord(value: unknown): TunnelOwnershipRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.pid !== "number" || !Number.isInteger(record.pid) || record.pid <= 0) return undefined;
  if (typeof record.image !== "string" || !record.image) return undefined;
  if (record.provider !== "ngrok" && record.provider !== "cloudflare-named") return undefined;
  if (typeof record.domain !== "string") return undefined;
  if (typeof record.localPort !== "number" || !Number.isInteger(record.localPort) || record.localPort <= 0) return undefined;
  if (typeof record.startedAt !== "number" || !Number.isFinite(record.startedAt) || record.startedAt <= 0) return undefined;
  return { pid: record.pid, image: record.image, provider: record.provider, domain: record.domain, localPort: record.localPort, startedAt: record.startedAt };
}

/** Best-effort read: a missing or unparseable file yields undefined. */
export function readTunnelOwnership(resources: readonly string[]): TunnelOwnershipRecord | undefined {
  try {
    const file = tunnelOwnershipFile(resources);
    if (!file) return undefined;
    return parseTunnelOwnershipRecord(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return undefined;
  }
}

function removeOwnershipFile(file: string): void {
  try {
    unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Remove the record only when it still names our own pid (never a successor's). */
export function clearTunnelOwnership(resources: readonly string[], pid: number): void {
  try {
    const file = tunnelOwnershipFile(resources);
    if (!file) return;
    if (readTunnelOwnership(resources)?.pid !== pid) return;
    removeOwnershipFile(file);
  } catch {
    /* best-effort */
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH/EINVAL = no such process; EPERM = alive but owned by another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const OWNERSHIP_START_TIME_SKEW_MS = 180_000;

function startTimeMatches(startedAt: number, actualStartMs: number | undefined): boolean {
  if (actualStartMs === undefined || !Number.isFinite(actualStartMs)) return false;
  return Math.abs(actualStartMs - startedAt) <= OWNERSHIP_START_TIME_SKEW_MS;
}

/** Command-line markers proving the candidate serves OUR endpoint (not merely any same-image process). */
function commandLineMatches(provider: "ngrok" | "cloudflare-named", commandLine: string, domain: string, localPort: number): boolean {
  const lower = commandLine.toLowerCase();
  if (provider === "ngrok") {
    return lower.includes(` ${localPort} `) && (domain === "" || lower.includes(domain.toLowerCase()));
  }
  return lower.includes("tunnel") && lower.includes("run");
}

interface CandidateExpectation {
  readonly image: string;
  readonly provider: "ngrok" | "cloudflare-named";
  readonly domain: string;
  readonly localPort: number;
  readonly startedAt: number;
}

interface VerifiedCandidate {
  readonly verified: boolean;
  readonly reason: string;
}

async function verifyCandidateWindows(pid: number, expected: CandidateExpectation): Promise<VerifiedCandidate> {
  let image = "";
  try {
    const { stdout } = await execFileAsync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 10_000 });
    const first = stdout.split("\n").map(line => line.trim()).filter(Boolean)[0] ?? "";
    image = /^"([^"]+)"/.exec(first)?.[1] ?? "";
  } catch {
    return { verified: false, reason: "image lookup failed" };
  }
  if (image.toLowerCase() !== expected.image.toLowerCase()) {
    return { verified: false, reason: `image mismatch (${image || "unknown"} is not ${expected.image})` };
  }
  // One CIM call returns the command line and the creation time; both must match.
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object CommandLine,CreationDate | ConvertTo-Json -Compress)`], { windowsHide: true, timeout: 15_000 });
    const parsed = JSON.parse(stdout) as { CommandLine?: unknown; CreationDate?: unknown };
    const commandLine = typeof parsed.CommandLine === "string" ? parsed.CommandLine : "";
    // PowerShell serialises DateTime as /Date(ms[+zzzz])/.
    const rawDate = typeof parsed.CreationDate === "string" ? parsed.CreationDate : "";
    const createdMs = /\/Date\((\d+)(?:[+-]\d{4})?\)\//.exec(rawDate)?.[1];
    if (!commandLineMatches(expected.provider, commandLine, expected.domain, expected.localPort)) {
      return { verified: false, reason: "command line does not match our endpoint" };
    }
    if (!startTimeMatches(expected.startedAt, createdMs === undefined ? undefined : Number(createdMs))) {
      return { verified: false, reason: "process start time does not match our record (likely PID reuse)" };
    }
    return { verified: true, reason: "image, command line and start time match" };
  } catch {
    return { verified: false, reason: "command-line lookup failed" };
  }
}

async function verifyCandidateLinux(pid: number, expected: CandidateExpectation): Promise<VerifiedCandidate> {
  let commandLine: string;
  let image: string;
  let startMs: number;
  try {
    commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ");
    image = path.basename(readlinkSync(`/proc/${pid}/exe`));
    startMs = statSync(`/proc/${pid}`).mtimeMs;
  } catch {
    return { verified: false, reason: "process vanished during verification" };
  }
  if (image.toLowerCase() !== expected.image.toLowerCase()) {
    return { verified: false, reason: `image mismatch (${image} is not ${expected.image})` };
  }
  if (!commandLineMatches(expected.provider, commandLine, expected.domain, expected.localPort)) {
    return { verified: false, reason: "command line does not match our endpoint" };
  }
  if (!startTimeMatches(expected.startedAt, startMs)) {
    return { verified: false, reason: "process start time does not match our record (likely PID reuse)" };
  }
  return { verified: true, reason: "image, command line and start time match" };
}

function parseElapsedTimeMs(value: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return undefined;
  return ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000;
}

async function verifyCandidateDarwin(pid: number, expected: CandidateExpectation): Promise<VerifiedCandidate> {
  // Single-column queries: multi-column ps output cannot be split reliably
  // because the args column itself contains spaces.
  const query = async (field: string): Promise<string> => {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", `${field}=`], { timeout: 10_000 });
    return stdout.split("\n").map(line => line.trim()).filter(Boolean)[0] ?? "";
  };
  try {
    const comm = await query("comm");
    if (!comm) return { verified: false, reason: "process vanished during verification" };
    if (path.basename(comm).toLowerCase() !== expected.image.toLowerCase()) {
      return { verified: false, reason: `image mismatch (${comm} is not ${expected.image})` };
    }
    if (!commandLineMatches(expected.provider, await query("args"), expected.domain, expected.localPort)) {
      return { verified: false, reason: "command line does not match our endpoint" };
    }
    const elapsedMs = parseElapsedTimeMs(await query("etime"));
    if (elapsedMs === undefined || !startTimeMatches(expected.startedAt, Date.now() - elapsedMs)) {
      return { verified: false, reason: "process start time does not match our record (likely PID reuse)" };
    }
    return { verified: true, reason: "image, command line and start time match" };
  } catch {
    return { verified: false, reason: "process lookup failed" };
  }
}

async function terminateVerifiedCandidate(pid: number): Promise<boolean> {
  const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone or foreign; the alive check below decides */
  }
  await sleep(1_000);
  if (!isPidAlive(pid)) return true;
  try {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    /* fall through to the alive check */
  }
  await sleep(1_000);
  return !isPidAlive(pid);
}

export interface TunnelReclaimOutcome {
  readonly action: "reclaimed" | "skipped" | "failed";
  /** Pid examined (if any record named one). */
  readonly pid?: number;
  /** Human-readable reason for logs and error messages. */
  readonly reason: string;
}

/**
 * Reclaim the previous lease holder's tunnel child after a handover. Call
 * right after acquiring a singleton lease, before spawning: a holder that
 * died without cleanup leaves its tunnel child (and this record) behind, and
 * the child would otherwise linger as an orphan or fight the new tunnel for
 * the same endpoint.
 *
 * Safety: a candidate is terminated only when its pid, image name, endpoint
 * command-line markers AND start time all match our own record — anything
 * unverifiable (foreign user, vanished process, failed lookup) is left alone,
 * honouring the "never kill untracked" policy. Never throws: every internal
 * error maps to `skipped`, except a verified-but-unkillable candidate which
 * maps to `failed` so the caller can fail fast instead of spawning a duelling
 * second agent.
 */
export async function reclaimStaleTunnelOwner(resources: readonly string[], expectedImage: string): Promise<TunnelReclaimOutcome> {
  try {
    const file = tunnelOwnershipFile(resources);
    if (!file) return { action: "skipped", reason: "not a singleton scope" };
    let record: TunnelOwnershipRecord | undefined;
    try {
      record = parseTunnelOwnershipRecord(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      record = undefined;
    }
    if (!record) {
      // Missing file = nobody recorded; corrupt file = self-heal by removing it.
      removeOwnershipFile(file);
      return { action: "skipped", reason: "no ownership record" };
    }
    if (record.pid === process.pid) return { action: "skipped", pid: record.pid, reason: "record names this process" };
    if (!isPidAlive(record.pid)) {
      if (readTunnelOwnership(resources)?.pid === record.pid) removeOwnershipFile(file);
      return { action: "skipped", pid: record.pid, reason: "previous tunnel already exited" };
    }
    const verify = process.platform === "win32" ? verifyCandidateWindows : process.platform === "darwin" ? verifyCandidateDarwin : verifyCandidateLinux;
    const verdict = await verify(record.pid, { image: expectedImage, provider: record.provider, domain: record.domain, localPort: record.localPort, startedAt: record.startedAt });
    if (!verdict.verified) return { action: "skipped", pid: record.pid, reason: verdict.reason };
    if (!await terminateVerifiedCandidate(record.pid)) {
      return { action: "failed", pid: record.pid, reason: `previous tunnel (pid ${record.pid}) is still running and could not be stopped` };
    }
    if (readTunnelOwnership(resources)?.pid === record.pid) removeOwnershipFile(file);
    return { action: "reclaimed", pid: record.pid, reason: verdict.reason };
  } catch (error) {
    return { action: "skipped", reason: `reclaim error: ${error instanceof Error ? error.message : String(error)}` };
  }
}
