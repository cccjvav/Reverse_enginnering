// RECONSTRUCTED from src/managed-terminal-lifecycle.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


var MANAGED_TERMINAL_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1e3;

function managedTerminalIdleDelay(lastUsedAt, now = Date.now()) {
  return Math.max(0, lastUsedAt + MANAGED_TERMINAL_IDLE_TIMEOUT_MS - now);
}

function isManagedTerminalIdleExpired(lastUsedAt, now = Date.now()) {
  return managedTerminalIdleDelay(lastUsedAt, now) === 0;
}

export { MANAGED_TERMINAL_IDLE_TIMEOUT_MS, isManagedTerminalIdleExpired, managedTerminalIdleDelay };
