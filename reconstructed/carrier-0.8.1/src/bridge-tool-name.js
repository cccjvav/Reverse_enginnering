// EXTRACTED from src/bridge-tool-name.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

function resolveBridgeToolName(rawName, isKnown) {
  const trimmed = rawName.trim();
  if (isKnown(trimmed)) return trimmed;
  const candidates = [];
  if (trimmed.startsWith("mcp__")) {
    const parts = trimmed.split("__");
    if (parts.length >= 3) candidates.push(parts.slice(2).join("__"));
    if (parts.length >= 2) candidates.push(parts.slice(1).join("__"));
  } else if (trimmed.startsWith("mcp_")) {
    const separator = trimmed.indexOf("_", 4);
    if (separator >= 0) candidates.push(trimmed.slice(separator + 1));
  }
  for (const candidate of candidates) {
    if (isKnown(candidate)) return candidate;
  }
  return trimmed;
}
