// EXTRACTED from src/managed-terminal-lifecycle.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var MANAGED_TERMINAL_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1e3;
function managedTerminalIdleDelay(lastUsedAt, now = Date.now()) {
  return Math.max(0, lastUsedAt + MANAGED_TERMINAL_IDLE_TIMEOUT_MS - now);
}
function isManagedTerminalIdleExpired(lastUsedAt, now = Date.now()) {
  return managedTerminalIdleDelay(lastUsedAt, now) === 0;
}
