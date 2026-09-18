// Hand-written types for reconstructed/bridge-core/src/read-files.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE. No recovered .ts imports this module, so
// none of these type names are known to be the author's spelling.
//
//   STRUCTURAL  READ_FILES_TOOL ships both an input schema (files: 1-20 items,
//               each requiring path) and an output schema naming the files and
//               summary fields.
//   OBSERVED    The success entry literal at line 248, the error entries in
//               normalizeError3 (line 199), the skipped entry at line 291, the
//               summary at line 329, the seven ReadToolError codes and
//               DEFAULT_READ_FILES_CONFIG at line 14.
//   INFERRED    The per-file result is a three-way discriminated union on
//               `status`, because the budget pass rewrites a success entry into
//               a `skipped` one carrying only path/reason/message.
//
// Like read-image and unlike apply-patch, per-file failures are RETURNED, not
// thrown: one unreadable file does not fail the batch. Only a structurally
// invalid call (no files at all) throws.

export type ReadFilesErrorCode =
	| 'ABORTED'
	| 'BINARY_FILE'
	| 'FILE_NOT_FOUND'
	| 'INVALID_LINE_RANGE'
	| 'IO_ERROR'
	| 'NOT_A_FILE'
	| 'PATH_OUTSIDE_WORKSPACE'
	| 'PERMISSION_DENIED'
	| 'UNSUPPORTED_ENCODING';

export class ReadToolError extends Error {
	constructor(code: ReadFilesErrorCode, message: string);
	readonly code: ReadFilesErrorCode;
}

/** One requested file, optionally a line range. Both bounds are 1-based. */
export interface ReadFileRequest {
	path: string;
	start_line?: number;
	end_line?: number;
}

export interface ReadFilesInput {
	/** 1-20 files. */
	files: ReadFileRequest[];
}

export interface ReadFilesConfig {
	maxFilesPerCall: number;
	concurrency: number;
	maxLinesPerFile: number;
	maxBytesPerFile: number;
	maxEstimatedTokensPerFile: number;
	maxLineChars: number;
	maxTotalBytesPerCall: number;
	maxEstimatedTokensPerCall: number;
	veryLargeFileBytes: number;
	binaryProbeBytes: number;
}

export const DEFAULT_READ_FILES_CONFIG: ReadFilesConfig;

export interface ReadFilesContext {
	workspaceRoots: readonly string[] | (() => readonly string[]);
	signal?: AbortSignal;
	config?: Partial<ReadFilesConfig>;
	checkPermission?: (absolutePath: string) => boolean | Promise<boolean>;
}

export interface ReadFileSuccess {
	path: string;
	status: 'success';
	start_line: number;
	/** Null when the file is empty. */
	end_line: number | null;
	total_lines: number;
	/** True when the range was cut short by a per-file cap. */
	truncated: boolean;
	has_more: boolean;
	/** Where a follow-up call should resume, or null at end of file. */
	next_start_line: number | null;
	content: string;
	size_bytes: number;
	returned_bytes: number;
	estimated_tokens: number;
	/** `sha256:...` digest; pass back to apply_patch as expected_versions. */
	version: string;
	/** Lines individually cut at maxLineChars. */
	truncated_line_numbers: number[];
}

export interface ReadFileFailure {
	path: string;
	status: 'error';
	error: { code: ReadFilesErrorCode; message: string };
}

/**
 * A file that was read but dropped to keep the batch within budget.
 *
 * It carries no content: the work was done and discarded, so re-request it in
 * a smaller call.
 */
export interface ReadFileSkipped {
	path: string;
	status: 'skipped';
	reason: 'BATCH_OUTPUT_BUDGET_EXCEEDED';
	message: string;
}

export type ReadFileResult = ReadFileSuccess | ReadFileFailure | ReadFileSkipped;

export interface ReadFilesSummary {
	requested: number;
	succeeded: number;
	failed: number;
	skipped: number;
	/** How many successful reads were themselves truncated. */
	truncated: number;
}

export interface ReadFilesResult {
	files: ReadFileResult[];
	summary: ReadFilesSummary;
}

/**
 * Reads several files concurrently.
 *
 * Per-file failures are reported in the result rather than thrown, so one bad
 * path does not lose the whole batch.
 *
 * @throws if `files` is missing or empty - that is a malformed call, not a
 * per-file failure.
 */
export function readFiles(
	input: ReadFilesInput,
	context: ReadFilesContext
): Promise<ReadFilesResult>;

/** Renders a result as the text block the model sees. */
export function formatReadFilesForModel(result: ReadFilesResult): string;

/** True when the file's first bytes suggest binary content. */
export function appearsBinary(filePath: string, probeBytes: number): Promise<boolean>;

/** Rough token estimate, four characters per token. */
export function estimateTokens(text: string): number;
