// Community checkpoint mitigation; NOT included in the installer overlay.
// Based on reconstructed/bridge-core/src/read-files.js; original evidence unchanged.
// Reduces the approval-wait race, but does not provide race-free path containment.
import { canonicalizeWorkspaceRoots, literalFirstPathSpellings } from '../../reconstructed/bridge-core/src/workspace-paths.js';

import * as import_node_crypto4 from "node:crypto";

import * as import_node_fs from "node:fs";

import * as import_promises4 from "node:fs/promises";

import * as import_node_path3 from "node:path";

var DEFAULT_READ_FILES_CONFIG = {
  maxFilesPerCall: 20,
  concurrency: 8,
  maxLinesPerFile: 2e3,
  maxBytesPerFile: 64 * 1024,
  maxEstimatedTokensPerFile: 16e3,
  maxLineChars: 4e3,
  maxTotalBytesPerCall: 256 * 1024,
  maxEstimatedTokensPerCall: 5e4,
  veryLargeFileBytes: 2 * 1024 * 1024,
  binaryProbeBytes: 8 * 1024
};

var ReadToolError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function validateRange(request) {
  const { start_line: start, end_line: end } = request;
  if (start !== void 0 && (!Number.isInteger(start) || start < 1)) {
    throw new ReadToolError("INVALID_LINE_RANGE", "start_line must be an integer greater than or equal to 1.");
  }
  if (end !== void 0 && (!Number.isInteger(end) || end < 1)) {
    throw new ReadToolError("INVALID_LINE_RANGE", "end_line must be an integer greater than or equal to 1.");
  }
  if (end !== void 0 && start !== void 0 && end < start) {
    throw new ReadToolError("INVALID_LINE_RANGE", "end_line must be greater than or equal to start_line.");
  }
}

function isInsideRoot3(root, target) {
  const relative = import_node_path3.default.relative(root, target);
  return relative === "" || !relative.startsWith(`..${import_node_path3.default.sep}`) && relative !== ".." && !import_node_path3.default.isAbsolute(relative);
}

async function resolveSafePath(requestedPath, roots) {
  const canonicalRoots4 = await canonicalizeWorkspaceRoots(
    roots,
    (message) => new ReadToolError("PATH_OUTSIDE_WORKSPACE", message)
  );
  for (const spelling of literalFirstPathSpellings(requestedPath)) {
    const candidates = import_node_path3.default.isAbsolute(spelling) ? [spelling] : canonicalRoots4.map((root) => import_node_path3.default.resolve(root, spelling));
    let sawMissing = false;
    let sawOutside = false;
    for (const candidate of candidates) {
      try {
        const canonicalTarget = await (0, import_promises4.realpath)(candidate);
        const root = canonicalRoots4.find((candidateRoot) => isInsideRoot3(candidateRoot, canonicalTarget));
        if (root) return { realPath: canonicalTarget, root };
        sawOutside = true;
      } catch (error2) {
        const code = error2.code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          sawMissing = true;
          continue;
        }
        if (code === "EACCES" || code === "EPERM") {
          throw new ReadToolError("PERMISSION_DENIED", "Permission denied while resolving the requested path.");
        }
        throw error2;
      }
    }
    if (sawOutside) {
      throw new ReadToolError("PATH_OUTSIDE_WORKSPACE", "Requested path resolves outside the allowed workspace roots.");
    }
    if (!sawMissing) break;
  }
  throw new ReadToolError("FILE_NOT_FOUND", "File does not exist.");
}

async function appearsBinary(filePath, probeBytes) {
  const handle = await (0, import_promises4.open)(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(probeBytes);
    const { bytesRead } = await handle.read(buffer, 0, probeBytes, 0);
    if (bytesRead === 0) return false;
    let suspicious = 0;
    for (let i = 0; i < bytesRead; i += 1) {
      const byte = buffer[i];
      if (byte === 0) return true;
      const isAllowedControl = byte === 9 || byte === 10 || byte === 13;
      if (byte < 32 && !isAllowedControl || byte === 127) suspicious += 1;
    }
    return suspicious / bytesRead > 0.1;
  } finally {
    await handle.close();
  }
}

async function readTextRange(filePath, request, config2, signal) {
  const startLine = request.start_line ?? 1;
  const requestedEnd = request.end_line ?? null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const hash2 = (0, import_node_crypto4.createHash)("sha256");
  const lines = [];
  const truncatedLineNumbers = [];
  let pending = "";
  let totalLines = 0;
  let returnedBytes = 0;
  let estimatedTokenCount = 0;
  let budgetTruncated = false;
  let firstDecodedChunk = true;
  const considerLine = (rawLine, lineNumber) => {
    const inRequestedRange = lineNumber >= startLine && (requestedEnd === null || lineNumber <= requestedEnd);
    if (!inRequestedRange || budgetTruncated) return;
    let line = rawLine;
    if (line.length > config2.maxLineChars) {
      line = `${line.slice(0, config2.maxLineChars)} \u2026 <line truncated>`;
      truncatedLineNumbers.push(lineNumber);
    }
    const formatted = `${lineNumber}: ${line}`;
    const candidateBytes = Buffer.byteLength(formatted + "\n", "utf8");
    const candidateTokens = estimateTokens(formatted + "\n");
    const wouldExceed = lines.length >= config2.maxLinesPerFile || returnedBytes + candidateBytes > config2.maxBytesPerFile || estimatedTokenCount + candidateTokens > config2.maxEstimatedTokensPerFile;
    if (wouldExceed) {
      budgetTruncated = true;
      return;
    }
    lines.push(formatted);
    returnedBytes += candidateBytes;
    estimatedTokenCount += candidateTokens;
  };
  const processDecodedText = (text) => {
    if (text.length === 0) return;
    pending += text;
    while (true) {
      const newlineIndex = pending.indexOf("\n");
      if (newlineIndex < 0) break;
      let line = pending.slice(0, newlineIndex);
      pending = pending.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      totalLines += 1;
      considerLine(line, totalLines);
    }
  };
  try {
    const stream = (0, import_node_fs.createReadStream)(filePath, { signal });
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash2.update(buffer);
      let decoded = decoder.decode(buffer, { stream: true });
      if (firstDecodedChunk) {
        firstDecodedChunk = false;
        if (decoded.charCodeAt(0) === 65279) decoded = decoded.slice(1);
      }
      processDecodedText(decoded);
    }
    const finalDecoded = decoder.decode();
    processDecodedText(finalDecoded);
  } catch (error2) {
    if (error2 instanceof TypeError && /encoded data/i.test(error2.message)) {
      throw new ReadToolError("UNSUPPORTED_ENCODING", "File is not valid UTF-8 text.");
    }
    throw error2;
  }
  if (pending.length > 0) {
    if (pending.endsWith("\r")) pending = pending.slice(0, -1);
    totalLines += 1;
    considerLine(pending, totalLines);
  }
  const lastReturned = lines.length > 0 ? Number.parseInt(lines.at(-1).slice(0, lines.at(-1).indexOf(":")), 10) : null;
  return {
    lines,
    startLine,
    endLine: lastReturned,
    totalLines,
    truncated: budgetTruncated,
    hasMore: lastReturned !== null && lastReturned < totalLines,
    returnedBytes,
    estimatedTokens: estimatedTokenCount,
    truncatedLineNumbers,
    version: `sha256:${hash2.digest("hex")}`
  };
}

function normalizeError3(requestPath, error2) {
  if (error2 instanceof ReadToolError) {
    return { path: requestPath, status: "error", error: { code: error2.code, message: error2.message } };
  }
  const code = error2?.code;
  if (code === "ENOENT") {
    return { path: requestPath, status: "error", error: { code: "FILE_NOT_FOUND", message: "File does not exist." } };
  }
  if (code === "EACCES" || code === "EPERM") {
    return { path: requestPath, status: "error", error: { code: "PERMISSION_DENIED", message: "Permission denied while reading file." } };
  }
  if (error2?.name === "AbortError") {
    return { path: requestPath, status: "error", error: { code: "ABORTED", message: "File read was cancelled." } };
  }
  return {
    path: requestPath,
    status: "error",
    error: { code: "IO_ERROR", message: error2?.message || "Unexpected file I/O error." }
  };
}

async function readSingleFile(request, roots, config2, signal, checkPermission) {
  try {
    validateRange(request);
    const resolved = await resolveSafePath(request.path, roots);
    const safePath = resolved.realPath;
    const displayPath3 = import_node_path3.default.relative(resolved.root, safePath).split(import_node_path3.default.sep).join("/") || ".";
    if (checkPermission && !await checkPermission(safePath)) {
      throw new ReadToolError("PERMISSION_DENIED", "Reading this file is not permitted by the current policy.");
    }
    if (signal?.aborted) {
      throw new DOMException("File read was cancelled.", "AbortError");
    }
    // The permission callback may wait for host UI. Recheck the resolved name,
    // against the original root, before proceeding. This is NOT an atomic open.
    const recheckedPath = await (0, import_promises4.realpath)(safePath);
    if (!isInsideRoot3(resolved.root, recheckedPath)) {
      throw new ReadToolError("PATH_OUTSIDE_WORKSPACE", "Path moved outside the approved workspace while awaiting permission.");
    }
    if (recheckedPath !== safePath) {
      throw new ReadToolError("PERMISSION_DENIED", "Resolved path changed while awaiting permission; request approval again.");
    }
    const fileStat = await (0, import_promises4.stat)(safePath);
    if (!fileStat.isFile()) {
      throw new ReadToolError("NOT_A_FILE", "Requested path is not a regular file.");
    }
    const hasExplicitRange = request.start_line !== void 0 || request.end_line !== void 0;
    if (fileStat.size >= config2.veryLargeFileBytes && !hasExplicitRange) {
      throw new ReadToolError(
        "FILE_TOO_LARGE_FOR_IMPLICIT_READ",
        `File is ${fileStat.size} bytes, which exceeds the ${config2.veryLargeFileBytes}-byte implicit-read threshold. Use start_line/end_line or search/grep first.`
      );
    }
    if (signal?.aborted) {
      throw new DOMException("File read was cancelled.", "AbortError");
    }
    if (await appearsBinary(safePath, config2.binaryProbeBytes)) {
      throw new ReadToolError("BINARY_FILE", "This file appears to be binary and cannot be read as text.");
    }
    const read = await readTextRange(safePath, request, config2, signal);
    return {
      path: displayPath3,
      status: "success",
      start_line: request.start_line ?? 1,
      end_line: read.endLine,
      total_lines: read.totalLines,
      truncated: read.truncated,
      has_more: read.hasMore,
      next_start_line: read.hasMore && read.endLine !== null ? read.endLine + 1 : null,
      content: read.lines.join("\n"),
      size_bytes: fileStat.size,
      returned_bytes: read.returnedBytes,
      estimated_tokens: read.estimatedTokens,
      version: read.version,
      truncated_line_numbers: read.truncatedLineNumbers,
      very_large_file: fileStat.size >= config2.veryLargeFileBytes
    };
  } catch (error2) {
    return normalizeError3(request.path, error2);
  }
}

async function mapWithConcurrency2(values, concurrency, worker) {
  const results = new Array(values.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function applyBatchBudget(results, config2) {
  let bytes = 0;
  let tokens = 0;
  return results.map((result) => {
    if (result.status !== "success") return result;
    if (bytes + result.returned_bytes > config2.maxTotalBytesPerCall || tokens + result.estimated_tokens > config2.maxEstimatedTokensPerCall) {
      return {
        path: result.path,
        status: "skipped",
        reason: "BATCH_OUTPUT_BUDGET_EXCEEDED",
        message: "This file was read but omitted because the read_files batch output budget was reached. Request it in a subsequent call if needed."
      };
    }
    bytes += result.returned_bytes;
    tokens += result.estimated_tokens;
    return result;
  });
}

async function readFiles(input, context) {
  const config2 = { ...DEFAULT_READ_FILES_CONFIG, ...context.config };
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new Error("read_files requires at least one file.");
  }
  if (input.files.length > config2.maxFilesPerCall) {
    throw new Error(`INVALID_ARGUMENT: read_files.files must contain at most ${config2.maxFilesPerCall} items.`);
  }
  const dedup = /* @__PURE__ */ new Map();
  const rawResults = await mapWithConcurrency2(input.files, config2.concurrency, async (request) => {
    const key = JSON.stringify([request.path, request.start_line ?? null, request.end_line ?? null]);
    let pending = dedup.get(key);
    if (!pending) {
      pending = readSingleFile(
        request,
        context.workspaceRoots,
        config2,
        context.signal,
        context.checkPermission
      );
      dedup.set(key, pending);
    }
    return pending;
  });
  const files = applyBatchBudget(rawResults, config2);
  return {
    files,
    summary: {
      requested: files.length,
      succeeded: files.filter((item) => item.status === "success").length,
      failed: files.filter((item) => item.status === "error").length,
      skipped: files.filter((item) => item.status === "skipped").length,
      truncated: files.filter((item) => item.status === "success" && item.truncated).length
    }
  };
}

function formatReadFilesForModel(result) {
  const parts = ["=== READ_FILES BEGIN ==="];
  for (const file of result.files) {
    parts.push("=== FILE BEGIN ===", `path: ${JSON.stringify(file.path)}`, `status: ${file.status}`);
    if (file.status === "error") {
      parts.push(
        `error_code: ${file.error.code}`,
        `message: ${file.error.message}`,
        "=== FILE END ==="
      );
      continue;
    }
    if (file.status === "skipped") {
      parts.push(
        `reason: ${file.reason}`,
        `message: ${file.message}`,
        "=== FILE END ==="
      );
      continue;
    }
    const lineRange = file.end_line === null ? `${file.start_line}-EOF` : `${file.start_line}-${file.end_line}`;
    parts.push(
      `lines: ${lineRange}`,
      `total_lines: ${file.total_lines}`,
      `truncated: ${file.truncated}`,
      `has_more: ${file.has_more}`,
      `next_start_line: ${file.next_start_line ?? "null"}`,
      `version: ${file.version}`,
      "--- CONTENT BEGIN ---",
      file.content,
      "--- CONTENT END ---"
    );
    if (file.truncated) {
      parts.push(
        `NOTE: Requested output was truncated by the per-file budget. Continue with start_line=${file.next_start_line ?? "?"}.`
      );
    } else if (file.has_more) {
      parts.push(
        `NOTE: The requested range was satisfied, but the file continues after line ${file.end_line ?? "?"}. The next file line is ${file.next_start_line ?? "?"}.`
      );
    }
    if (file.truncated_line_numbers.length > 0) {
      parts.push(`NOTE: Oversized line content was truncated at line(s): ${file.truncated_line_numbers.join(", ")}.`);
    }
    if (file.very_large_file) {
      parts.push("NOTE: This is a very large file. Prefer search/grep and targeted line ranges instead of sequentially reading it.");
    }
    parts.push("=== FILE END ===");
  }
  const { summary } = result;
  parts.push(
    "=== SUMMARY ===",
    `requested: ${summary.requested}`,
    `succeeded: ${summary.succeeded}`,
    `failed: ${summary.failed}`,
    `skipped: ${summary.skipped}`,
    `truncated: ${summary.truncated}`,
    "=== READ_FILES END ==="
  );
  return parts.join("\n");
}

export { DEFAULT_READ_FILES_CONFIG, ReadToolError, appearsBinary, applyBatchBudget, estimateTokens, formatReadFilesForModel, import_node_crypto4, import_node_fs, import_node_path3, import_promises4, isInsideRoot3, mapWithConcurrency2, normalizeError3, readFiles, readSingleFile, readTextRange, resolveSafePath, validateRange };
