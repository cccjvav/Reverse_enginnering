// Hand-written types for reconstructed/bridge-core/src/file-tool-input-compat.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  The author imports three of these at recovered
//               src/bridge-tool-dispatcher.ts:6-10 and uses them at lines 238,
//               241 and 301. Line 301 is the informative one: they write
//               `normalizeFileToolInput(toolName, args) as Record<string, unknown>`.
//               That cast is evidence the function does NOT return a record -
//               it passes non-objects straight through - so typing the return
//               as Record<string, unknown> would contradict their own code.
//   OBSERVED    Alias tables and fold order are literals in the shipped module
//               (lines 5, 7, 40, 101-102, 114).
//   INFERRED    `invalid()` never returns normally; it always throws. Typed as
//               `never` so callers get correct control-flow narrowing.
//
// This module exists to accept the several spellings different MCP clients send
// for the same argument, and to fold them onto the canonical one.

/** Accepted spellings for a read range's start, in precedence order. */
export const READ_START_KEYS: readonly ['start_line', 'start', 'startLine', 'line_start'];
/** Accepted spellings for a read range's end, in precedence order. */
export const READ_END_KEYS: readonly ['end_line', 'end', 'endLine', 'line_end'];

/** True for objects that are neither null nor arrays. */
export function isObject2(value: unknown): value is Record<string, unknown>;

/** Own-property check that is safe on objects with no prototype. */
export function hasOwn(row: object, key: string): boolean;

/**
 * Structural equality via JSON.
 *
 * Returns false rather than throwing on values that cannot be serialised, such
 * as circular structures.
 */
export function sameJsonValue(left: unknown, right: unknown): boolean;

/**
 * Raises a caller-facing argument error.
 *
 * Always throws - the return type is `never`, so control flow narrows
 * correctly after a call.
 *
 * @throws Error prefixed `INVALID_ARGUMENT:`.
 */
export function invalid(message: string): never;

/**
 * Accepts either a string or a one-element string array as a single scope.
 *
 * @throws via invalid() if the value is neither.
 */
export function singleSearchScope(value: unknown, key: string): string;

/**
 * Collapses the alias keys onto `canonical`, in place.
 *
 * The first present alias wins. Conflicting values for the same logical
 * argument are rejected rather than silently resolved.
 */
export function foldLineAliases(
	row: Record<string, unknown>,
	keys: readonly string[],
	canonical: string
): void;

/** Expands a bare path string into `{ path }`; other values pass through. */
export function normalizeReadRequest(value: unknown): unknown;

/** Normalises one request, an array of them, or a bare string, into a list. */
export function normalizeReadCollection(value: unknown): unknown;

/** Folds the files/paths/path/file selectors and line aliases for read_files. */
export function normalizeReadInput(
	input: Record<string, unknown>
): Record<string, unknown>;

/** Folds the pattern/query/regex aliases and scope shapes for search_files. */
export function normalizeSearchInput(
	input: Record<string, unknown>
): Record<string, unknown>;

/** Maps the legacy `read_file` alias onto `read_files`; others unchanged. */
export function normalizeFileToolName(name: string): string;

/** True only for `read_file`, the one back-compatibility alias. */
export function isFileToolCompatibilityAlias(name: string): boolean;

/**
 * Normalises a tool's arguments to their canonical spelling.
 *
 * Returns the input unchanged when it is not an object, and for tools that need
 * no normalisation - which is why the result is `unknown` rather than a record,
 * and why the author casts at the call site.
 */
export function normalizeFileToolInput(toolName: string, input: unknown): unknown;
