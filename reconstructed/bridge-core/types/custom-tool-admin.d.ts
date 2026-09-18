// Hand-written types for reconstructed/bridge-core/src/custom-tool-admin.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  The author imports both functions at recovered
//               src/bridge-server.ts:12 and calls them as
//               `(workspaceRoots(), name, log)` at lines 334 and 350,
//               discarding the result.
//   OBSERVED    Return literals are at lines 39 and 44 of the shipped module;
//               the containment checks that guard them are at lines 37 and 41.
//   INFERRED    Nothing material - both functions are short and fully visible.

/**
 * The state now in force after a toggle.
 *
 * Only these two fields: the return literals at lines 24 and 30 of the shipped
 * module are `{ name, enabled }`. An earlier draft of this file added a `path`
 * field, which looked reasonable and was simply not there - the module writes
 * the file but does not report which one.
 */
export interface CustomToolToggleResult {
	readonly name: string;
	readonly enabled: boolean;
}

/** What a delete removed. */
export interface CustomToolDeleteResult {
	readonly name: string;
	/**
	 * Path that was removed: a skill directory, or a single manifest file.
	 */
	readonly deleted: string;
}

/**
 * Flips a custom tool's enabled flag and persists it.
 *
 * Skill-backed tools are toggled through their `skill-tool.json` sidecar,
 * which is created if absent; plain manifests are rewritten in place.
 *
 * @throws if the name is unknown, or if an existing sidecar is not a JSON
 * object - a malformed sidecar is reported rather than silently replaced.
 */
export function toggleCustomTool(
	workspaceRoots: readonly string[],
	name: string,
	log?: (message: string) => void
): CustomToolToggleResult;

/**
 * Deletes a custom tool.
 *
 * Refuses to touch anything outside the workspace's own tools or skills
 * directory, and a manifest must additionally end in `.json`. Those checks are
 * what stop a crafted `sourcePath` turning a delete into arbitrary removal, so
 * they must not be relaxed.
 *
 * @throws if the name is unknown, or the target lies outside those directories.
 */
export function deleteCustomTool(
	workspaceRoots: readonly string[],
	name: string,
	log?: (message: string) => void
): CustomToolDeleteResult;
