"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var bridge_tunnel_lease_exports = {};
__export(bridge_tunnel_lease_exports, {
  BridgeTunnelLeaseConflictError: () => BridgeTunnelLeaseConflictError,
  acquireBridgeTunnelLease: () => acquireBridgeTunnelLease,
  bridgeTunnelLeaseResources: () => bridgeTunnelLeaseResources,
  clearTunnelOwnership: () => clearTunnelOwnership,
  isBridgeTunnelLeaseConflict: () => isBridgeTunnelLeaseConflict,
  pathLeaseDirectory: () => pathLeaseDirectory,
  pathLeaseSocket: () => pathLeaseSocket,
  readTunnelOwnership: () => readTunnelOwnership,
  reclaimStaleTunnelOwner: () => reclaimStaleTunnelOwner,
  recordTunnelOwnership: () => recordTunnelOwnership,
  tunnelOwnershipFile: () => tunnelOwnershipFile
});
module.exports = __toCommonJS(bridge_tunnel_lease_exports);
var import_node_child_process = require("node:child_process");
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_node_net = require("node:net");
var import_node_os = __toESM(require("node:os"));
var import_node_path = __toESM(require("node:path"));
var import_node_util = require("node:util");
const execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
const hash = (value) => (0, import_node_crypto.createHash)("sha256").update(value).digest("hex");
function bridgeTunnelLeaseResources(input) {
  if (input.provider === "cloudflare") return [];
  if (input.provider === "ngrok") {
    const resources2 = ["provider:ngrok"];
    const domain2 = input.configuredDomain;
    if (domain2) resources2.push(`domain:${domain2.trim().toLowerCase()}`);
    return resources2;
  }
  const domain = input.configuredNamedDomain;
  const resources = domain ? [`domain:${domain.trim().toLowerCase()}`] : [];
  if (input.namedTunnelToken) {
    resources.push(`named-credential:${hash(input.namedTunnelToken)}`);
  }
  return resources;
}
function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
  });
}
const uid = () => typeof process.getuid === "function" ? process.getuid() : 0;
function linuxLeaseAddress(resource) {
  return `\0shuncode-bridge-v1-${uid()}-${hash(resource).slice(0, 48)}`;
}
function win32LeaseName(resource) {
  return `\\\\?\\pipe\\shuncode-bridge-v1-${uid()}-${hash(resource).slice(0, 48)}`;
}
function pathLeaseDirectory() {
  const name = `shuncode-lease-${uid()}`;
  const preferred = import_node_path.default.join(import_node_os.default.tmpdir(), name);
  return Buffer.byteLength(preferred) + 1 + 24 + 5 < 104 ? preferred : import_node_path.default.join("/tmp", name);
}
function ensurePrivateDirectory(directory) {
  (0, import_node_fs.mkdirSync)(directory, { recursive: true, mode: 448 });
  if (process.platform === "win32") {
    return;
  }
  const stat = (0, import_node_fs.lstatSync)(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Bridge lease directory ${directory} is not a private directory.`);
  if (stat.uid !== uid()) throw new Error(`Bridge lease directory ${directory} is owned by another user.`);
  if ((stat.mode & 63) !== 0) (0, import_node_fs.chmodSync)(directory, 448);
}
function pathLeaseSocket(resource) {
  return import_node_path.default.join(pathLeaseDirectory(), `${hash(resource).slice(0, 24)}.sock`);
}
function pathLeaseAddress(resource) {
  ensurePrivateDirectory(pathLeaseDirectory());
  return pathLeaseSocket(resource);
}
function listenOnce(server, address) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
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
function probeAlive(address) {
  return new Promise((resolve) => {
    const socket = (0, import_node_net.connect)(address);
    const done = (alive) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(alive);
    };
    socket.once("connect", () => done(true));
    socket.once("error", (error) => done(!(error.code === "ECONNREFUSED" || error.code === "ENOENT")));
    socket.setTimeout(2e3, () => done(true));
  });
}
function fileIdentity(address) {
  try {
    const stat = (0, import_node_fs.lstatSync)(address);
    return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.ctimeMs}`;
  } catch {
    return void 0;
  }
}
async function listenPathLease(server, address, conflictMessage) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await listenOnce(server, address);
      return;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || attempt === 1) {
        throw error.code === "EADDRINUSE" ? new BridgeTunnelLeaseConflictError(conflictMessage) : error;
      }
      const identity = fileIdentity(address);
      if (await probeAlive(address)) throw new BridgeTunnelLeaseConflictError(conflictMessage);
      if (identity !== void 0 && fileIdentity(address) === identity) {
        try {
          (0, import_node_fs.unlinkSync)(address);
        } catch (unlinkError) {
          if (unlinkError.code !== "ENOENT") throw unlinkError;
        }
      }
    }
  }
}
class BridgeTunnelLeaseConflictError extends Error {
  isBridgeTunnelLeaseConflict = true;
  constructor(message) {
    super(message);
    this.name = "BridgeTunnelLeaseConflictError";
  }
}
function isBridgeTunnelLeaseConflict(error) {
  return error instanceof BridgeTunnelLeaseConflictError || typeof error === "object" && error !== null && error.isBridgeTunnelLeaseConflict === true;
}
async function acquireBridgeTunnelLease(resources, conflictMessage = "This fixed Bridge endpoint or Named Tunnel credential is already in use by another ShunCode window. Use a different domain/tunnel, or stop its owning Bridge first. No other process was stopped.") {
  const held = [];
  const kernelReleased = process.platform === "linux" || process.platform === "win32";
  try {
    for (const resource of [...new Set(resources)].sort()) {
      const server = (0, import_node_net.createServer)((socket) => socket.destroy());
      if (kernelReleased) {
        const address = process.platform === "win32" ? win32LeaseName(resource) : linuxLeaseAddress(resource);
        try {
          await listenOnce(server, address);
        } catch (error) {
          throw error.code === "EADDRINUSE" ? new BridgeTunnelLeaseConflictError(conflictMessage) : error;
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
  let releasing;
  return () => releasing ??= Promise.all(held.map(closeServer)).then(() => void 0);
}
function tunnelOwnershipFile(resources) {
  if (!resources.length) return void 0;
  const key = [...new Set(resources)].sort().join("\n");
  return import_node_path.default.join(pathLeaseDirectory(), `tunnel-owner-${hash(key).slice(0, 16)}.json`);
}
function recordTunnelOwnership(resources, record) {
  try {
    const file = tunnelOwnershipFile(resources);
    if (!file) return;
    ensurePrivateDirectory(pathLeaseDirectory());
    (0, import_node_fs.writeFileSync)(file, JSON.stringify(record), { mode: 384 });
  } catch {
  }
}
function parseTunnelOwnershipRecord(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const record = value;
  if (typeof record.pid !== "number" || !Number.isInteger(record.pid) || record.pid <= 0) return void 0;
  if (typeof record.image !== "string" || !record.image) return void 0;
  if (record.provider !== "ngrok" && record.provider !== "cloudflare-named") return void 0;
  if (typeof record.domain !== "string") return void 0;
  if (typeof record.localPort !== "number" || !Number.isInteger(record.localPort) || record.localPort <= 0) return void 0;
  if (typeof record.startedAt !== "number" || !Number.isFinite(record.startedAt) || record.startedAt <= 0) return void 0;
  return { pid: record.pid, image: record.image, provider: record.provider, domain: record.domain, localPort: record.localPort, startedAt: record.startedAt };
}
function readTunnelOwnership(resources) {
  try {
    const file = tunnelOwnershipFile(resources);
    if (!file) return void 0;
    return parseTunnelOwnershipRecord(JSON.parse((0, import_node_fs.readFileSync)(file, "utf8")));
  } catch {
    return void 0;
  }
}
function removeOwnershipFile(file) {
  try {
    (0, import_node_fs.unlinkSync)(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
function clearTunnelOwnership(resources, pid) {
  try {
    const file = tunnelOwnershipFile(resources);
    if (!file) return;
    if (readTunnelOwnership(resources)?.pid !== pid) return;
    removeOwnershipFile(file);
  } catch {
  }
}
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
const OWNERSHIP_START_TIME_SKEW_MS = 18e4;
function startTimeMatches(startedAt, actualStartMs) {
  if (actualStartMs === void 0 || !Number.isFinite(actualStartMs)) return false;
  return Math.abs(actualStartMs - startedAt) <= OWNERSHIP_START_TIME_SKEW_MS;
}
function commandLineMatches(provider, commandLine, domain, localPort) {
  const lower = commandLine.toLowerCase();
  if (provider === "ngrok") {
    return lower.includes(` ${localPort} `) && (domain === "" || lower.includes(domain.toLowerCase()));
  }
  return lower.includes("tunnel") && lower.includes("run");
}
async function verifyCandidateWindows(pid, expected) {
  let image = "";
  try {
    const { stdout } = await execFileAsync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 1e4 });
    const first = stdout.split("\n").map((line) => line.trim()).filter(Boolean)[0] ?? "";
    image = /^"([^"]+)"/.exec(first)?.[1] ?? "";
  } catch {
    return { verified: false, reason: "image lookup failed" };
  }
  if (image.toLowerCase() !== expected.image.toLowerCase()) {
    return { verified: false, reason: `image mismatch (${image || "unknown"} is not ${expected.image})` };
  }
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object CommandLine,CreationDate | ConvertTo-Json -Compress)`], { windowsHide: true, timeout: 15e3 });
    const parsed = JSON.parse(stdout);
    const commandLine = typeof parsed.CommandLine === "string" ? parsed.CommandLine : "";
    const rawDate = typeof parsed.CreationDate === "string" ? parsed.CreationDate : "";
    const createdMs = /\/Date\((\d+)(?:[+-]\d{4})?\)\//.exec(rawDate)?.[1];
    if (!commandLineMatches(expected.provider, commandLine, expected.domain, expected.localPort)) {
      return { verified: false, reason: "command line does not match our endpoint" };
    }
    if (!startTimeMatches(expected.startedAt, createdMs === void 0 ? void 0 : Number(createdMs))) {
      return { verified: false, reason: "process start time does not match our record (likely PID reuse)" };
    }
    return { verified: true, reason: "image, command line and start time match" };
  } catch {
    return { verified: false, reason: "command-line lookup failed" };
  }
}
async function verifyCandidateLinux(pid, expected) {
  let commandLine;
  let image;
  let startMs;
  try {
    commandLine = (0, import_node_fs.readFileSync)(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ");
    image = import_node_path.default.basename((0, import_node_fs.readlinkSync)(`/proc/${pid}/exe`));
    startMs = (0, import_node_fs.statSync)(`/proc/${pid}`).mtimeMs;
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
function parseElapsedTimeMs(value) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return void 0;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return void 0;
  return ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1e3;
}
async function verifyCandidateDarwin(pid, expected) {
  const query = async (field) => {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", `${field}=`], { timeout: 1e4 });
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean)[0] ?? "";
  };
  try {
    const comm = await query("comm");
    if (!comm) return { verified: false, reason: "process vanished during verification" };
    if (import_node_path.default.basename(comm).toLowerCase() !== expected.image.toLowerCase()) {
      return { verified: false, reason: `image mismatch (${comm} is not ${expected.image})` };
    }
    if (!commandLineMatches(expected.provider, await query("args"), expected.domain, expected.localPort)) {
      return { verified: false, reason: "command line does not match our endpoint" };
    }
    const elapsedMs = parseElapsedTimeMs(await query("etime"));
    if (elapsedMs === void 0 || !startTimeMatches(expected.startedAt, Date.now() - elapsedMs)) {
      return { verified: false, reason: "process start time does not match our record (likely PID reuse)" };
    }
    return { verified: true, reason: "image, command line and start time match" };
  } catch {
    return { verified: false, reason: "process lookup failed" };
  }
}
async function terminateVerifiedCandidate(pid) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    process.kill(pid, "SIGTERM");
  } catch {
  }
  await sleep(1e3);
  if (!isPidAlive(pid)) return true;
  try {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 1e4 });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
  }
  await sleep(1e3);
  return !isPidAlive(pid);
}
async function reclaimStaleTunnelOwner(resources, expectedImage) {
  try {
    const file = tunnelOwnershipFile(resources);
    if (!file) return { action: "skipped", reason: "not a singleton scope" };
    let record;
    try {
      record = parseTunnelOwnershipRecord(JSON.parse((0, import_node_fs.readFileSync)(file, "utf8")));
    } catch {
      record = void 0;
    }
    if (!record) {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BridgeTunnelLeaseConflictError,
  acquireBridgeTunnelLease,
  bridgeTunnelLeaseResources,
  clearTunnelOwnership,
  isBridgeTunnelLeaseConflict,
  pathLeaseDirectory,
  pathLeaseSocket,
  readTunnelOwnership,
  reclaimStaleTunnelOwner,
  recordTunnelOwnership,
  tunnelOwnershipFile
});
