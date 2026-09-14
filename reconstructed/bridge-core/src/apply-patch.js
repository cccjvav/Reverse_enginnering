// RECONSTRUCTED from src/apply-patch.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.
// SECURITY LIMIT: path-based writes/rollback are not race-free; see ../PATCH_WRITER.md.
import { createCanonicalUnifiedDiff } from './canonical-diff.js';
import { canonicalizeWorkspaceRoots, literalFirstPathSpellings } from './workspace-paths.js';

import * as import_node_crypto3 from "node:crypto";

import * as import_promises2 from "node:fs/promises";

import * as import_node_path from "node:path";

var DEFAULT_APPLY_PATCH_CONFIG = {
  maxPatchBytes: 256 * 1024,
  maxOperations: 50,
  maxFiles: 20,
  maxFileBytes: 10 * 1024 * 1024,
  maxDiffBytes: 64 * 1024
};

var PatchToolError = class extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
  code;
};

var Mutex = class {
  tail = Promise.resolve();
  async acquire() {
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => current);
    await previous;
    return release;
  }
};

var fileLocks = /* @__PURE__ */ new Map();

function lockFor(filePath) {
  let mutex = fileLocks.get(filePath);
  if (!mutex) {
    mutex = new Mutex();
    fileLocks.set(filePath, mutex);
  }
  return mutex;
}

async function withFileLocks(paths, fn) {
  const releases = [];
  const keys = [...new Set(paths)].sort((a, b) => a.localeCompare(b));
  try {
    for (const key of keys) releases.push(await lockFor(key).acquire());
    return await fn();
  } finally {
    for (let index = releases.length - 1; index >= 0; index -= 1) releases[index]();
  }
}

function hashBytes(bytes) {
  return `sha256:${(0, import_node_crypto3.createHash)("sha256").update(bytes).digest("hex")}`;
}

function pathIdentity(filePath) {
  return filePath;
}

function isInsideRoot(root, target) {
  const relative = import_node_path.default.relative(root, target);
  return relative === "" || !relative.startsWith(`..${import_node_path.default.sep}`) && relative !== ".." && !import_node_path.default.isAbsolute(relative);
}

async function canonicalRoots(roots) {
  return canonicalizeWorkspaceRoots(
    roots,
    (message) => new PatchToolError("PATH_OUTSIDE_WORKSPACE", message)
  );
}

async function resolveExistingPath(requestedPath, roots) {
  const spellings = literalFirstPathSpellings(requestedPath);
  for (const spelling of spellings) {
    try {
      return await resolveExistingPathSpelling(spelling, roots);
    } catch (error2) {
      if (!(error2 instanceof PatchToolError) || error2.code !== "FILE_NOT_FOUND") throw error2;
    }
  }
  throw new PatchToolError("FILE_NOT_FOUND", `${requestedPath} does not exist.`);
}

async function resolveExistingPathSpelling(requestedPath, roots) {
  const canonical = await canonicalRoots(roots);
  const candidates = import_node_path.default.isAbsolute(requestedPath) ? [requestedPath] : canonical.map((root) => import_node_path.default.resolve(root, requestedPath));
  let sawMissing = false;
  for (const candidate of candidates) {
    try {
      const target = await (0, import_promises2.realpath)(candidate);
      const root = canonical.find((candidateRoot) => isInsideRoot(candidateRoot, target));
      if (!root) continue;
      const targetStat = await (0, import_promises2.stat)(target);
      if (!targetStat.isFile()) throw new PatchToolError("NOT_A_FILE", `${requestedPath} is not a regular file.`);
      return { requestedPath, absolutePath: target, root, mode: targetStat.mode };
    } catch (error2) {
      if (error2 instanceof PatchToolError) throw error2;
      const code = error2.code;
      if (code === "ENOENT") {
        sawMissing = true;
        continue;
      }
      if (code === "EACCES" || code === "EPERM") {
        throw new PatchToolError("PERMISSION_DENIED", `Permission denied while resolving ${requestedPath}.`);
      }
      throw error2;
    }
  }
  if (sawMissing) throw new PatchToolError("FILE_NOT_FOUND", `${requestedPath} does not exist.`);
  throw new PatchToolError("PATH_OUTSIDE_WORKSPACE", `${requestedPath} resolves outside the allowed workspace roots.`);
}

async function resolveNewPath(requestedPath, roots) {
  const canonical = await canonicalRoots(roots);
  const candidates = import_node_path.default.isAbsolute(requestedPath) ? [import_node_path.default.resolve(requestedPath)] : canonical.map((root) => import_node_path.default.resolve(root, requestedPath));
  for (const candidate of candidates) {
    const parent = import_node_path.default.dirname(candidate);
    try {
      const realParent = await (0, import_promises2.realpath)(parent);
      const root = canonical.find((candidateRoot) => isInsideRoot(candidateRoot, realParent));
      if (!root) continue;
      const absolutePath = import_node_path.default.join(realParent, import_node_path.default.basename(candidate));
      if (!isInsideRoot(root, absolutePath)) continue;
      return { requestedPath, absolutePath, root };
    } catch (error2) {
      const code = error2.code;
      if (code === "ENOENT") continue;
      if (code === "EACCES" || code === "EPERM") {
        throw new PatchToolError("PERMISSION_DENIED", `Permission denied while resolving parent directory for ${requestedPath}.`);
      }
      throw error2;
    }
  }
  throw new PatchToolError(
    "PATH_OUTSIDE_WORKSPACE",
    `${requestedPath} has no existing parent directory inside the allowed workspace roots.`
  );
}

async function pathExists(filePath) {
  try {
    await (0, import_promises2.access)(filePath);
    return true;
  } catch (error2) {
    if (error2.code === "ENOENT") return false;
    throw error2;
  }
}

function decodeSnapshot(bytes, config2, displayPath3) {
  if (bytes.length > config2.maxFileBytes) {
    throw new PatchToolError("FILE_TOO_LARGE", `${displayPath3} is larger than the ${config2.maxFileBytes}-byte patch limit.`);
  }
  if (bytes.includes(0)) throw new PatchToolError("BINARY_FILE", `${displayPath3} appears to be binary.`);
  const bom = bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191;
  const payload = bom ? bytes.subarray(3) : bytes;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    throw new PatchToolError("UNSUPPORTED_ENCODING", `${displayPath3} is not valid UTF-8 text.`);
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const endsWithNewline = normalized.endsWith("\n");
  const body = endsWithNewline ? normalized.slice(0, -1) : normalized;
  const lines = body.length > 0 ? body.split("\n") : normalized.length > 0 ? [""] : [];
  return {
    bytes,
    text: normalized,
    lines,
    endsWithNewline,
    eol,
    bom,
    version: hashBytes(bytes)
  };
}

function encodeText(lines, endsWithNewline, eol, bom) {
  let normalized = lines.join("\n");
  if (endsWithNewline) normalized += "\n";
  const text = eol === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
  const body = Buffer.from(text, "utf8");
  return bom ? Buffer.concat([Buffer.from([239, 187, 191]), body]) : body;
}

function normalizePatchPath(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0")) throw new PatchToolError("INVALID_PATCH", "Patch paths must be non-empty.");
  return trimmed;
}

function parsePatch(patchText, config2) {
  if (Buffer.byteLength(patchText, "utf8") > config2.maxPatchBytes) {
    throw new PatchToolError("PATCH_TOO_LARGE", `Patch exceeds ${config2.maxPatchBytes} bytes.`);
  }
  const normalized = patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "*** Begin Patch") throw new PatchToolError("INVALID_PATCH", "Patch must start with '*** Begin Patch'.");
  const endIndex = lines.lastIndexOf("*** End Patch");
  if (endIndex < 1) throw new PatchToolError("INVALID_PATCH", "Patch must end with '*** End Patch'.");
  if (lines.slice(endIndex + 1).some((line) => line.trim().length > 0)) {
    throw new PatchToolError("INVALID_PATCH", "Unexpected content after '*** End Patch'.");
  }
  const operations = [];
  let index = 1;
  while (index < endIndex) {
    const line = lines[index];
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    if (line.startsWith("*** Add File: ")) {
      const filePath = normalizePatchPath(line.slice("*** Add File: ".length));
      index += 1;
      const content = [];
      while (index < endIndex && !lines[index].startsWith("*** ")) {
        const row = lines[index];
        if (!row.startsWith("+")) {
          throw new PatchToolError("INVALID_PATCH", `Add File lines must start with '+': ${row}`);
        }
        content.push(row.slice(1));
        index += 1;
      }
      operations.push({ action: "add", path: filePath, lines: content });
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      const filePath = normalizePatchPath(line.slice("*** Delete File: ".length));
      operations.push({ action: "delete", path: filePath });
      index += 1;
      continue;
    }
    if (line.startsWith("*** Update File: ")) {
      const filePath = normalizePatchPath(line.slice("*** Update File: ".length));
      index += 1;
      let moveTo;
      if (index < endIndex && lines[index].startsWith("*** Move to: ")) {
        moveTo = normalizePatchPath(lines[index].slice("*** Move to: ".length));
        index += 1;
      }
      const hunks = [];
      while (index < endIndex && !lines[index].startsWith("*** Add File: ") && !lines[index].startsWith("*** Delete File: ") && !lines[index].startsWith("*** Update File: ")) {
        if (lines[index].trim().length === 0) {
          index += 1;
          continue;
        }
        if (!lines[index].startsWith("@@")) {
          throw new PatchToolError("INVALID_PATCH", `Expected '@@' hunk header while updating ${filePath}.`);
        }
        index += 1;
        const oldLines = [];
        const newLines = [];
        let additions = 0;
        let deletions = 0;
        let endOfFile = false;
        while (index < endIndex) {
          const row = lines[index];
          if (row.startsWith("@@") || row.startsWith("*** Add File: ") || row.startsWith("*** Delete File: ") || row.startsWith("*** Update File: ")) break;
          if (row === "*** End of File") {
            endOfFile = true;
            index += 1;
            break;
          }
          if (row.startsWith("*** Move to: ")) {
            throw new PatchToolError("INVALID_PATCH", "'*** Move to:' must appear immediately after '*** Update File:'.");
          }
          if (row.length === 0) {
            throw new PatchToolError("INVALID_PATCH", "Patch hunk lines must start with a space, '+' or '-'.");
          }
          const marker = row[0];
          const content = row.slice(1);
          if (marker === " ") {
            oldLines.push(content);
            newLines.push(content);
          } else if (marker === "-") {
            oldLines.push(content);
            deletions += 1;
          } else if (marker === "+") {
            newLines.push(content);
            additions += 1;
          } else {
            throw new PatchToolError("INVALID_PATCH", `Unsupported patch hunk line: ${row}`);
          }
          index += 1;
        }
        if (oldLines.length === 0) {
          throw new PatchToolError(
            "INVALID_PATCH",
            `Update hunk for ${filePath} has no old/context lines. Include exact surrounding context so the edit can be located safely.`
          );
        }
        hunks.push({ oldLines, newLines, additions, deletions, endOfFile });
      }
      if (hunks.length === 0 && !moveTo) {
        throw new PatchToolError("INVALID_PATCH", `Update File ${filePath} must contain at least one hunk or a move destination.`);
      }
      operations.push({ action: "update", path: filePath, moveTo, hunks });
      continue;
    }
    throw new PatchToolError("INVALID_PATCH", `Unsupported patch directive: ${line}`);
  }
  if (operations.length === 0) throw new PatchToolError("INVALID_PATCH", "Patch contains no file operations.");
  if (operations.length > config2.maxOperations) {
    throw new PatchToolError("TOO_MANY_OPERATIONS", `Patch has ${operations.length} operations; maximum is ${config2.maxOperations}.`);
  }
  const touched = /* @__PURE__ */ new Set();
  for (const operation of operations) {
    const source = pathIdentity(operation.path);
    if (touched.has(source)) throw new PatchToolError("INVALID_PATCH", `Patch touches ${operation.path} more than once.`);
    touched.add(source);
    if (operation.action === "update" && operation.moveTo) {
      const destination = pathIdentity(operation.moveTo);
      if (touched.has(destination)) throw new PatchToolError("INVALID_PATCH", `Patch destination ${operation.moveTo} is touched more than once.`);
      touched.add(destination);
    }
  }
  if (touched.size > config2.maxFiles) {
    throw new PatchToolError("TOO_MANY_FILES", `Patch touches ${touched.size} paths; maximum is ${config2.maxFiles}.`);
  }
  return operations;
}

function findSequence(lines, needle, requireEndOfFile) {
  const candidates = [];
  for (let start = 0; start + needle.length <= lines.length; start += 1) {
    if (requireEndOfFile && start + needle.length !== lines.length) continue;
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (lines[start + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) candidates.push(start);
  }
  if (candidates.length === 0) return -1;
  if (candidates.length > 1) return -2;
  return candidates[0];
}

function applyHunks(filePath, snapshot, hunks) {
  const lines = [...snapshot.lines];
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    const start = findSequence(lines, hunk.oldLines, hunk.endOfFile);
    if (start === -1) {
      throw new PatchToolError(
        "PATCH_CONTEXT_NOT_FOUND",
        `Could not find the exact hunk context in ${filePath}. Re-read the file and regenerate the patch against the current content.`
      );
    }
    if (start === -2) {
      throw new PatchToolError(
        "PATCH_CONTEXT_AMBIGUOUS",
        `Hunk context matches multiple locations in ${filePath}. Include more unchanged context around the edit.`
      );
    }
    lines.splice(start, hunk.oldLines.length, ...hunk.newLines);
    additions += hunk.additions;
    deletions += hunk.deletions;
  }
  return { lines, additions, deletions };
}

function normalizedExpectedVersions(input) {
  const map = /* @__PURE__ */ new Map();
  for (const [filePath, version2] of Object.entries(input.expected_versions ?? {})) {
    if (typeof version2 !== "string" || !version2.startsWith("sha256:")) {
      throw new PatchToolError("INVALID_PATCH", `expected_versions[${filePath}] must be a sha256:... version string.`);
    }
    const key = pathIdentity(filePath);
    const previous = map.get(key);
    if (previous && previous !== version2) {
      throw new PatchToolError("INVALID_PATCH", `expected_versions contains conflicting versions for ${filePath}.`);
    }
    map.set(key, version2);
  }
  return map;
}

function expectedVersionForSource(expected, operationPath, resolvedSpelling, canonicalAbsolutePath, canonicalWorkspacePath) {
  const keys = [
    ...new Set(
      [operationPath, resolvedSpelling, canonicalAbsolutePath, canonicalWorkspacePath].map(pathIdentity)
    )
  ];
  const versions = [...new Set(keys.map((key) => expected.get(key)).filter((value) => value !== void 0))];
  if (versions.length > 1) {
    throw new PatchToolError(
      "INVALID_PATCH",
      `expected_versions contains conflicting versions for alternate spellings of ${operationPath}.`
    );
  }
  return versions[0];
}

async function loadSnapshot(filePath, displayPath3, config2) {
  return decodeSnapshot(await (0, import_promises2.readFile)(filePath), config2, displayPath3);
}

async function preflight(operations, input, context, config2) {
  const expected = normalizedExpectedVersions(input);
  const plans = [];
  const lockPaths = [];
  const claimedPaths = /* @__PURE__ */ new Map();
  const claimPath = (absolutePath, displayPath3) => {
    const key = pathIdentity(absolutePath);
    const previous = claimedPaths.get(key);
    if (previous) {
      throw new PatchToolError(
        "INVALID_PATCH",
        `Patch paths ${previous} and ${displayPath3} resolve to the same filesystem path.`
      );
    }
    claimedPaths.set(key, displayPath3);
  };
  for (const operation of operations) {
    if (context.signal?.aborted) throw new DOMException("Patch application was cancelled.", "AbortError");
    if (operation.action === "add") {
      const destination = await resolveNewPath(operation.path, context.workspaceRoots);
      claimPath(destination.absolutePath, operation.path);
      lockPaths.push(destination.absolutePath);
      if (context.checkPermission && !await context.checkPermission(destination.absolutePath)) {
        throw new PatchToolError("PERMISSION_DENIED", `Creating ${operation.path} is not permitted by the current policy.`);
      }
      if (await pathExists(destination.absolutePath)) {
        throw new PatchToolError("FILE_ALREADY_EXISTS", `${operation.path} already exists.`);
      }
      const newBytes2 = encodeText(operation.lines, operation.lines.length > 0, "\n", false);
      plans.push({
        action: "add",
        destinationPath: destination.absolutePath,
        sourceDisplay: operation.path,
        oldVersion: null,
        newVersion: hashBytes(newBytes2),
        newBytes: newBytes2,
        additions: operation.lines.length,
        deletions: 0
      });
      continue;
    }
    const source = await resolveExistingPath(operation.path, context.workspaceRoots);
    claimPath(source.absolutePath, operation.path);
    lockPaths.push(source.absolutePath);
    if (context.checkPermission && !await context.checkPermission(source.absolutePath)) {
      throw new PatchToolError("PERMISSION_DENIED", `Modifying ${operation.path} is not permitted by the current policy.`);
    }
    const snapshot = await loadSnapshot(source.absolutePath, operation.path, config2);
    const canonicalWorkspacePath = import_node_path.default.relative(source.root, source.absolutePath).split(import_node_path.default.sep).join("/") || ".";
    const expectedVersion = expectedVersionForSource(
      expected,
      operation.path,
      source.requestedPath,
      source.absolutePath,
      canonicalWorkspacePath
    );
    if (expectedVersion && snapshot.version !== expectedVersion) {
      throw new PatchToolError(
        "STALE_FILE",
        `${operation.path} changed since it was read. Expected ${expectedVersion}, current ${snapshot.version}. Re-read before patching.`
      );
    }
    if (operation.action === "delete") {
      plans.push({
        action: "delete",
        sourcePath: source.absolutePath,
        sourceDisplay: operation.path,
        oldBytes: snapshot.bytes,
        oldMode: source.mode,
        oldVersion: snapshot.version,
        newVersion: null,
        additions: 0,
        deletions: snapshot.lines.length
      });
      continue;
    }
    const applied = applyHunks(operation.path, snapshot, operation.hunks);
    const newBytes = encodeText(applied.lines, snapshot.endsWithNewline, snapshot.eol, snapshot.bom);
    if (operation.moveTo) {
      const destination = await resolveNewPath(operation.moveTo, context.workspaceRoots);
      claimPath(destination.absolutePath, operation.moveTo);
      lockPaths.push(destination.absolutePath);
      if (context.checkPermission && !await context.checkPermission(destination.absolutePath)) {
        throw new PatchToolError("PERMISSION_DENIED", `Moving to ${operation.moveTo} is not permitted by the current policy.`);
      }
      if (await pathExists(destination.absolutePath)) {
        throw new PatchToolError("FILE_ALREADY_EXISTS", `${operation.moveTo} already exists.`);
      }
      plans.push({
        action: "move",
        sourcePath: source.absolutePath,
        destinationPath: destination.absolutePath,
        sourceDisplay: operation.path,
        destinationDisplay: operation.moveTo,
        oldBytes: snapshot.bytes,
        newBytes,
        oldMode: source.mode,
        oldVersion: snapshot.version,
        newVersion: hashBytes(newBytes),
        additions: applied.additions,
        deletions: applied.deletions
      });
    } else {
      plans.push({
        action: "update",
        sourcePath: source.absolutePath,
        sourceDisplay: operation.path,
        oldBytes: snapshot.bytes,
        newBytes,
        oldMode: source.mode,
        oldVersion: snapshot.version,
        newVersion: hashBytes(newBytes),
        additions: applied.additions,
        deletions: applied.deletions
      });
    }
  }
  return { plans, lockPaths };
}

async function assertSourceUnchanged(plan) {
  if (!plan.sourcePath || !plan.oldVersion) return;
  const current = await (0, import_promises2.readFile)(plan.sourcePath);
  const currentVersion = hashBytes(current);
  if (currentVersion !== plan.oldVersion) {
    throw new PatchToolError(
      "STALE_FILE",
      `${plan.sourceDisplay} changed during patch preflight. Expected ${plan.oldVersion}, current ${currentVersion}. Re-read and retry.`
    );
  }
}

function tempPathFor(targetPath) {
  return import_node_path.default.join(
    import_node_path.default.dirname(targetPath),
    `.${import_node_path.default.basename(targetPath)}.shuncode-${process.pid}-${(0, import_node_crypto3.randomUUID)()}.tmp`
  );
}

async function stageBytes(targetPath, bytes, mode) {
  const tempPath = tempPathFor(targetPath);
  const handle = await (0, import_promises2.open)(tempPath, "wx", mode === void 0 ? 438 : mode & 511);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error2) {
    await handle.close().catch(() => void 0);
    await (0, import_promises2.unlink)(tempPath).catch(() => void 0);
    throw error2;
  }
  await handle.close();
  return tempPath;
}

async function stagePlans(plans) {
  const staged = [];
  try {
    for (const plan of plans) {
      if (!plan.newBytes) continue;
      const targetPath = plan.action === "update" ? plan.sourcePath : plan.destinationPath;
      const tempPath = await stageBytes(targetPath, plan.newBytes, plan.oldMode);
      staged.push({ plan, targetPath, tempPath });
    }
    return staged;
  } catch (error2) {
    await Promise.all(staged.map((entry) => (0, import_promises2.unlink)(entry.tempPath).catch(() => void 0)));
    throw error2;
  }
}

function stagedFor(plan, staged) {
  const entry = staged.find((candidate) => candidate.plan === plan);
  if (!entry) throw new PatchToolError("IO_ERROR", `Missing staged content for ${plan.sourceDisplay}.`);
  return entry;
}

async function installNewFromStage(entry) {
  await (0, import_promises2.link)(entry.tempPath, entry.targetPath);
  await (0, import_promises2.unlink)(entry.tempPath);
}

async function replaceExistingFromStage(entry) {
  await (0, import_promises2.rename)(entry.tempPath, entry.targetPath);
}

async function restoreExistingFile(filePath, bytes, mode) {
  const tempPath = await stageBytes(filePath, bytes, mode);
  try {
    await (0, import_promises2.rename)(tempPath, filePath);
  } finally {
    await (0, import_promises2.unlink)(tempPath).catch(() => void 0);
  }
}

async function restoreMissingFile(filePath, bytes, mode) {
  const tempPath = await stageBytes(filePath, bytes, mode);
  try {
    await (0, import_promises2.link)(tempPath, filePath);
  } finally {
    await (0, import_promises2.unlink)(tempPath).catch(() => void 0);
  }
}

async function rollbackPlans(completed) {
  const failures = [];
  for (let index = completed.length - 1; index >= 0; index -= 1) {
    const plan = completed[index];
    try {
      if (plan.action === "update") {
        await restoreExistingFile(plan.sourcePath, plan.oldBytes, plan.oldMode);
      } else if (plan.action === "add") {
        if (await pathExists(plan.destinationPath)) await (0, import_promises2.unlink)(plan.destinationPath);
      } else if (plan.action === "delete") {
        await restoreMissingFile(plan.sourcePath, plan.oldBytes, plan.oldMode);
      } else {
        if (await pathExists(plan.destinationPath)) await (0, import_promises2.unlink)(plan.destinationPath);
        if (!await pathExists(plan.sourcePath)) {
          await restoreMissingFile(plan.sourcePath, plan.oldBytes, plan.oldMode);
        }
      }
    } catch (error2) {
      failures.push(`${plan.sourceDisplay}: ${error2.message}`);
    }
  }
  if (failures.length > 0) {
    throw new PatchToolError("ROLLBACK_FAILED", `Patch failed and rollback was incomplete: ${failures.join("; ")}`);
  }
}

async function commitPlans(plans, signal) {
  const staged = await stagePlans(plans);
  const completed = [];
  try {
    for (const plan of plans) {
      if (signal?.aborted) throw new DOMException("Patch application was cancelled.", "AbortError");
      if (plan.action === "update") {
        await assertSourceUnchanged(plan);
        await replaceExistingFromStage(stagedFor(plan, staged));
      } else if (plan.action === "add") {
        await installNewFromStage(stagedFor(plan, staged));
      } else if (plan.action === "delete") {
        await assertSourceUnchanged(plan);
        await (0, import_promises2.unlink)(plan.sourcePath);
      } else {
        await assertSourceUnchanged(plan);
        const entry = stagedFor(plan, staged);
        await installNewFromStage(entry);
        try {
          await (0, import_promises2.unlink)(plan.sourcePath);
        } catch (error2) {
          await (0, import_promises2.unlink)(plan.destinationPath).catch(() => void 0);
          throw error2;
        }
      }
      completed.push(plan);
    }
  } catch (error2) {
    try {
      await rollbackPlans(completed);
    } catch (rollbackError) {
      throw rollbackError;
    }
    throw error2;
  } finally {
    await Promise.all(staged.map((entry) => (0, import_promises2.unlink)(entry.tempPath).catch(() => void 0)));
  }
}

function truncateUtf8(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid), "utf8") <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return { text: `${text.slice(0, low)}
... <diff truncated>`, truncated: true };
}

function normalizeError(error2) {
  if (error2 instanceof PatchToolError) throw error2;
  if (error2?.name === "AbortError") throw new PatchToolError("ABORTED", "Patch application was cancelled.");
  const code = error2?.code;
  if (code === "ENOENT") throw new PatchToolError("FILE_NOT_FOUND", "A patch target disappeared during application.");
  if (code === "EACCES" || code === "EPERM") throw new PatchToolError("PERMISSION_DENIED", "Permission denied while applying patch.");
  throw new PatchToolError("IO_ERROR", error2?.message || "Unexpected patch I/O error.");
}

async function applyPatch(input, context) {
  const config2 = { ...DEFAULT_APPLY_PATCH_CONFIG, ...context.config };
  try {
    if (!input || typeof input.patch !== "string" || input.patch.length === 0) {
      throw new PatchToolError("INVALID_PATCH", "patch must be a non-empty string.");
    }
    const operations = parsePatch(input.patch, config2);
    const initial = await preflight(operations, input, context, config2);
    return await withFileLocks(initial.lockPaths, async () => {
      const locked = await preflight(operations, input, context, config2);
      const canonicalDiff = createCanonicalUnifiedDiff(
        locked.plans.map((plan) => ({
          action: plan.action,
          old_path: plan.action === "add" ? void 0 : plan.sourceDisplay,
          new_path: plan.action === "delete" ? void 0 : plan.destinationDisplay ?? plan.sourceDisplay,
          old_bytes: plan.oldBytes,
          new_bytes: plan.newBytes
        }))
      );
      await commitPlans(locked.plans, context.signal);
      const files = locked.plans.map((plan) => ({
        action: plan.action,
        path: plan.sourceDisplay,
        ...plan.destinationDisplay ? { destination_path: plan.destinationDisplay } : {},
        old_version: plan.oldVersion,
        new_version: plan.newVersion,
        additions: plan.additions,
        deletions: plan.deletions
      }));
      const diff = truncateUtf8(canonicalDiff, config2.maxDiffBytes);
      return {
        status: "success",
        files,
        summary: {
          files_changed: files.length,
          additions: files.reduce((sum, file) => sum + file.additions, 0),
          deletions: files.reduce((sum, file) => sum + file.deletions, 0)
        },
        diff: diff.text,
        diff_truncated: diff.truncated,
        diff_format: "unified",
        diff_source: "runtime_old_vs_new",
        commit_strategy: "staged_atomic_per_file",
        multi_file_atomic: false
      };
    });
  } catch (error2) {
    return normalizeError(error2);
  }
}

function formatApplyPatchForModel(result) {
  const parts = [
    "=== APPLY_PATCH BEGIN ===",
    `status: ${result.status}`,
    `files_changed: ${result.summary.files_changed}`,
    `additions: ${result.summary.additions}`,
    `deletions: ${result.summary.deletions}`,
    `diff_format: ${result.diff_format}`,
    `diff_source: ${result.diff_source}`,
    `commit_strategy: ${result.commit_strategy}`,
    `multi_file_atomic: ${result.multi_file_atomic}`
  ];
  for (const file of result.files) {
    parts.push(
      "--- FILE ---",
      `action: ${file.action}`,
      `path: ${JSON.stringify(file.path)}`,
      ...file.destination_path ? [`destination_path: ${JSON.stringify(file.destination_path)}`] : [],
      `old_version: ${file.old_version ?? "null"}`,
      `new_version: ${file.new_version ?? "null"}`,
      `additions: ${file.additions}`,
      `deletions: ${file.deletions}`
    );
  }
  parts.push("--- CANONICAL APPLIED DIFF ---", result.diff);
  if (result.diff_truncated) parts.push("NOTE: Diff display was truncated; the patch itself was applied in full.");
  parts.push("=== APPLY_PATCH END ===");
  return parts.join("\n");
}

export { DEFAULT_APPLY_PATCH_CONFIG, Mutex, PatchToolError, applyHunks, applyPatch, assertSourceUnchanged, canonicalRoots, commitPlans, decodeSnapshot, encodeText, expectedVersionForSource, fileLocks, findSequence, formatApplyPatchForModel, hashBytes, import_node_crypto3, import_node_path, import_promises2, installNewFromStage, isInsideRoot, loadSnapshot, lockFor, normalizeError, normalizePatchPath, normalizedExpectedVersions, parsePatch, pathExists, pathIdentity, preflight, replaceExistingFromStage, resolveExistingPath, resolveExistingPathSpelling, resolveNewPath, restoreExistingFile, restoreMissingFile, rollbackPlans, stageBytes, stagePlans, stagedFor, tempPathFor, truncateUtf8, withFileLocks };
