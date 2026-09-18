// Hand-written types for reconstructed/bridge-core/src/custom-tool-migration.js
//
// PROVENANCE — the author imports migrateLegacySkillDirs
// (bridge-server.ts), so the export name is FIRST-HAND. OBSERVED: the
// once-per-root guard and the empty-array returns are explicit in the code.

/**
 * Roots already migrated this process.
 *
 * Module-level and never cleared, which is what makes migration
 * once-per-process rather than once-per-call.
 */
export const migratedLegacyRoots: Set<string>;

/**
 * Moves skills from the legacy directory to the current one.
 *
 * Returns the names moved, or an empty array when the root was already
 * processed or the legacy directory does not exist. Never throws: a migration
 * failure must not stop the workspace loading.
 */
export function migrateLegacySkillDirs(
	root: string,
	log?: (message: string) => void
): string[];
