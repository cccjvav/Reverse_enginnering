// RECONSTRUCTED from src/file-tool-input-compat.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


var READ_START_KEYS = ["start_line", "start", "startLine", "line_start"];

var READ_END_KEYS = ["end_line", "end", "endLine", "line_end"];

function isObject2(value) {
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

function invalid(message) {
  throw new Error(`INVALID_ARGUMENT: ${message}`);
}

function singleSearchScope(value, key) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== "string") {
    invalid(`search_files.${key} must contain exactly one path; use separate calls for multiple scopes.`);
  }
  return value[0];
}

function normalizeSearchInput(input) {
  const output = { ...input };
  const patternKeys = ["pattern", "query", "regex"].filter((key) => hasOwn(output, key));
  if (patternKeys.length > 0) {
    const pattern = output[patternKeys[0]];
    for (const key of patternKeys.slice(1)) {
      if (!sameJsonValue(pattern, output[key])) {
        invalid(`search_files received conflicting ${patternKeys.join("/")} values.`);
      }
    }
    output.pattern = pattern;
    if (hasOwn(output, "regex")) {
      if (hasOwn(output, "is_regex") && output.is_regex !== true) {
        invalid("search_files.regex conflicts with is_regex=false.");
      }
      output.is_regex = true;
    }
    delete output.query;
    delete output.regex;
  }
  if (hasOwn(output, "file_pattern")) {
    const legacyPattern = output.file_pattern;
    if (hasOwn(output, "include") && !sameJsonValue(output.include, [legacyPattern])) {
      invalid("search_files.file_pattern conflicts with include.");
    }
    output.include = [legacyPattern];
    delete output.file_pattern;
  }
  const scopeKeys = ["path", "paths", "files"].filter((key) => hasOwn(output, key));
  if (scopeKeys.length > 0) {
    const scope = scopeKeys[0] === "path" ? output.path : singleSearchScope(output[scopeKeys[0]], scopeKeys[0]);
    for (const key of scopeKeys.slice(1)) {
      const candidate = key === "path" ? output.path : singleSearchScope(output[key], key);
      if (!sameJsonValue(scope, candidate)) {
        invalid(`search_files received conflicting ${scopeKeys.join("/")} scopes.`);
      }
    }
    output.path = scope;
    delete output.paths;
    delete output.files;
  }
  return output;
}

function foldLineAliases(row, keys, canonical) {
  const present = keys.filter((key) => hasOwn(row, key));
  if (present.length === 0) return;
  const value = row[present[0]];
  for (const key of present.slice(1)) {
    if (!sameJsonValue(value, row[key])) {
      invalid(`read_files received conflicting ${present.join("/")} values.`);
    }
  }
  row[canonical] = value;
  for (const key of keys) {
    if (key !== canonical) delete row[key];
  }
}

function normalizeReadRequest(value) {
  if (typeof value === "string") return { path: value };
  if (!isObject2(value)) return value;
  const output = { ...value };
  foldLineAliases(output, READ_START_KEYS, "start_line");
  foldLineAliases(output, READ_END_KEYS, "end_line");
  return output;
}

function normalizeReadCollection(value) {
  if (Array.isArray(value)) return value.map(normalizeReadRequest);
  if (typeof value === "string" || isObject2(value)) return [normalizeReadRequest(value)];
  return value;
}

function normalizeReadInput(input) {
  const output = { ...input };
  const selectorKeys = ["files", "paths", "path", "file"].filter((key) => hasOwn(output, key));
  if (selectorKeys.length === 0) return output;
  const candidates = selectorKeys.map((key) => {
    if (key === "files" || key === "paths") return normalizeReadCollection(output[key]);
    const request = { path: output[key] };
    for (const rangeKey of [...READ_START_KEYS, ...READ_END_KEYS]) {
      if (hasOwn(output, rangeKey)) request[rangeKey] = output[rangeKey];
    }
    return [normalizeReadRequest(request)];
  });
  const files = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (!sameJsonValue(files, candidate)) {
      invalid(`read_files received conflicting ${selectorKeys.join("/")} selectors.`);
    }
  }
  if ((hasOwn(output, "paths") || hasOwn(output, "files")) && selectorKeys.every((key) => key !== "path" && key !== "file")) {
    const hasTopLevelRange = [...READ_START_KEYS, ...READ_END_KEYS].some((key) => hasOwn(output, key));
    if (hasTopLevelRange) {
      invalid("read_files top-level line ranges require a single path.");
    }
  }
  output.files = files;
  delete output.paths;
  delete output.path;
  delete output.file;
  for (const key of [...READ_START_KEYS, ...READ_END_KEYS]) delete output[key];
  return output;
}

function normalizeFileToolName(name) {
  return name === "read_file" ? "read_files" : name;
}

function isFileToolCompatibilityAlias(name) {
  return name === "read_file";
}

function normalizeFileToolInput(toolName, input) {
  if (!isObject2(input)) return input;
  const canonicalName = normalizeFileToolName(toolName);
  if (canonicalName === "search_files") return normalizeSearchInput(input);
  if (canonicalName === "read_files") return normalizeReadInput(input);
  return input;
}

export { READ_END_KEYS, READ_START_KEYS, foldLineAliases, hasOwn, invalid, isFileToolCompatibilityAlias, isObject2, normalizeFileToolInput, normalizeFileToolName, normalizeReadCollection, normalizeReadInput, normalizeReadRequest, normalizeSearchInput, sameJsonValue, singleSearchScope };
