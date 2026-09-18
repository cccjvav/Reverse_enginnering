// Hand-written types for reconstructed/bridge-core/src/find-files.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE. No recovered .ts imports this module, so
// none of these type names are known to be the author's spelling.
//
//   STRUCTURAL  Both contracts are exact. FIND_FILES_TOOL.inputSchema gives the
//               input (patterns required, 1-20 items; exclude max 50;
//               max_results 1-500; sort enum), and this tool also ships an
//               OUTPUT schema naming engine "ripgrep" | "node" and the file
//               entry fields - so the result shape is evidenced twice.
//   OBSERVED    The result literal near line 460, enrichFiles (line 401) for
//               the file entries, defaults at line 21, and all eight error
//               codes as literal FindFilesError constructions.
//   INFERRED    findFiles resolves only with a success result - normalizeError2
//               (line 418) throws on every path.

export type FindFilesErrorCode =
	| 'ABORTED'
	| 'FILE_NOT_FOUND'
	| 'INVALID_ARGUMENT'
	| 'INVALID_GLOB'
	| 'IO_ERROR'
	| 'NOT_A_DIRECTORY'
	| 'PATH_OUTSIDE_WORKSPACE'
	| 'PERMISSION_DENIED';

export class FindFilesError extends Error {
	constructor(code: FindFilesErrorCode, message: string);
	readonly code: FindFilesErrorCode;
}

export type FindFilesEngine = 'ripgrep' | 'node';
/** Newest first, or lexicographic by path. */
export type FindFilesSort = 'modified_desc' | 'path_asc';

/** Tool input. Mirrors FIND_FILES_TOOL.inputSchema. */
export interface FindFilesInput {
	/** Glob patterns; 1-20 of them. */
	patterns: string[];
	/** Workspace directory to limit discovery to. */
	path?: string;
	/** Up to 50 exclusion globs. */
	exclude?: string[];
	case_sensitive?: boolean;
	no_ignore?: boolean;
	include_hidden?: boolean;
	/** 1-500. Defaults to 100. */
	max_results?: number;
	/** Defaults to modified_desc. */
	sort?: FindFilesSort;
}

export interface FindFilesConfig {
	defaultMaxResults: number;
	hardMaxResults: number;
	/** Discovery stops after this many candidates, before sorting. */
	maxCandidates: number;
	statConcurrency: number;
	commonExcludes: string[];
	[option: string]: unknown;
}

export const DEFAULT_FIND_FILES_CONFIG: FindFilesConfig;
/** Paths skipped on macOS because probing them triggers a privacy prompt. */
export const MACOS_PROTECTED_VOLUME_GLOBS: readonly string[];

export interface FindFilesContext {
	workspaceRoots: readonly string[] | (() => readonly string[]);
	signal?: AbortSignal;
	config?: Partial<FindFilesConfig>;
}

export interface FoundFile {
	path: string;
	size_bytes: number;
	/** Modification time in epoch milliseconds; drives modified_desc. */
	modified_ms: number;
}

export interface FindFilesSummary {
	/** How many paths were considered before the result cap applied. */
	candidate_paths: number;
	returned_files: number;
	truncated: boolean;
	truncation_reasons: string[];
}

export interface FindFilesResult {
	patterns: string[];
	scope: string;
	engine: FindFilesEngine;
	sort: FindFilesSort;
	files: FoundFile[];
	summary: FindFilesSummary;
}

/**
 * Finds files by glob.
 *
 * Prefers ripgrep and falls back to a node walker; `engine` reports which ran.
 * Resolves only on success; failures throw a FindFilesError.
 *
 * @throws FindFilesError
 */
export function findFiles(
	input: FindFilesInput,
	context: FindFilesContext
): Promise<FindFilesResult>;

/** Renders a result as the text block the model sees. */
export function formatFindFilesForModel(result: FindFilesResult): string;

/** Always throws; normalises an unknown error into a FindFilesError. */
export function normalizeError2(error: unknown): never;

/**
 * Rejects empty globs and globs over 4000 characters.
 *
 * Takes the pattern only - no label. The error message is fixed, so a caller
 * cannot attribute the failure to a particular argument.
 *
 * @throws FindFilesError INVALID_GLOB
 */
export function validateGlob(pattern: string): void;
