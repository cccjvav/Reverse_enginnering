// Hand-written types for reconstructed/bridge-core/src/canonical-diff.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE for the type names. The file entry shape
// IS anchored, though: apply-patch.js:716 builds exactly these objects before
// calling createCanonicalUnifiedDiff, so the input contract is corroborated by
// its only caller.
//
//   OBSERVED    Edit kinds are the three literals at lines 25-53; the defaults
//               at lines 5-7; renderHunks' contextLines default at line 117.
//   INFERRED    old_path/new_path are optional because apply-patch omits
//               old_path for an add and new_path for a delete.

/** What a line did between the two versions. */
export type DiffEditKind = 'equal' | 'insert' | 'delete';

export interface DiffEdit {
	kind: DiffEditKind;
	line: string;
}

/** Unified-diff context lines on each side of a change. */
export const DEFAULT_CONTEXT_LINES: number;
/**
 * Myers is abandoned past this edit distance.
 *
 * Beyond it the diff degrades to a whole-file replace, which keeps a
 * pathological input from hanging the tool - the output is still correct, just
 * less granular.
 */
export const MAX_MYERS_EDIT_DISTANCE: number;

/** One file's before/after state. Built by apply-patch before rendering. */
export interface CanonicalDiffFile {
	/**
	 * Includes 'move': renderFileDiff emits rename headers for it
	 * (canonical-diff.js:154), and apply-patch produces it at line 505.
	 */
	action: 'add' | 'update' | 'delete' | 'move';
	/** Absent for an add. */
	old_path?: string;
	/** Absent for a delete. */
	new_path?: string;
	old_bytes?: Uint8Array;
	new_bytes?: Uint8Array;
}

/** Decodes file bytes into lines, tolerating CRLF and a BOM. */
export function decodeLines(bytes: Uint8Array | undefined): string[];

/** Whole-file replacement used when Myers is not viable. */
export function fallbackReplace(
	oldLines: readonly string[],
	newLines: readonly string[]
): DiffEdit[];

/** Myers diff. Falls back past MAX_MYERS_EDIT_DISTANCE. */
export function myersDiff(
	oldLines: readonly string[],
	newLines: readonly string[]
): DiffEdit[];

export function backtrackMyers(
	trace: readonly unknown[],
	oldLines: readonly string[],
	newLines: readonly string[]
): DiffEdit[];

export function diffLines(
	oldLines: readonly string[],
	newLines: readonly string[]
): DiffEdit[];

/** Pairs each edit with its line numbers on both sides. */
export function annotateEdits(edits: readonly DiffEdit[]): unknown[];

/** Formats a unified-diff range, collapsing a count of 1. */
export function formatRange(start: number, count: number): string;

/** Groups edits into @@ hunks with surrounding context. */
export function renderHunks(
	edits: readonly DiffEdit[],
	contextLines?: number
): string[];

/** Renders one file's header and hunks. */
export function renderFileDiff(file: CanonicalDiffFile): string[];

/**
 * Renders a canonical unified diff for several files.
 *
 * Generated from validated old/new contents rather than echoing a supplied
 * patch, which is why apply-patch reports diff_source "runtime_old_vs_new".
 */
export function createCanonicalUnifiedDiff(
	files: readonly CanonicalDiffFile[]
): string;
