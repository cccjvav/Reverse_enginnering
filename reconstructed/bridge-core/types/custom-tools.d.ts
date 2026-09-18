// Hand-written types for reconstructed/bridge-core/src/custom-tools.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  `CustomToolManifest` and `CustomToolStatusEntry` are the
//               author's own type names, imported by recovered
//               src/bridge-tool-dispatcher.ts:3, src/bridge-mcp-transport.ts:15
//               and src/bridge-constants.ts:1. The author's own wrapper
//               (bridge-tool-dispatcher.ts:219) declares the return type of
//               findCustomTool as `CustomToolManifest | undefined`, which is
//               why the optionality here is fact rather than a guess.
//               bridge-constants.ts:328 uses `CustomToolStatusEntry[]`.
//   OBSERVED    The manifest field set comes from the construction site in
//               custom-tool-skill.js:263-273, and the status-entry field set
//               from toStatusEntries (custom-tools.js:54), which also fixes the
//               `source` discriminator to "skill" | "manifest".
//   INFERRED    `options.skillsEnabled` is optional and defaults to enabled:
//               the implementation tests `!== false` (line 33), and the author
//               passes `skillsEnabled?.() ?? true` at the call site.

/**
 * A loaded custom tool.
 *
 * Field set from the skill loader's return literal (custom-tool-skill.js:263).
 * Manifest-sourced tools omit `skillDir`, which is exactly what toStatusEntries
 * uses to tell the two origins apart.
 */
export interface CustomToolManifest {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	/** JSON Schema for the tool's arguments. */
	readonly inputSchema: Record<string, unknown>;
	/** Argv used to run the tool. */
	readonly command: readonly string[];
	readonly timeoutMs: number;
	readonly enabled: boolean;
	/** Absolute path of the file this tool was defined in. */
	readonly sourcePath: string;
	/** Present only for skill-backed tools; absent for plain manifests. */
	readonly skillDir?: string;
}

/** Where a tool came from. Discriminator assigned in toStatusEntries:55. */
export type CustomToolSource = 'skill' | 'manifest';

/** Condensed view used by BridgeStatus (bridge-constants.ts:328). */
export interface CustomToolStatusEntry {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	readonly enabled: boolean;
	readonly source: CustomToolSource;
}

/** Load-time switches. */
export interface CustomToolLoadOptions {
	/**
	 * Skill-backed tools are loaded unless this is explicitly false; the
	 * implementation tests `!== false`, so undefined means enabled.
	 */
	readonly skillsEnabled?: boolean;
}

/** Logger sink. Optional at every call site in the shipped code. */
export type CustomToolLog = (message: string) => void;

export const MAX_MANIFESTS_PER_ROOT: number;

/**
 * Loads every custom tool visible from the given roots, enabled or not.
 *
 * Later roots do not override earlier ones: the loader keys a Map by tool name,
 * so the first root to define a name wins.
 */
export function loadCustomTools(
	workspaceRoots: readonly string[],
	log?: CustomToolLog,
	options?: CustomToolLoadOptions
): CustomToolManifest[];

/** As loadCustomTools, filtered to `enabled`. */
export function listEnabledCustomTools(
	workspaceRoots: readonly string[],
	log?: CustomToolLog,
	options?: CustomToolLoadOptions
): CustomToolManifest[];

/**
 * Finds one enabled tool by name.
 *
 * Returns undefined when absent - disabled tools are invisible here, so a
 * caller cannot accidentally execute one.
 */
export function findCustomTool(
	workspaceRoots: readonly string[],
	name: string,
	log?: CustomToolLog,
	options?: CustomToolLoadOptions
): CustomToolManifest | undefined;

export function toStatusEntries(
	tools: readonly CustomToolManifest[]
): CustomToolStatusEntry[];

/**
 * Stable digest of the tool set, as `name:0|1` pairs sorted and joined.
 *
 * Only names and enabled flags take part, so edits to a tool's body do not
 * change the fingerprint.
 */
export function customToolsFingerprint(
	tools: readonly CustomToolManifest[]
): string;

// Re-exported from the shared contract module.
export { CUSTOM_TOOL_OUTPUT_SCHEMA, CUSTOM_TOOLS_DIR_NAME } from './custom-tool-contract.js';
// Re-exported from the sandbox module.
export { executeCustomTool } from './custom-tool-sandbox.js';
