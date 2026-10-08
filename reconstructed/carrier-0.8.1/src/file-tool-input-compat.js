// EXTRACTED from src/file-tool-input-compat.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var READ_START_KEYS = ["start_line", "start", "startLine", "line_start"];
var READ_END_KEYS = ["end_line", "end", "endLine", "line_end"];
function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function hasOwn(row, key) {
  return Object.prototype.hasOwnProperty.call(row, key);
}
function sameJsonValue(left, right) {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
function invalid(message2) {
  throw new Error(`INVALID_ARGUMENT: ${message2}`);
}
function singleSearchScope(value, key) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== "string") {
    invalid(`search_files.${key} must contain exactly one path; use separate calls for multiple scopes.`);
  }
  return value[0];
}
function normalizeSearchInput(input) {
  const output2 = { ...input };
  const patternKeys = ["pattern", "query", "regex"].filter((key) => hasOwn(output2, key));
  if (patternKeys.length > 0) {
    const pattern = output2[patternKeys[0]];
    for (const key of patternKeys.slice(1)) {
      if (!sameJsonValue(pattern, output2[key])) {
        invalid(`search_files received conflicting ${patternKeys.join("/")} values.`);
      }
    }
    output2.pattern = pattern;
    if (hasOwn(output2, "regex")) {
      if (hasOwn(output2, "is_regex") && output2.is_regex !== true) {
        invalid("search_files.regex conflicts with is_regex=false.");
      }
      output2.is_regex = true;
    }
    delete output2.query;
    delete output2.regex;
  }
  if (hasOwn(output2, "file_pattern")) {
    const legacyPattern = output2.file_pattern;
    if (hasOwn(output2, "include") && !sameJsonValue(output2.include, [legacyPattern])) {
      invalid("search_files.file_pattern conflicts with include.");
    }
    output2.include = [legacyPattern];
    delete output2.file_pattern;
  }
  const scopeKeys = ["path", "paths", "files"].filter((key) => hasOwn(output2, key));
  if (scopeKeys.length > 0) {
    const scope = scopeKeys[0] === "path" ? output2.path : singleSearchScope(output2[scopeKeys[0]], scopeKeys[0]);
    for (const key of scopeKeys.slice(1)) {
      const candidate = key === "path" ? output2.path : singleSearchScope(output2[key], key);
      if (!sameJsonValue(scope, candidate)) {
        invalid(`search_files received conflicting ${scopeKeys.join("/")} scopes.`);
      }
    }
    output2.path = scope;
    delete output2.paths;
    delete output2.files;
  }
  return output2;
}
function foldLineAliases(row, keys, canonical2) {
  const present = keys.filter((key) => hasOwn(row, key));
  if (present.length === 0) return;
  const value = row[present[0]];
  for (const key of present.slice(1)) {
    if (!sameJsonValue(value, row[key])) {
      invalid(`read_files received conflicting ${present.join("/")} values.`);
    }
  }
  row[canonical2] = value;
  for (const key of keys) {
    if (key !== canonical2) delete row[key];
  }
}
function normalizeReadRequest(value) {
  if (typeof value === "string") return { path: value };
  if (!isObject(value)) return value;
  const output2 = { ...value };
  foldLineAliases(output2, READ_START_KEYS, "start_line");
  foldLineAliases(output2, READ_END_KEYS, "end_line");
  return output2;
}
function normalizeReadCollection(value) {
  if (Array.isArray(value)) return value.map(normalizeReadRequest);
  if (typeof value === "string" || isObject(value)) return [normalizeReadRequest(value)];
  return value;
}
function normalizeReadInput(input) {
  const output2 = { ...input };
  const selectorKeys = ["files", "paths", "path", "file"].filter((key) => hasOwn(output2, key));
  if (selectorKeys.length === 0) return output2;
  const candidates = selectorKeys.map((key) => {
    if (key === "files" || key === "paths") return normalizeReadCollection(output2[key]);
    const request = { path: output2[key] };
    for (const rangeKey of [...READ_START_KEYS, ...READ_END_KEYS]) {
      if (hasOwn(output2, rangeKey)) request[rangeKey] = output2[rangeKey];
    }
    return [normalizeReadRequest(request)];
  });
  const files = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (!sameJsonValue(files, candidate)) {
      invalid(`read_files received conflicting ${selectorKeys.join("/")} selectors.`);
    }
  }
  if ((hasOwn(output2, "paths") || hasOwn(output2, "files")) && selectorKeys.every((key) => key !== "path" && key !== "file")) {
    const hasTopLevelRange = [...READ_START_KEYS, ...READ_END_KEYS].some((key) => hasOwn(output2, key));
    if (hasTopLevelRange) {
      invalid("read_files top-level line ranges require a single path.");
    }
  }
  output2.files = files;
  delete output2.paths;
  delete output2.path;
  delete output2.file;
  for (const key of [...READ_START_KEYS, ...READ_END_KEYS]) delete output2[key];
  return output2;
}
function normalizeFileToolName(name) {
  return name === "read_file" ? "read_files" : name;
}
function isFileToolCompatibilityAlias(name) {
  return name === "read_file";
}
function normalizeFileToolInput(toolName, input) {
  if (!isObject(input)) return input;
  const canonicalName = normalizeFileToolName(toolName);
  if (canonicalName === "search_files") return normalizeSearchInput(input);
  if (canonicalName === "read_files") return normalizeReadInput(input);
  return input;
}
