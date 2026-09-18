// Hand-written types for reconstructed/bridge-core/src/managed-command-risk.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE for the type names, but the produced
// value is consumed by managed-command-cancellation, whose
// ManagedCommandRiskLevel IS anchored to the author's own
// ManagedCommandCancellationPreview.
//
//   OBSERVED    NORMAL_RISK and highRisk (lines 5-8) fix the result shape; the
//               four regexes and two Sets are literals; classifyManagedCommandRisk
//               (line 171) shows any single high-risk invocation decides the
//               whole command.
//   INFERRED    reason and consequence are present only on the high branch,
//               so the result is a discriminated union on `level`.

import type { ManagedCommandRiskLevel } from './managed-command-cancellation.js';

export interface NormalRisk {
	readonly level: 'normal';
}

export interface HighRisk {
	readonly level: 'high';
	/** Why it was flagged, shown in the confirmation prompt. */
	readonly reason: string;
	/** What the user stands to lose, shown alongside the reason. */
	readonly consequence: string;
}

export type ManagedCommandRisk = NormalRisk | HighRisk;

/** Shared singleton for the common case; do not mutate. */
export const NORMAL_RISK: NormalRisk;

/** Script-name patterns treated as release or packaging operations. */
export const RELEASE_SCRIPT: RegExp;
export const ARCHIVE_SCRIPT: RegExp;
/** Package-manager subcommands that change installed state. */
export const PACKAGE_MUTATIONS: ReadonlySet<string>;
/** Package-manager subcommands that only read. */
export const PACKAGE_INSPECTION: ReadonlySet<string>;

/**
 * Classifies a command line.
 *
 * A command is high risk if ANY of its invocations is - it splits on shell
 * operators first, so `ls && rm -rf /` is not excused by its harmless start.
 */
export function classifyManagedCommandRisk(command: string): ManagedCommandRisk;

export function highRisk(reason: string, consequence: string): HighRisk;

/** Splits a command line into individual invocations across shell operators. */
export function parseInvocations(source: string): string[][];

/** Classifies one already-split invocation. */
export function classifyWords(original: readonly string[]): ManagedCommandRisk;

/** Unwraps sudo/env/nohup style prefixes to reach the real command. */
export function unwrapInvocation(original: readonly string[]): string[];

/** Drops leading flags; those in optionsWithValues also consume their value. */
export function stripLeadingOptions(
	words: readonly string[],
	optionsWithValues?: ReadonlySet<string>
): string[];

/** Basename of an executable, without directory or extension. */
export function executableName(value: string): string;

/** True when tar's flags indicate extraction or creation rather than listing. */
export function tarMutates(args: readonly string[]): boolean;

/** Classifies an npm/yarn/pnpm invocation by its subcommand. */
export function classifyPackageManager(
	executable: string,
	args: readonly string[]
): ManagedCommandRisk;

export type { ManagedCommandRiskLevel };
