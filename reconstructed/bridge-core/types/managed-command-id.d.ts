// Hand-written types for reconstructed/bridge-core/src/managed-command-id.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE for the names; OBSERVED throughout, the
// module is ~30 lines of literals and two small functions.

/** Bytes of entropy in a generated id. */
export const MANAGED_COMMAND_ENTROPY_BYTES: number;
/** Accepts both the current hex form and the older numeric form. */
export const MANAGED_COMMAND_ID: RegExp;
/** Matches the `command_id:` prefix a model may echo back. */
export const MANAGED_COMMAND_ID_LABEL: RegExp;

/**
 * Generates `cmd_<48 hex chars>`.
 *
 * The entropy source is injectable for tests, and its output length is
 * checked - a short read throws rather than yielding a weak id.
 *
 * @throws if the source returns the wrong number of bytes.
 */
export function createManagedCommandId(
	entropy?: (size: number) => Uint8Array
): string;

/**
 * Strips a `command_id:` label and surrounding whitespace.
 *
 * Always returns a string - never undefined. An unrecognised value comes back
 * trimmed rather than rejected, leaving the caller's own lookup to fail. It
 * also calls `.trim()` directly, so the parameter is `string`, not `unknown`:
 * passing undefined would throw a TypeError rather than return a default.
 */
export function normalizeManagedCommandId(value: string): string;
