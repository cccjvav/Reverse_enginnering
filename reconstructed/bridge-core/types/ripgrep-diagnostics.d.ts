// Hand-written types for reconstructed/bridge-core/src/ripgrep-diagnostics.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE for the type names. The module is ~60
// lines of string handling and every behaviour is directly observable.
//
//   OBSERVED    The two signature regexes, the three classification outcomes,
//               and the two-pass attribution in attributeGlobFailure.
//   INFERRED    `negated` is optional on a group because the implementation
//               reads it via Boolean(group.negated).
//
// Purpose: ripgrep reports a bad glob by echoing it back in stderr without
// saying which argument it came from. These helpers map the echoed text onto
// the caller's own patterns so the error can name the offending field.

/** What a ripgrep stderr blob indicates. */
export type RipgrepFailureKind = 'invalid_regex' | 'invalid_glob' | 'unknown';

export const INVALID_REGEX_SIGNATURE: RegExp;
export const INVALID_GLOB_SIGNATURE: RegExp;

/** A caller-supplied group of glob patterns, e.g. include or exclude. */
export interface GlobFailureGroup {
	/** Argument name reported back to the user. */
	field: string;
	values: readonly string[];
	/** True for exclusions, which ripgrep echoes with a leading "!". */
	negated?: boolean;
}

/** Which of the caller's patterns ripgrep rejected. */
export interface GlobFailureLocation {
	field: string;
	/** Position within that field's values. */
	index: number;
	pattern: string;
}

export function classifyRipgrepStderr(stderr: string): RipgrepFailureKind;

/** Extracts the glob bodies ripgrep echoed back, in order. */
export function globErrorEchoBodies(detail: string): string[];

/**
 * Maps echoed text onto the caller's patterns.
 *
 * Non-negated groups are searched before negated ones, and the longest match
 * wins - shorter patterns can appear as substrings of longer ones, so
 * preferring length avoids blaming the wrong argument.
 *
 * Returns undefined when nothing was echoed or nothing matched.
 */
export function attributeGlobFailure(
	detail: string,
	groups: readonly GlobFailureGroup[]
): GlobFailureLocation | undefined;

/** Longest echoed pattern within one group, or undefined. */
export function echoedNeedleHit(
	echoed: readonly string[],
	group: GlobFailureGroup
): GlobFailureLocation | undefined;

/** Renders a location as `field[index] "pattern"`. */
export function formatGlobFailureLocation(location: GlobFailureLocation): string;
