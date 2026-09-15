// RECONSTRUCTED from src/find-files.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.
import { attributeGlobFailure, classifyRipgrepStderr, formatGlobFailureLocation } from './ripgrep-diagnostics.js';
import { rgPath } from './snapshot-packaged-ripgrep.js';
import { canonicalizeWorkspaceRoots, literalFirstPathSpellings } from './workspace-paths.js';

import * as import_node_child_process2 from "node:child_process";

import * as import_promises3 from "node:fs/promises";

import * as import_node_path2 from "node:path";

var MACOS_PROTECTED_VOLUME_GLOBS = [
  "**/.Spotlight-V100/**",
  "**/.Trashes/**",
  "**/.fseventsd/**",
  "**/.TemporaryItems/**",
  "**/.DocumentRevisions-V100/**"
];

var DEFAULT_FIND_FILES_CONFIG = {
  defaultMaxResults: 100,
  hardMaxResults: 500,
  maxCandidates: 5e3,
  statConcurrency: 32,
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

var FindFilesError = class extends Error {
  constructor(code, message, at) {
    super(message);
    this.code = code;
    this.at = at;
  }
  code;
  at;
};

function isInsideRoot2(root, target) {
  const relative = import_node_path2.default.relative(root, target);
  return relative === "" || !relative.startsWith(`..${import_node_path2.default.sep}`) && relative !== ".." && !import_node_path2.default.isAbsolute(relative);
}

async function canonicalRoots2(roots) {
  return canonicalizeWorkspaceRoots(
    roots,
    (message) => new FindFilesError("PATH_OUTSIDE_WORKSPACE", message)
  );
}

async function resolveSafeScope(requestedPath, roots) {
  const canonical = await canonicalRoots2(roots);
  for (const spelling of literalFirstPathSpellings(requestedPath)) {
    const candidates = import_node_path2.default.isAbsolute(spelling) ? [spelling] : canonical.map((root) => import_node_path2.default.resolve(root, spelling));
    let sawNotFound = false;
    let sawOutside = false;
    for (const candidate of candidates) {
      try {
        const target = await (0, import_promises3.realpath)(candidate);
        const root = canonical.find((candidateRoot) => isInsideRoot2(candidateRoot, target));
        if (!root) {
          sawOutside = true;
          continue;
        }
        const targetStat = await (0, import_promises3.stat)(target);
        if (!targetStat.isDirectory()) throw new FindFilesError("NOT_A_DIRECTORY", "find_files path must be a directory.");
        return { realPath: target, root };
      } catch (error2) {
        if (error2 instanceof FindFilesError) throw error2;
        const code = error2.code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          sawNotFound = true;
          continue;
        }
        if (code === "EACCES" || code === "EPERM") {
          throw new FindFilesError("PERMISSION_DENIED", "Permission denied while resolving the search directory.");
        }
        throw error2;
      }
    }
    if (sawOutside) {
      throw new FindFilesError("PATH_OUTSIDE_WORKSPACE", "Search directory resolves outside the allowed workspace roots.");
    }
    if (!sawNotFound) break;
  }
  throw new FindFilesError("FILE_NOT_FOUND", "Search directory does not exist.");
}

function validateGlob(pattern) {
  if (!pattern || pattern.length > 4e3) {
    throw new FindFilesError("INVALID_GLOB", "Glob patterns must be non-empty and at most 4000 characters.");
  }
}

function normalizeInput(input, config2) {
  if (!Array.isArray(input.patterns) || input.patterns.length === 0) {
    throw new FindFilesError("INVALID_ARGUMENT", "patterns must be a non-empty array of glob strings.");
  }
  if (input.patterns.length > 20) {
    throw new FindFilesError("INVALID_ARGUMENT", "At most 20 glob patterns may be requested in one call.");
  }
  const patterns = [...new Set(input.patterns)];
  for (const pattern of patterns) {
    if (typeof pattern !== "string") throw new FindFilesError("INVALID_ARGUMENT", "Every patterns item must be a string.");
    validateGlob(pattern);
  }
  const exclude = input.exclude ?? [];
  if (!Array.isArray(exclude) || exclude.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new FindFilesError("INVALID_ARGUMENT", "exclude must be an array of non-empty glob strings.");
  }
  if (exclude.length > 50) throw new FindFilesError("INVALID_ARGUMENT", "At most 50 exclude globs may be provided.");
  for (const pattern of exclude) validateGlob(pattern);
  if (input.path !== void 0 && (typeof input.path !== "string" || input.path.length === 0)) {
    throw new FindFilesError("INVALID_ARGUMENT", "path must be a non-empty directory path when provided.");
  }
  if (input.max_results !== void 0 && (!Number.isInteger(input.max_results) || input.max_results < 1)) {
    throw new FindFilesError("INVALID_ARGUMENT", "max_results must be an integer >= 1.");
  }
  if (input.max_results !== void 0 && input.max_results > config2.hardMaxResults) {
    throw new FindFilesError("INVALID_ARGUMENT", `max_results must be <= ${config2.hardMaxResults}.`);
  }
  if (input.sort !== void 0 && input.sort !== "modified_desc" && input.sort !== "path_asc") {
    throw new FindFilesError("INVALID_ARGUMENT", "sort must be 'modified_desc' or 'path_asc'.");
  }
  return {
    patterns,
    exclude,
    scopeDisplay: input.path ?? ".",
    caseSensitive: input.case_sensitive ?? false,
    noIgnore: input.no_ignore ?? false,
    includeHidden: input.include_hidden ?? false,
    maxResults: input.max_results ?? config2.defaultMaxResults,
    sort: input.sort ?? "modified_desc"
  };
}

function displayPath(root, filePath) {
  const relative = import_node_path2.default.relative(root, filePath);
  return (relative || import_node_path2.default.basename(filePath)).split(import_node_path2.default.sep).join("/");
}

function matchesGlob(value, pattern, caseSensitive) {
  const candidate = value.split(import_node_path2.default.sep).join("/");
  if (caseSensitive) return import_node_path2.default.matchesGlob(candidate, pattern);
  return import_node_path2.default.matchesGlob(candidate.toLowerCase(), pattern.toLowerCase());
}

function matchesAny(value, patterns, caseSensitive) {
  return patterns.some((pattern) => matchesGlob(value, pattern, caseSensitive));
}

function matchesScopedAny(value, patterns, caseSensitive) {
  const normalized = value.split(import_node_path2.default.sep).join("/");
  const base = import_node_path2.default.posix.basename(normalized);
  return patterns.some((pattern) => matchesGlob(normalized, pattern, caseSensitive) || matchesGlob(base, pattern, caseSensitive));
}

function isHiddenPath(value) {
  return value.split(/[\\/]/).some((segment) => segment.startsWith(".") && segment !== "." && segment !== "..");
}

async function loadRootGitignore(root) {
  try {
    const text = await (0, import_promises3.readFile)(import_node_path2.default.join(root, ".gitignore"), "utf8");
    return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function gitignoreMatches(relativePath, patterns) {
  let ignored = false;
  const candidate = relativePath.replace(/\\/g, "/");
  for (const raw of patterns) {
    const negated = raw.startsWith("!");
    const source = (negated ? raw.slice(1) : raw).replace(/^\//, "").replace(/\\/g, "/");
    if (!source) continue;
    const directoryPattern = source.endsWith("/");
    const clean = directoryPattern ? source.slice(0, -1) : source;
    const variants = clean.includes("/") ? [clean, directoryPattern ? `${clean}/**` : clean] : [clean, `**/${clean}`, `**/${clean}/**`];
    if (variants.some((pattern) => import_node_path2.default.matchesGlob(candidate, pattern))) ignored = !negated;
  }
  return ignored;
}

function ripgrepCandidates(config2) {
  return [...new Set([config2.ripgrepPath, process.env.RIPGREP_PATH, rgPath, "rg"].filter(Boolean))];
}

function buildRipgrepArgs(options, config2) {
  const args = ["--files", "--color=never"];
  if (!options.caseSensitive) args.push("--glob-case-insensitive");
  if (options.noIgnore) args.push("--no-ignore");
  if (options.includeHidden) args.push("--hidden");
  for (const pattern of options.patterns) args.push("--glob", pattern);
  if (!options.noIgnore) {
    for (const glob of config2.commonExcludes) args.push("--glob", `!${glob}`);
  }
  if (process.platform === "darwin") {
    for (const glob of MACOS_PROTECTED_VOLUME_GLOBS) args.push("--glob", `!${glob}`);
  }
  for (const pattern of options.exclude) args.push("--glob", `!${pattern}`);
  args.push("--", ".");
  return args;
}

function toRipgrepFailure(detail, code, options) {
  const message = detail || `ripgrep exited with code ${code}.`;
  if (classifyRipgrepStderr(message) !== "invalid_glob") return new FindFilesError("IO_ERROR", message);
  const at = attributeGlobFailure(message, [
    { field: "find_files.patterns", values: options.patterns },
    { field: "find_files.exclude", values: options.exclude, negated: true }
  ]);
  return new FindFilesError("INVALID_GLOB", at ? `${message} (${formatGlobFailureLocation(at)})` : message, at);
}

function planInvalidGlobRetry(error2, options, remaining) {
  if (!(error2 instanceof FindFilesError) || error2.code !== "INVALID_GLOB" || !error2.at) return void 0;
  if (error2.at.field !== "find_files.patterns") return void 0;
  if (remaining.length <= 1 || !remaining.includes(error2.at.pattern)) return void 0;
  return {
    remaining: remaining.filter((pattern) => pattern !== error2.at.pattern),
    // `at.index` indexes the list ripgrep was *just* handed, which shrinks after each dropped
    // pattern; the caller needs the position inside the batch it asked for. Patterns are unique
    // after normalizeInput, so the text maps back to exactly one slot.
    index: options.patterns.indexOf(error2.at.pattern),
    pattern: error2.at.pattern
  };
}

async function tryFindWithRipgrep(executable, options, config2, signal) {
  const gitignore = options.noIgnore ? [] : await loadRootGitignore(options.scopeRoot);
  return new Promise((resolve, reject) => {
    const child = (0, import_node_child_process2.spawn)(executable, buildRipgrepArgs(options, config2), {
      cwd: options.scopeRealPath,
      stdio: ["ignore", "pipe", "pipe"],
      signal
    });
    const paths = [];
    const seen = /* @__PURE__ */ new Set();
    const reasons = /* @__PURE__ */ new Set();
    let pending = "";
    let stderr = "";
    let settled = false;
    let unavailable = false;
    const finish = (value, error2) => {
      if (settled) return;
      settled = true;
      if (error2) reject(error2);
      else resolve(value);
    };
    const accept = (line) => {
      const value = line.trim();
      if (!value) return;
      const absolute = import_node_path2.default.isAbsolute(value) ? value : import_node_path2.default.resolve(options.scopeRealPath, value);
      const workspaceRelative = displayPath(options.scopeRoot, absolute);
      const scopeRelative = import_node_path2.default.relative(options.scopeRealPath, absolute).split(import_node_path2.default.sep).join("/");
      if (!options.includeHidden && isHiddenPath(workspaceRelative)) return;
      if (process.platform === "darwin" && matchesAny(workspaceRelative, MACOS_PROTECTED_VOLUME_GLOBS, true)) return;
      if (!options.noIgnore && matchesAny(workspaceRelative, config2.commonExcludes, true)) return;
      if (!options.noIgnore && gitignoreMatches(workspaceRelative, gitignore)) return;
      if (matchesScopedAny(scopeRelative, options.exclude, options.caseSensitive)) return;
      if (!matchesScopedAny(scopeRelative, options.patterns, options.caseSensitive)) return;
      if (seen.has(workspaceRelative)) return;
      seen.add(workspaceRelative);
      if (paths.length >= config2.maxCandidates) {
        reasons.add("MAX_CANDIDATES");
        child.kill();
        return;
      }
      paths.push(absolute);
    };
    child.on("error", (error2) => {
      if (error2.code === "ENOENT") {
        unavailable = true;
        finish(null);
        return;
      }
      finish(null, error2);
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      while (true) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        accept(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 16e3) stderr = stderr.slice(-16e3);
    });
    child.on("close", (code, signalName) => {
      if (unavailable || settled) return;
      if (pending) accept(pending);
      if (code !== 0 && code !== 1 && !(signalName && reasons.has("MAX_CANDIDATES"))) {
        finish(null, toRipgrepFailure(stderr.trim(), code, options));
        return;
      }
      finish({
        engine: "ripgrep",
        paths,
        candidateCount: paths.length,
        truncationReasons: reasons
      });
    });
  });
}

async function findWithNode(options, config2, signal, checkPermission) {
  const paths = [];
  const reasons = /* @__PURE__ */ new Set();
  const gitignore = options.noIgnore ? [] : await loadRootGitignore(options.scopeRoot);
  const stack = [options.scopeRealPath];
  while (stack.length > 0) {
    if (signal?.aborted) throw new DOMException("File discovery was cancelled.", "AbortError");
    const directory = stack.pop();
    let entries;
    try {
      entries = await (0, import_promises3.readdir)(directory, { withFileTypes: true });
    } catch (error2) {
      const code = error2.code;
      if (code === "EACCES" || code === "EPERM") continue;
      throw error2;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = import_node_path2.default.join(directory, entry.name);
      const workspaceRelative = displayPath(options.scopeRoot, absolute);
      const scopeRelative = import_node_path2.default.relative(options.scopeRealPath, absolute).split(import_node_path2.default.sep).join("/");
      if (!options.includeHidden && isHiddenPath(workspaceRelative)) continue;
      if (process.platform === "darwin" && matchesAny(workspaceRelative, MACOS_PROTECTED_VOLUME_GLOBS, true)) continue;
      if (!options.noIgnore && matchesAny(workspaceRelative, config2.commonExcludes, true)) continue;
      if (!options.noIgnore && gitignoreMatches(workspaceRelative, gitignore)) continue;
      if (matchesScopedAny(scopeRelative, options.exclude, options.caseSensitive)) continue;
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!matchesScopedAny(scopeRelative, options.patterns, options.caseSensitive)) continue;
      if (checkPermission && !await checkPermission(absolute)) continue;
      if (paths.length >= config2.maxCandidates) {
        reasons.add("MAX_CANDIDATES");
        return { engine: "node", paths, candidateCount: paths.length, truncationReasons: reasons };
      }
      paths.push(absolute);
    }
  }
  return { engine: "node", paths, candidateCount: paths.length, truncationReasons: reasons };
}

async function findWithPreferredEngine(options, config2, signal, checkPermission) {
  if (!checkPermission) {
    for (const candidate of ripgrepCandidates(config2)) {
      try {
        const result = await tryFindWithRipgrep(candidate, options, config2, signal);
        if (result) return result;
      } catch (error2) {
        if (error2?.name === "AbortError") throw error2;
        if (error2 instanceof FindFilesError) throw error2;
      }
    }
  }
  return findWithNode(options, config2, signal, checkPermission);
}

async function mapWithConcurrency(values, concurrency, fn) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await fn(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function enrichFiles(paths, options, config2) {
  const files = await mapWithConcurrency(paths, config2.statConcurrency, async (filePath) => {
    const fileStat = await (0, import_promises3.stat)(filePath);
    return {
      path: displayPath(options.scopeRoot, filePath),
      size_bytes: fileStat.size,
      modified_ms: fileStat.mtimeMs
    };
  });
  if (options.sort === "path_asc") {
    files.sort((a, b) => a.path.localeCompare(b.path));
  } else {
    files.sort((a, b) => b.modified_ms - a.modified_ms || a.path.localeCompare(b.path));
  }
  return files;
}

function normalizeError2(error2) {
  if (error2 instanceof FindFilesError) throw error2;
  if (error2?.name === "AbortError") throw new FindFilesError("ABORTED", "File discovery was cancelled.");
  const code = error2?.code;
  if (code === "ENOENT") throw new FindFilesError("FILE_NOT_FOUND", "Search directory or candidate file no longer exists.");
  if (code === "EACCES" || code === "EPERM") throw new FindFilesError("PERMISSION_DENIED", "Permission denied during file discovery.");
  throw new FindFilesError("IO_ERROR", error2?.message || "Unexpected file discovery I/O error.");
}

async function findFiles(input, context) {
  const config2 = { ...DEFAULT_FIND_FILES_CONFIG, ...context.config };
  try {
    const normalized = normalizeInput(input, config2);
    const scope = await resolveSafeScope(normalized.scopeDisplay, context.workspaceRoots);
    const scopeDisplay = import_node_path2.default.relative(scope.root, scope.realPath).split(import_node_path2.default.sep).join("/") || ".";
    const options = { ...normalized, scopeDisplay, scopeRealPath: scope.realPath, scopeRoot: scope.root };
    if (context.signal?.aborted) throw new DOMException("File discovery was cancelled.", "AbortError");
    if (context.checkPermission && !await context.checkPermission(options.scopeRealPath)) {
      throw new FindFilesError("PERMISSION_DENIED", "Discovering files in this directory is not permitted by the current policy.");
    }
    let remaining = [...options.patterns];
    const invalidPatterns = [];
    let candidates;
    for (; ; ) {
      try {
        candidates = await findWithPreferredEngine(
          { ...options, patterns: remaining },
          config2,
          context.signal,
          context.checkPermission
        );
        break;
      } catch (error2) {
        const retry = planInvalidGlobRetry(error2, options, remaining);
        if (!retry) throw error2;
        invalidPatterns.push({ index: retry.index, pattern: retry.pattern });
        remaining = retry.remaining;
      }
    }
    const files = await enrichFiles(candidates.paths, options, config2);
    if (files.length > options.maxResults) candidates.truncationReasons.add("MAX_RESULTS");
    const bounded = files.slice(0, options.maxResults);
    return {
      patterns: options.patterns,
      scope: options.scopeDisplay,
      engine: candidates.engine,
      sort: options.sort,
      files: bounded,
      summary: {
        candidate_paths: candidates.candidateCount,
        returned_files: bounded.length,
        truncated: candidates.truncationReasons.size > 0,
        truncation_reasons: [...candidates.truncationReasons],
        ...invalidPatterns.length > 0 ? { invalid_patterns: invalidPatterns } : {}
      }
    };
  } catch (error2) {
    return normalizeError2(error2);
  }
}

function formatFindFilesForModel(result) {
  const parts = [
    "=== FIND_FILES BEGIN ===",
    `patterns: ${JSON.stringify(result.patterns)}`,
    `scope: ${JSON.stringify(result.scope)}`,
    `engine: ${result.engine}`,
    `sort: ${result.sort}`,
    `collected_candidate_paths: ${result.summary.candidate_paths}`,
    `returned_files: ${result.summary.returned_files}`,
    `truncated: ${result.summary.truncated}`,
    "--- FILES ---"
  ];
  for (const file of result.files) parts.push(file.path);
  if (result.files.length === 0) parts.push("(no matching files)");
  if (result.summary.truncated) {
    parts.push(
      `NOTE: File discovery was bounded (${result.summary.truncation_reasons.join(", ")}). Narrow the scope/patterns or increase max_results when more paths are truly needed.`
    );
  }
  if (result.engine === "node") parts.push("NOTE: ripgrep was unavailable or per-file permission checks required the Node fallback engine.");
  if (result.summary.invalid_patterns) {
    parts.push(`invalid_patterns: ${JSON.stringify(result.summary.invalid_patterns)}`);
  }
  parts.push("=== FIND_FILES END ===");
  return parts.join("\n");
}

export { DEFAULT_FIND_FILES_CONFIG, FindFilesError, MACOS_PROTECTED_VOLUME_GLOBS, buildRipgrepArgs, canonicalRoots2, displayPath, enrichFiles, findFiles, findWithNode, findWithPreferredEngine, formatFindFilesForModel, gitignoreMatches, import_node_child_process2, import_node_path2, import_promises3, isHiddenPath, isInsideRoot2, loadRootGitignore, mapWithConcurrency, matchesAny, matchesGlob, matchesScopedAny, normalizeError2, normalizeInput, planInvalidGlobRetry, resolveSafeScope, ripgrepCandidates, toRipgrepFailure, tryFindWithRipgrep, validateGlob };
