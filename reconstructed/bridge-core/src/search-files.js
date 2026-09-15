// RECONSTRUCTED from src/search-files.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.
import { attributeGlobFailure, classifyRipgrepStderr, formatGlobFailureLocation } from './ripgrep-diagnostics.js';
import { rgPath } from './snapshot-packaged-ripgrep.js';
import { canonicalizeWorkspaceRoots, literalFirstPathSpellings } from './workspace-paths.js';

import * as import_node_child_process3 from "node:child_process";

import * as import_promises6 from "node:fs/promises";

import * as import_node_path5 from "node:path";

var MACOS_PROTECTED_VOLUME_GLOBS2 = [
  "**/.Spotlight-V100/**",
  "**/.Trashes/**",
  "**/.fseventsd/**",
  "**/.TemporaryItems/**",
  "**/.DocumentRevisions-V100/**"
];

var DEFAULT_SEARCH_FILES_CONFIG = {
  defaultContextLines: 1,
  maxContextLines: 5,
  defaultMaxResults: 100,
  hardMaxResults: 500,
  defaultMaxMatchesPerFile: 20,
  hardMaxMatchesPerFile: 100,
  maxOutputBytes: 128 * 1024,
  maxEstimatedTokens: 3e4,
  maxLineChars: 1200,
  maxFallbackFileBytes: 2 * 1024 * 1024,
  maxFallbackFilesScanned: 2e4,
  binaryProbeBytes: 8 * 1024,
  commonExcludes: [
    "**/.git/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/out-build/**",
    "**/out-vscode/**",
    "**/coverage/**",
    "**/.next/**",
    "**/target/**",
    "**/vendor/**",
    "**/VSCode-darwin-*/**",
    "**/release/**",
    "**/*.zip"
  ]
};

var SearchToolError = class extends Error {
  constructor(code, message, at) {
    super(message);
    this.code = code;
    this.at = at;
  }
  code;
  at;
};

function estimateTokens2(text) {
  return Math.ceil(text.length / 4);
}

function isInsideRoot5(root, target) {
  const relative = import_node_path5.default.relative(root, target);
  return relative === "" || !relative.startsWith(`..${import_node_path5.default.sep}`) && relative !== ".." && !import_node_path5.default.isAbsolute(relative);
}

async function canonicalRoots3(roots) {
  return canonicalizeWorkspaceRoots(
    roots,
    (message) => new SearchToolError("PATH_OUTSIDE_WORKSPACE", message)
  );
}

async function resolveSafeScope2(requestedPath, roots) {
  const canonical = await canonicalRoots3(roots);
  for (const spelling of literalFirstPathSpellings(requestedPath)) {
    const candidates = import_node_path5.default.isAbsolute(spelling) ? [spelling] : canonical.map((root) => import_node_path5.default.resolve(root, spelling));
    let sawNotFound = false;
    let sawOutside = false;
    for (const candidate of candidates) {
      try {
        const target = await (0, import_promises6.realpath)(candidate);
        const root = canonical.find((candidateRoot) => isInsideRoot5(candidateRoot, target));
        if (root) return { realPath: target, root };
        sawOutside = true;
      } catch (error2) {
        const code = error2.code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          sawNotFound = true;
          continue;
        }
        if (code === "EACCES" || code === "EPERM") {
          throw new SearchToolError("PERMISSION_DENIED", "Permission denied while resolving the search path.");
        }
        throw error2;
      }
    }
    if (sawOutside) {
      throw new SearchToolError("PATH_OUTSIDE_WORKSPACE", "Search path resolves outside the allowed workspace roots.");
    }
    if (!sawNotFound) break;
  }
  throw new SearchToolError("FILE_NOT_FOUND", "Search path does not exist.");
}

function boundedInteger(value, fallback, min, max, name) {
  if (value === void 0) return fallback;
  if (!Number.isInteger(value) || value < min) {
    throw new SearchToolError("INVALID_ARGUMENT", `${name} must be an integer >= ${min}.`);
  }
  if (value > max) {
    throw new SearchToolError("INVALID_ARGUMENT", `${name} must be <= ${max}.`);
  }
  return value;
}

function smartCaseSensitive(pattern) {
  return /[A-Z]/.test(pattern);
}

function normalizeInput2(input, config2) {
  if (typeof input.pattern !== "string" || input.pattern.length === 0) {
    throw new SearchToolError("INVALID_ARGUMENT", "pattern must be a non-empty string.");
  }
  if (input.pattern.length > 2e4) {
    throw new SearchToolError("INVALID_ARGUMENT", "pattern is too long.");
  }
  if (input.path !== void 0 && (typeof input.path !== "string" || input.path.length === 0)) {
    throw new SearchToolError("INVALID_ARGUMENT", "path must be a non-empty string when provided.");
  }
  const include = input.include ?? [];
  const exclude = input.exclude ?? [];
  if (!Array.isArray(include) || include.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new SearchToolError("INVALID_ARGUMENT", "include must be an array of non-empty glob strings.");
  }
  if (!Array.isArray(exclude) || exclude.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new SearchToolError("INVALID_ARGUMENT", "exclude must be an array of non-empty glob strings.");
  }
  return {
    pattern: input.pattern,
    scopeDisplay: input.path ?? ".",
    isRegex: input.is_regex ?? false,
    caseSensitive: input.case_sensitive,
    include,
    exclude,
    contextLines: boundedInteger(input.context_lines, config2.defaultContextLines, 0, config2.maxContextLines, "context_lines"),
    maxResults: boundedInteger(input.max_results, config2.defaultMaxResults, 1, config2.hardMaxResults, "max_results"),
    maxMatchesPerFile: boundedInteger(
      input.max_matches_per_file,
      config2.defaultMaxMatchesPerFile,
      1,
      config2.hardMaxMatchesPerFile,
      "max_matches_per_file"
    ),
    noIgnore: input.no_ignore ?? false,
    includeHidden: input.include_hidden ?? false
  };
}

function displayPath2(root, filePath) {
  const relative = import_node_path5.default.relative(root, filePath);
  return (relative || import_node_path5.default.basename(filePath)).split(import_node_path5.default.sep).join("/");
}

function matchesAnyGlob(relativePath, patterns) {
  if (patterns.length === 0) return false;
  const normalized = relativePath.split(import_node_path5.default.sep).join("/");
  const base = import_node_path5.default.posix.basename(normalized);
  return patterns.some((pattern) => {
    try {
      return import_node_path5.default.matchesGlob(normalized, pattern) || import_node_path5.default.matchesGlob(base, pattern);
    } catch {
      return false;
    }
  });
}

function shouldIncludePath(workspaceRelativePath, scopeRelativePath, options, config2) {
  const workspaceRelative = workspaceRelativePath.split(import_node_path5.default.sep).join("/");
  const scopeRelative = scopeRelativePath.split(import_node_path5.default.sep).join("/");
  if (process.platform === "darwin" && matchesAnyGlob(workspaceRelative, MACOS_PROTECTED_VOLUME_GLOBS2)) return false;
  if (!options.includeHidden) {
    const segments = workspaceRelative.split("/");
    if (segments.some((segment) => segment.startsWith(".") && segment !== "." && segment !== "..")) return false;
  }
  if (!options.noIgnore && matchesAnyGlob(workspaceRelative, config2.commonExcludes)) return false;
  if (options.include.length > 0 && !matchesAnyGlob(scopeRelative, options.include)) return false;
  if (options.exclude.length > 0 && matchesAnyGlob(scopeRelative, options.exclude)) return false;
  return true;
}

async function appearsBinary2(filePath, probeBytes) {
  const handle = await (0, import_promises6.open)(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(probeBytes);
    const { bytesRead } = await handle.read(buffer, 0, probeBytes, 0);
    if (bytesRead === 0) return false;
    let suspicious = 0;
    for (let index = 0; index < bytesRead; index += 1) {
      const byte = buffer[index];
      if (byte === 0) return true;
      const allowedControl = byte === 9 || byte === 10 || byte === 13;
      if (byte < 32 && !allowedControl || byte === 127) suspicious += 1;
    }
    return suspicious / bytesRead > 0.1;
  } finally {
    await handle.close();
  }
}

async function loadRootGitignore2(root) {
  try {
    const text = await (0, import_promises6.readFile)(import_node_path5.default.join(root, ".gitignore"), "utf8");
    return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function gitignorePatternMatches(relativePath, rawPattern) {
  const negated = rawPattern.startsWith("!");
  const source = negated ? rawPattern.slice(1) : rawPattern;
  if (!source) return false;
  const normalized = source.replace(/^\//, "").replace(/\\/g, "/");
  const candidate = relativePath.replace(/\\/g, "/");
  const directoryPattern = normalized.endsWith("/");
  const clean = directoryPattern ? normalized.slice(0, -1) : normalized;
  const patterns = clean.includes("/") ? [clean, directoryPattern ? `${clean}/**` : clean] : [clean, `**/${clean}`, `**/${clean}/**`];
  return matchesAnyGlob(candidate, patterns);
}

function ignoredByRootGitignore(relativePath, patterns) {
  let ignored = false;
  for (const raw of patterns) {
    const negated = raw.startsWith("!");
    if (gitignorePatternMatches(relativePath, raw) || negated && gitignorePatternMatches(relativePath, raw.slice(1))) {
      ignored = !negated;
    }
  }
  return ignored;
}

function compileFallbackMatcher(options) {
  const sensitive = options.caseSensitive ?? smartCaseSensitive(options.pattern);
  if (options.isRegex) {
    const flags = sensitive ? "" : "i";
    let regex;
    try {
      regex = new RegExp(options.pattern, flags);
    } catch (error2) {
      throw new SearchToolError("INVALID_PATTERN", `Invalid regular expression: ${error2.message}`);
    }
    return (line) => {
      regex.lastIndex = 0;
      const match = regex.exec(line);
      return match ? { matched: true, column: match.index + 1 } : { matched: false, column: 0 };
    };
  }
  const needle = sensitive ? options.pattern : options.pattern.toLowerCase();
  return (line) => {
    const haystack = sensitive ? line : line.toLowerCase();
    const index = haystack.indexOf(needle);
    return index >= 0 ? { matched: true, column: index + 1 } : { matched: false, column: 0 };
  };
}

async function collectCandidateFiles(options, config2, signal) {
  if (options.scopeIsFile) {
    const workspaceRelative = displayPath2(options.scopeRoot, options.scopeRealPath);
    const scopeRelative = import_node_path5.default.relative(options.scopeMatchRoot, options.scopeRealPath).split(import_node_path5.default.sep).join("/");
    return {
      files: shouldIncludePath(workspaceRelative, scopeRelative, options, config2) ? [options.scopeRealPath] : [],
      filesScanned: 1,
      hitLimit: false
    };
  }
  const gitignore = options.noIgnore ? [] : await loadRootGitignore2(options.scopeRoot);
  const files = [];
  let filesScanned = 0;
  let hitLimit = false;
  const stack = [options.scopeRealPath];
  while (stack.length > 0) {
    if (signal?.aborted) throw new DOMException("Search was cancelled.", "AbortError");
    const directory = stack.pop();
    let entries;
    try {
      entries = await (0, import_promises6.readdir)(directory, { withFileTypes: true });
    } catch (error2) {
      const code = error2.code;
      if (code === "EACCES" || code === "EPERM") continue;
      throw error2;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = import_node_path5.default.join(directory, entry.name);
      const workspaceRelative = displayPath2(options.scopeRoot, absolute);
      const scopeRelative = import_node_path5.default.relative(options.scopeMatchRoot, absolute).split(import_node_path5.default.sep).join("/");
      if (!shouldIncludePath(workspaceRelative, scopeRelative, options, config2)) continue;
      if (!options.noIgnore && ignoredByRootGitignore(workspaceRelative, gitignore)) continue;
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      filesScanned += 1;
      if (filesScanned > config2.maxFallbackFilesScanned) {
        hitLimit = true;
        break;
      }
      files.push(absolute);
    }
    if (hitLimit) break;
  }
  files.sort((a, b) => displayPath2(options.scopeRoot, a).localeCompare(displayPath2(options.scopeRoot, b)));
  return { files, filesScanned: Math.min(filesScanned, config2.maxFallbackFilesScanned), hitLimit };
}

async function searchWithNode(options, config2, signal, checkPermission) {
  const candidateResult = await collectCandidateFiles(options, config2, signal);
  const matcher = compileFallbackMatcher(options);
  const matches = [];
  const perFile = /* @__PURE__ */ new Map();
  const truncationReasons = /* @__PURE__ */ new Set();
  if (candidateResult.hitLimit) truncationReasons.add("MAX_FILES_SCANNED");
  let skippedBinaryFiles = 0;
  let skippedLargeFiles = 0;
  outer: for (const filePath of candidateResult.files) {
    if (signal?.aborted) throw new DOMException("Search was cancelled.", "AbortError");
    if (checkPermission && !await checkPermission(filePath)) continue;
    const fileStat = await (0, import_promises6.stat)(filePath);
    if (fileStat.size > config2.maxFallbackFileBytes) {
      skippedLargeFiles += 1;
      continue;
    }
    if (await appearsBinary2(filePath, config2.binaryProbeBytes)) {
      skippedBinaryFiles += 1;
      continue;
    }
    let text;
    try {
      text = await (0, import_promises6.readFile)(filePath, "utf8");
    } catch (error2) {
      if (error2.code === "EACCES") continue;
      throw error2;
    }
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    const display = displayPath2(options.scopeRoot, filePath);
    for (let index = 0; index < lines.length; index += 1) {
      const found = matcher(lines[index]);
      if (!found.matched) continue;
      const count = perFile.get(display) ?? 0;
      if (count >= options.maxMatchesPerFile) {
        truncationReasons.add("MAX_MATCHES_PER_FILE");
        continue;
      }
      if (matches.length >= options.maxResults) {
        truncationReasons.add("MAX_RESULTS");
        break outer;
      }
      perFile.set(display, count + 1);
      matches.push({
        absolutePath: filePath,
        displayPath: display,
        line: index + 1,
        column: found.column,
        text: lines[index]
      });
    }
  }
  return {
    engine: "node",
    matches,
    filesScanned: candidateResult.filesScanned,
    skippedBinaryFiles,
    skippedLargeFiles,
    truncationReasons
  };
}

function ripgrepCandidates2(config2) {
  const candidates = [
    config2.ripgrepPath,
    process.env.RIPGREP_PATH,
    rgPath,
    "rg"
  ].filter((value) => Boolean(value));
  return [...new Set(candidates)];
}

function buildRipgrepArgs2(options, config2) {
  const args = ["--json", "--line-number", "--column", "--color=never", "--max-count", String(options.maxMatchesPerFile + 1)];
  if (!options.isRegex) args.push("--fixed-strings");
  if (options.caseSensitive === true) args.push("--case-sensitive");
  else if (options.caseSensitive === false) args.push("--ignore-case");
  else args.push("--smart-case");
  if (options.noIgnore) args.push("--no-ignore");
  if (options.includeHidden) args.push("--hidden");
  if (!options.noIgnore) {
    for (const glob of config2.commonExcludes) args.push("--glob", `!${glob}`);
  }
  if (process.platform === "darwin") {
    for (const glob of MACOS_PROTECTED_VOLUME_GLOBS2) args.push("--glob", `!${glob}`);
  }
  for (const glob of options.include) args.push("--glob", glob);
  for (const glob of options.exclude) args.push("--glob", `!${glob}`);
  args.push("--", options.pattern, options.scopeIsFile ? import_node_path5.default.basename(options.scopeRealPath) : ".");
  return args;
}

function toSearchRipgrepFailure(detail, code, options) {
  const message = detail || `ripgrep exited with code ${code}.`;
  const kind = classifyRipgrepStderr(message);
  if (kind === "invalid_regex") return new SearchToolError("INVALID_PATTERN", detail || "Invalid regular expression.");
  if (kind === "invalid_glob") {
    const at = attributeGlobFailure(message, [
      { field: "search_files.include", values: options.include },
      { field: "search_files.exclude", values: options.exclude, negated: true }
    ]);
    return new SearchToolError("INVALID_GLOB", at ? `${message} (${formatGlobFailureLocation(at)})` : message, at);
  }
  return new SearchToolError("IO_ERROR", message);
}

async function trySearchWithRipgrep(executable, options, config2, signal) {
  const ripgrepCwd = options.scopeMatchRoot;
  const gitignore = options.noIgnore ? [] : await loadRootGitignore2(options.scopeRoot);
  return new Promise((resolve, reject) => {
    const args = buildRipgrepArgs2(options, config2);
    const child = (0, import_node_child_process3.spawn)(executable, args, { cwd: ripgrepCwd, stdio: ["ignore", "pipe", "pipe"], signal });
    const matches = [];
    const perFile = /* @__PURE__ */ new Map();
    const truncationReasons = /* @__PURE__ */ new Set();
    let stdoutPending = "";
    let stderr = "";
    let unavailable = false;
    let settled = false;
    const finish = (value, error2) => {
      if (settled) return;
      settled = true;
      if (error2) reject(error2);
      else resolve(value);
    };
    child.on("error", (error2) => {
      if (error2.code === "ENOENT") {
        unavailable = true;
        finish(null);
        return;
      }
      if (error2.name === "AbortError") {
        finish(null, error2);
        return;
      }
      finish(null, error2);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 16e3) stderr = stderr.slice(-16e3);
    });
    const parseLine = (line) => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event?.type !== "match") return;
      const data = event.data;
      const pathText = data?.path?.text;
      const lineText = data?.lines?.text;
      const lineNumber = data?.line_number;
      if (typeof pathText !== "string" || typeof lineText !== "string" || !Number.isInteger(lineNumber)) return;
      const absolute = import_node_path5.default.isAbsolute(pathText) ? pathText : import_node_path5.default.resolve(ripgrepCwd, pathText);
      const display = displayPath2(options.scopeRoot, absolute);
      const scopeRelative = import_node_path5.default.relative(options.scopeMatchRoot, absolute).split(import_node_path5.default.sep).join("/");
      if (!shouldIncludePath(display, scopeRelative, options, config2)) return;
      if (!options.noIgnore && ignoredByRootGitignore(display, gitignore)) return;
      const count = perFile.get(display) ?? 0;
      if (count >= options.maxMatchesPerFile) {
        truncationReasons.add("MAX_MATCHES_PER_FILE");
        return;
      }
      if (matches.length >= options.maxResults) {
        truncationReasons.add("MAX_RESULTS");
        child.kill();
        return;
      }
      perFile.set(display, count + 1);
      const firstSubmatch = Array.isArray(data?.submatches) ? data.submatches[0] : void 0;
      matches.push({
        absolutePath: absolute,
        displayPath: display,
        line: lineNumber,
        column: Number.isInteger(firstSubmatch?.start) ? firstSubmatch.start + 1 : 1,
        text: lineText.replace(/\r?\n$/, "")
      });
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutPending += chunk;
      while (true) {
        const newline = stdoutPending.indexOf("\n");
        if (newline < 0) break;
        const line = stdoutPending.slice(0, newline);
        stdoutPending = stdoutPending.slice(newline + 1);
        parseLine(line);
      }
    });
    child.on("close", (code, signalName) => {
      if (unavailable || settled) return;
      if (stdoutPending) parseLine(stdoutPending);
      if (code !== 0 && code !== 1 && !(signalName && truncationReasons.has("MAX_RESULTS"))) {
        finish(null, toSearchRipgrepFailure(stderr.trim(), code, options));
        return;
      }
      finish({
        engine: "ripgrep",
        matches,
        filesScanned: null,
        skippedBinaryFiles: 0,
        skippedLargeFiles: 0,
        truncationReasons
      });
    });
  });
}

async function searchWithPreferredEngine(options, config2, signal, checkPermission) {
  if (!checkPermission) {
    for (const candidate of ripgrepCandidates2(config2)) {
      try {
        const result = await trySearchWithRipgrep(candidate, options, config2, signal);
        if (result) return result;
      } catch (error2) {
        if (error2?.name === "AbortError") throw error2;
        if (error2 instanceof SearchToolError && error2.code === "INVALID_PATTERN") throw error2;
        if (error2 instanceof SearchToolError) throw error2;
      }
    }
  }
  return searchWithNode(options, config2, signal, checkPermission);
}

function truncateLine(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)} \u2026 <line truncated>`, truncated: true };
}

async function addContext(rawMatches, contextLines, config2) {
  const cache = /* @__PURE__ */ new Map();
  const result = [];
  for (const match of rawMatches) {
    const hit = truncateLine(match.text, config2.maxLineChars);
    if (contextLines === 0) {
      result.push({
        path: match.displayPath,
        line: match.line,
        column: match.column,
        text: hit.text,
        text_truncated: hit.truncated,
        before: [],
        after: []
      });
      continue;
    }
    let lines = cache.get(match.absolutePath);
    if (!lines) {
      try {
        const fileStat = await (0, import_promises6.stat)(match.absolutePath);
        if (fileStat.size > config2.maxFallbackFileBytes) {
          lines = [];
        } else {
          const text = await (0, import_promises6.readFile)(match.absolutePath, "utf8");
          lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
        }
      } catch {
        lines = [];
      }
      cache.set(match.absolutePath, lines);
    }
    const before = [];
    const after = [];
    for (let lineNumber = Math.max(1, match.line - contextLines); lineNumber < match.line; lineNumber += 1) {
      const value = truncateLine(lines[lineNumber - 1] ?? "", config2.maxLineChars);
      before.push({ line: lineNumber, text: value.text, truncated: value.truncated });
    }
    for (let lineNumber = match.line + 1; lineNumber <= Math.min(lines.length, match.line + contextLines); lineNumber += 1) {
      const value = truncateLine(lines[lineNumber - 1] ?? "", config2.maxLineChars);
      after.push({ line: lineNumber, text: value.text, truncated: value.truncated });
    }
    result.push({
      path: match.displayPath,
      line: match.line,
      column: match.column,
      text: hit.text,
      text_truncated: hit.truncated,
      before,
      after
    });
  }
  return result;
}

function serializedMatchSize(match) {
  const text = [
    `${match.path}:${match.line}:${match.column}`,
    ...match.before.map((item) => `${item.line}|${item.text}`),
    `${match.line}>${match.text}`,
    ...match.after.map((item) => `${item.line}|${item.text}`)
  ].join("\n");
  return { bytes: Buffer.byteLength(text, "utf8"), tokens: estimateTokens2(text) };
}

function applyOutputBudget(matches, config2, reasons) {
  const result = [];
  let bytes = 0;
  let tokens = 0;
  for (const match of matches) {
    const size = serializedMatchSize(match);
    if (bytes + size.bytes > config2.maxOutputBytes) {
      reasons.add("OUTPUT_BYTE_BUDGET");
      break;
    }
    if (tokens + size.tokens > config2.maxEstimatedTokens) {
      reasons.add("OUTPUT_TOKEN_BUDGET");
      break;
    }
    result.push(match);
    bytes += size.bytes;
    tokens += size.tokens;
  }
  return result;
}

function normalizeError5(error2) {
  if (error2 instanceof SearchToolError) throw error2;
  if (error2?.name === "AbortError") {
    throw new SearchToolError("ABORTED", "Search was cancelled.");
  }
  const code = error2?.code;
  if (code === "ENOENT") throw new SearchToolError("FILE_NOT_FOUND", "Search path does not exist.");
  if (code === "EACCES" || code === "EPERM") throw new SearchToolError("PERMISSION_DENIED", "Permission denied during search.");
  throw new SearchToolError("IO_ERROR", error2?.message || "Unexpected search I/O error.");
}

async function searchFiles(input, context) {
  const config2 = { ...DEFAULT_SEARCH_FILES_CONFIG, ...context.config };
  try {
    const normalized = normalizeInput2(input, config2);
    const scope = await resolveSafeScope2(normalized.scopeDisplay, context.workspaceRoots);
    const scopeStat = await (0, import_promises6.stat)(scope.realPath);
    if (!scopeStat.isFile() && !scopeStat.isDirectory()) {
      throw new SearchToolError("NOT_A_FILE_OR_DIRECTORY", "Search path is not a regular file or directory.");
    }
    const scopeIsFile = scopeStat.isFile();
    const scopeDisplay = import_node_path5.default.relative(scope.root, scope.realPath).split(import_node_path5.default.sep).join("/") || ".";
    const options = {
      ...normalized,
      scopeDisplay,
      scopeRealPath: scope.realPath,
      scopeRoot: scope.root,
      scopeIsFile,
      scopeMatchRoot: scopeIsFile ? import_node_path5.default.dirname(scope.realPath) : scope.realPath
    };
    if (context.signal?.aborted) throw new DOMException("Search was cancelled.", "AbortError");
    if (context.checkPermission && !await context.checkPermission(options.scopeRealPath)) {
      throw new SearchToolError("PERMISSION_DENIED", "Searching this path is not permitted by the current policy.");
    }
    const engine = await searchWithPreferredEngine(options, config2, context.signal, context.checkPermission);
    const enriched = await addContext(engine.matches, options.contextLines, config2);
    const bounded = applyOutputBudget(enriched, config2, engine.truncationReasons);
    const filesWithMatches = new Set(bounded.map((match) => match.path)).size;
    return {
      pattern: options.pattern,
      mode: options.isRegex ? "regex" : "literal",
      case_mode: options.caseSensitive === true ? "sensitive" : options.caseSensitive === false ? "insensitive" : "smart",
      scope: options.scopeDisplay,
      engine: engine.engine,
      matches: bounded,
      summary: {
        returned_matches: bounded.length,
        files_with_matches: filesWithMatches,
        files_scanned: engine.filesScanned,
        skipped_binary_files: engine.skippedBinaryFiles,
        skipped_large_files: engine.skippedLargeFiles,
        truncated: engine.truncationReasons.size > 0,
        truncation_reasons: [...engine.truncationReasons]
      }
    };
  } catch (error2) {
    return normalizeError5(error2);
  }
}

function formatSearchFilesForModel(result) {
  const parts = [
    "=== SEARCH_FILES BEGIN ===",
    `pattern: ${JSON.stringify(result.pattern)}`,
    `mode: ${result.mode}`,
    `case_mode: ${result.case_mode}`,
    `scope: ${JSON.stringify(result.scope)}`,
    `engine: ${result.engine}`,
    `returned_matches: ${result.summary.returned_matches}`,
    `files_with_matches: ${result.summary.files_with_matches}`,
    `truncated: ${result.summary.truncated}`
  ];
  for (let index = 0; index < result.matches.length; index += 1) {
    const match = result.matches[index];
    parts.push(`--- MATCH ${index + 1} ---`, `${match.path}:${match.line}:${match.column}`);
    for (const line of match.before) parts.push(`${line.line}| ${line.text}`);
    parts.push(`${match.line}> ${match.text}`);
    for (const line of match.after) parts.push(`${line.line}| ${line.text}`);
    if (match.text_truncated || match.before.some((line) => line.truncated) || match.after.some((line) => line.truncated)) {
      parts.push("NOTE: One or more displayed lines were shortened to protect the context budget.");
    }
  }
  if (result.summary.truncated) {
    parts.push(
      `NOTE: Search results were bounded (${result.summary.truncation_reasons.join(", ")}). Narrow path/include/exclude/pattern or run a follow-up search if more results are needed.`
    );
  }
  if (result.engine === "node") {
    parts.push("NOTE: ripgrep was unavailable; the built-in Node fallback engine was used.");
  }
  if (result.summary.skipped_large_files > 0 || result.summary.skipped_binary_files > 0) {
    parts.push(
      `NOTE: fallback engine skipped ${result.summary.skipped_large_files} large file(s) and ${result.summary.skipped_binary_files} binary file(s).`
    );
  }
  parts.push("=== SEARCH_FILES END ===");
  return parts.join("\n");
}

export { DEFAULT_SEARCH_FILES_CONFIG, MACOS_PROTECTED_VOLUME_GLOBS2, SearchToolError, addContext, appearsBinary2, applyOutputBudget, boundedInteger, buildRipgrepArgs2, canonicalRoots3, collectCandidateFiles, compileFallbackMatcher, displayPath2, estimateTokens2, formatSearchFilesForModel, gitignorePatternMatches, ignoredByRootGitignore, import_node_child_process3, import_node_path5, import_promises6, isInsideRoot5, loadRootGitignore2, matchesAnyGlob, normalizeError5, normalizeInput2, resolveSafeScope2, ripgrepCandidates2, searchFiles, searchWithNode, searchWithPreferredEngine, serializedMatchSize, shouldIncludePath, smartCaseSensitive, toSearchRipgrepFailure, truncateLine, trySearchWithRipgrep };
