// Hand-written types for reconstructed/bridge-core/src/custom-tool-contract.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   OBSERVED    Every value here is a literal constant in the shipped module
//               (lines 6-40), so the names, values and the output schema shape
//               are read directly rather than inferred.
//   FIRST-HAND  `CUSTOM_TOOL_OUTPUT_SCHEMA` is imported by the author's
//               recovered src/bridge-mcp-transport.ts:15.
//
// This module is the shared vocabulary the other custom-tool modules build on,
// so it is typed first and kept dependency-free.

/** Workspace-relative directory holding custom tool manifests. */
export const CUSTOM_TOOLS_DIR_NAME: '.shuncode/mcp-tools';
/** Skills live in the same directory; kept as a separate name for clarity. */
export const SKILLS_DIR_NAME: '.shuncode/mcp-tools';
/** Older location, still migrated away from on load. */
export const LEGACY_SKILLS_DIR_NAME: '.shuncode/skills';

/** Sidecar file that customises a skill's tool surface. */
export const SKILL_SIDECAR_FILE: 'skill-tool.json';

/**
 * JSON Schema every custom tool's output is validated against.
 *
 * `additionalProperties` is true, so a tool may return extra fields; the four
 * required keys are the contract the bridge relies on.
 */
export const CUSTOM_TOOL_OUTPUT_SCHEMA: {
	readonly type: 'object';
	readonly properties: {
		readonly exit_code: { readonly type: readonly ['integer', 'null'] };
		readonly timed_out: { readonly type: 'boolean' };
		readonly aborted: { readonly type: 'boolean' };
		readonly duration_ms: { readonly type: 'integer' };
	};
	readonly required: readonly ['exit_code', 'timed_out', 'aborted', 'duration_ms'];
	readonly additionalProperties: true;
};

/** Tool names must be snake_case, start with a letter, max 64 chars. */
export const TOOL_NAME_PATTERN: RegExp;

export const MIN_DESCRIPTION_LENGTH: number;
export const MAX_DESCRIPTION_LENGTH: number;
export const MIN_TIMEOUT_MS: number;
export const MAX_TIMEOUT_MS: number;
export const DEFAULT_TIMEOUT_MS: number;

/**
 * Names a custom tool may not take: the built-in file and IDE tools, plus two
 * aliases. Shadowing a built-in is rejected at load time with "reserved-name".
 */
export const RESERVED_TOOL_NAMES: ReadonlySet<string>;

/** Narrows to a plain object - arrays and null are excluded. */
export function isRecord(value: unknown): value is Record<string, unknown>;
