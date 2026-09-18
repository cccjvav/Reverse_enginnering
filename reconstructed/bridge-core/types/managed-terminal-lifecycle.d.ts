// Hand-written types for reconstructed/bridge-core/src/managed-terminal-lifecycle.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE for the names; OBSERVED, the module is
// 15 lines.

/** How long an unused managed terminal is kept. Two hours. */
export const MANAGED_TERMINAL_IDLE_TIMEOUT_MS: number;

/** Milliseconds until the terminal expires; 0 once it already has. */
export function managedTerminalIdleDelay(lastUsedAt: number, now?: number): number;

/** True once the idle timeout has elapsed. */
export function isManagedTerminalIdleExpired(lastUsedAt: number, now?: number): boolean;
