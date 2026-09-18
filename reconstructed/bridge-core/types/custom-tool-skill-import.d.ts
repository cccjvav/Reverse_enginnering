// Hand-written types for reconstructed/bridge-core/src/custom-tool-skill-import.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  `SkillImportResult` and `SkillRunnerResult` are the author's
//               own type names, imported at recovered src/bridge-server.ts:14
//               and used as the declared result types of their importSkill
//               (line 294) and generateSkillRunner (line 323) wrappers. Those
//               wrappers also show both functions are synchronous despite the
//               async callers, and that the log callback is a plain
//               (message: string) => void.
//   OBSERVED    Field sets from the return literals: line 132 for an import,
//               lines 157 and 160 for runner generation, line 56-57 for name
//               de-duplication.
//   INFERRED    `generated` is the discriminant on SkillRunnerResult, because
//               `runnerRel` is set only on the generated branch. Modelled as a
//               union so reading runnerRel forces a check first.

/**
 * Outcome of importing a skill from a file, directory or archive.
 *
 * `renamedFrom` and `generatedRunner` are present only when something was
 * adjusted during import, so their absence is meaningful.
 */
export interface SkillImportResult {
	/** Final skill name, which may differ from the requested one. */
	readonly name: string;
	/** Absolute path of the installed skill directory. */
	readonly directory: string;
	/**
	 * Set when the requested name was taken and a `-2`..`-99` suffix was added.
	 * Import fails rather than overwriting an existing skill.
	 */
	readonly renamedFrom?: string;
	/** Relative path of an entry script written because none was shipped. */
	readonly generatedRunner?: string;
}

/** A skill that already had a usable entry script; nothing was written. */
export interface SkillRunnerUnchanged {
	readonly name: string;
	readonly dirName: string;
	readonly generated: false;
}

/** A skill that had no entry script, so one was generated. */
export interface SkillRunnerGenerated {
	readonly name: string;
	readonly dirName: string;
	readonly generated: true;
	/** Path of the written runner, relative to the skill directory. */
	readonly runnerRel: string;
}

export type SkillRunnerResult = SkillRunnerUnchanged | SkillRunnerGenerated;

/** Name chosen for an incoming skill, plus the original if it was taken. */
export interface AvailableSkillName {
	readonly name: string;
	readonly renamedFrom?: string;
}

export type SkillImportLog = (message: string) => void;

/** Filename holding a skill's instructions. */
export const SKILL_FILE: string;
/** Relative path used for a generated entry script. */
export const GENERATED_RUNNER_REL: string;
/** Source written to that path. It echoes the SKILL.md instructions back. */
export const GENERATED_RUNNER_SOURCE: string;
/** Archives larger than this are refused before extraction. */
export const MAX_ARCHIVE_BYTES: number;
/** Archives with more entries than this are refused. */
export const MAX_ENTRIES: number;
/** Permitted skill-name shape. */
export const NAME_PATTERN: RegExp;

/**
 * Imports a skill into the workspace.
 *
 * Synchronous despite the I/O. Extraction runs in a temporary staging
 * directory, so a rejected archive leaves the workspace untouched.
 *
 * @throws if the source does not exist, the archive is too large or has too
 * many entries, an entry escapes the staging directory, or no SKILL.md is
 * found.
 */
export function importSkill(
	root: string,
	source: string,
	log?: SkillImportLog
): SkillImportResult;

/**
 * Ensures a skill has a runnable entry script.
 *
 * Returns `generated: false` when one already exists.
 *
 * @throws if the skill cannot be found, has no SKILL.md, or already declares an
 * `entry` in its frontmatter - a declared entry is never overwritten, so a
 * broken path must be fixed by hand rather than silently replaced.
 */
export function generateSkillRunner(
	root: string,
	name: string,
	log?: SkillImportLog
): SkillRunnerResult;

/** Picks a free directory name, suffixing `-2`..`-99` if the base is taken. */
export function availableSkillName(
	skillsDir: string,
	desired: string
): AvailableSkillName;

/** Reads the skill name from a SKILL.md's frontmatter or first heading. */
export function skillNameFromMarkdown(markdown: string): string | undefined;

/** Returns the frontmatter `entry`, if the document declares one. */
export function declaredFrontmatterEntry(markdown: string): string | undefined;

/** Finds the directory containing SKILL.md within an extracted tree. */
export function locateSkillRoot(dir: string): string | undefined;

/** Counts entries in an archive without extracting it. */
export function countEntries(archivePath: string): number;

/**
 * Validates one archive entry path.
 *
 * Returns false for absolute paths and anything traversing outside the target,
 * which is what stops a crafted archive writing over the workspace.
 */
export function safeArchiveEntry(entryPath: string): boolean;

/** Extracts an archive into a directory, enforcing the size and entry caps. */
export function extractArchive(archivePath: string, targetDir: string): void;

/** Writes the generated runner and returns its relative path. */
export function writeSkillRunner(skillDir: string): string;
