// Hand-written types for reconstructed/bridge-core/src/custom-tool-skill.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  `SkillLoadDiagnosis` is the author's own type name, imported by
//               recovered src/bridge-server.ts:15 and used at lines 300-318.
//               That code both maps over `SkillLoadDiagnosis[]` and constructs
//               one by hand, which fixes the field set and shows a failing
//               diagnosis may still carry `name`.
//   OBSERVED    The reason-code and fix-action domains are the literal keys and
//               values of SKILL_LOAD_REASONS (line 34) and SKILL_LOAD_FIXES
//               (line 50) - all 13 codes and 4 actions, no inference needed.
//               The manifest shape comes from readSkillManifest's return
//               literal (line 263).
//   INFERRED    The success/failure split is modelled as a discriminated union
//               on `loaded`, because failSkill (line 66) always sets
//               reasonCode+reason+fix while the success path never does.

import type { CustomToolManifest } from './custom-tools.js';

/**
 * Why a skill failed to load.
 *
 * Exactly the keys of SKILL_LOAD_REASONS. "duplicate-name" is never produced by
 * this module - the author raises it in bridge-server.ts:314 after
 * cross-checking against JSON-defined tools - but it is part of the domain and
 * has entries in both lookup tables.
 */
export type SkillLoadReasonCode =
	| 'skills-disabled'
	| 'no-skill-md'
	| 'skill-md-too-large'
	| 'invalid-frontmatter'
	| 'invalid-name'
	| 'reserved-name'
	| 'description-too-short'
	| 'entry-configured-missing'
	| 'entry-missing'
	| 'entry-escapes-workspace'
	| 'entry-unsupported'
	| 'over-cap'
	| 'duplicate-name';

/** Remedial action the UI offers. Exactly the values of SKILL_LOAD_FIXES. */
export type SkillLoadFix =
	| 'enable-skills'
	| 'open-folder'
	| 'open-skill-md'
	| 'generate-runner';

/** A skill directory that loaded successfully. */
export interface SkillLoadSuccess {
	readonly dirName: string;
	readonly loaded: true;
	readonly name: string;
}

/**
 * A skill directory that did not load.
 *
 * `name` is optional because failSkill omits it, but the author's
 * duplicate-name case (bridge-server.ts:310) sets it - so a failure can carry
 * the name that caused the clash.
 */
export interface SkillLoadFailure {
	readonly dirName: string;
	readonly loaded: false;
	readonly name?: string;
	readonly reasonCode: SkillLoadReasonCode;
	/** Human-readable explanation, localised. */
	readonly reason: string;
	readonly fix: SkillLoadFix;
}

export type SkillLoadDiagnosis = SkillLoadSuccess | SkillLoadFailure;

/** Frontmatter accepted at the top of a SKILL.md. */
export interface SkillFrontmatter {
	readonly name?: string;
	readonly title?: string;
	readonly description?: string;
	/** Explicit entry script, relative to the skill directory. */
	readonly entry?: string;
	readonly [key: string]: string | undefined;
}

/** A parsed SKILL.md: its frontmatter block and the prose beneath it. */
export interface SkillDocument {
	readonly frontmatter: SkillFrontmatter;
	readonly body: string;
}

/** Optional overrides read from skill-tool.json next to SKILL.md. */
export interface SkillSidecar {
	readonly inputSchema?: Record<string, unknown>;
	readonly timeoutMs?: number;
	readonly enabled?: boolean;
}

export type SkillLog = (message: string) => void;
/** Callback used to report the first failure reason encountered. */
export type SkillReasonCollector = (code: SkillLoadReasonCode) => void;

export const MAX_SKILLS_PER_ROOT: number;
export const MAX_SKILL_BYTES: number;
export const SKILL_SIDECAR_FILE: string;
export const SKILL_ENTRY_CANDIDATES: readonly string[];
export const SKILL_LOAD_REASONS: Readonly<Record<SkillLoadReasonCode, string>>;
export const SKILL_LOAD_FIXES: Readonly<Record<SkillLoadReasonCode, SkillLoadFix>>;

/** Builds the standard failure diagnosis for a reason code. */
export function failSkill(
	dirName: string,
	reasonCode: SkillLoadReasonCode
): SkillLoadFailure;

/**
 * Reports on every skill directory under a root.
 *
 * Returns an empty array when the skills directory does not exist. Directories
 * past MAX_SKILLS_PER_ROOT are reported as "over-cap" rather than dropped, so
 * the cap is visible to the user instead of silently truncating.
 */
export function diagnoseSkillTools(
	root: string,
	log?: SkillLog,
	options?: { skillsEnabled?: boolean }
): SkillLoadDiagnosis[];

/** Loads the skills under a root as ordinary custom tools. */
export function loadSkillTools(
	root: string,
	log?: SkillLog
): CustomToolManifest[];

/** Reads and validates one skill directory. Undefined when it cannot load. */
export function readSkillManifest(
	root: string,
	skillDir: string,
	dirName: string,
	log?: SkillLog,
	collect?: SkillReasonCollector
): CustomToolManifest | undefined;

export function parseFrontmatter(raw: string): SkillFrontmatter | undefined;
export function parseSkillDocument(raw: string): SkillDocument | undefined;
export function readSidecar(skillDir: string, label: string, log?: SkillLog): SkillSidecar;
export function resolveSkillDir(root: string, dirName: string): string;

/** Composes the model-facing description from frontmatter and body. */
export function buildDescription(
	frontmatter: SkillFrontmatter,
	body: string
): string | undefined;

/** Resolves the argv for a skill's entry script. Undefined if unusable. */
export function entryCommand(
	root: string,
	skillDir: string,
	label: string,
	entry: string | undefined,
	log?: SkillLog,
	collect?: SkillReasonCollector
): string[] | undefined;

/** Locates a runnable entry script among SKILL_ENTRY_CANDIDATES. */
export function findSkillEntryScript(skillDir: string): string | undefined;

/** Strips one layer of matching quotes from a frontmatter value. */
export function unquote(value: string): string;
