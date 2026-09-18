// Hand-written types for reconstructed/bridge-core/src/search-files.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE. No recovered .ts imports this module, so
// none of these type names are known to be the author's spelling. The shapes
// below are evidenced; the names are mine.
//
//   STRUCTURAL  The input contract is exact: SEARCH_FILES_TOOL.inputSchema
//               (file-tool-registry.js) is a JSON Schema that survived
//               compilation as a runtime value, giving every option, its type,
//               its bounds (context_lines 0-5, max_results 1-500,
//               max_matches_per_file 1-100) and that only `pattern` is
//               required.
//   OBSERVED    The result is the return literal at line 678; match entries at
//               line 560; defaults at line 21; all nine error codes are literal
//               SearchToolError constructions.
//   INFERRED    searchFiles resolves only with a success result -
//               normalizeError5 (line 640) throws on every path.

/** Error codes raised by this module. */
export type SearchErrorCode =
	| 'ABORTED'
	| 'FILE_NOT_FOUND'
	| 'INVALID_ARGUMENT'
	| 'INVALID_GLOB'
	| 'INVALID_PATTERN'
	| 'IO_ERROR'
	| 'NOT_A_FILE_OR_DIRECTORY'
	| 'PATH_OUTSIDE_WORKSPACE'
	| 'PERMISSION_DENIED';

export class SearchToolError extends Error {
	constructor(code: SearchErrorCode, message: string);
	readonly code: SearchErrorCode;
}

/** Which backend produced the results. */
export type SearchEngine = 'ripgrep' | 'node';
/** How the pattern was interpreted. */
export type SearchMode = 'literal' | 'regex';
/**
 * Case handling. "smart" means case-insensitive until the pattern contains an
 * uppercase character - the behaviour when case_sensitive is omitted.
 */
export type SearchCaseMode = 'sensitive' | 'insensitive' | 'smart';

/** Tool input. Mirrors SEARCH_FILES_TOOL.inputSchema. */
export interface SearchFilesInput {
	/** Literal text by default; a regular expression when is_regex is true. */
	pattern: string;
	/** Workspace file or directory to limit the search to. */
	path?: string;
	is_regex?: boolean;
	/** Omit for smart-case. */
	case_sensitive?: boolean;
	include?: string[];
	exclude?: string[];
	/** 0-5. Defaults to 1. */
	context_lines?: number;
	/** 1-500. Defaults to 100. */
	max_results?: number;
	/** 1-100. Defaults to 20. */
	max_matches_per_file?: number;
	no_ignore?: boolean;
	include_hidden?: boolean;
}

export interface SearchFilesConfig {
	defaultContextLines: number;
	maxContextLines: number;
	defaultMaxResults: number;
	hardMaxResults: number;
	defaultMaxMatchesPerFile: number;
	hardMaxMatchesPerFile: number;
	maxOutputBytes: number;
	maxEstimatedTokens: number;
	maxLineChars: number;
	/** Files larger than this are skipped by the node fallback engine. */
	maxFallbackFileBytes: number;
	[option: string]: unknown;
}

export const DEFAULT_SEARCH_FILES_CONFIG: SearchFilesConfig;

export interface SearchFilesContext {
	workspaceRoots: readonly string[] | (() => readonly string[]);
	signal?: AbortSignal;
	config?: Partial<SearchFilesConfig>;
}

/** One match. Line and column are 1-based. */
export interface SearchMatch {
	path: string;
	line: number;
	column: number;
	text: string;
	/** True when the line was cut at maxLineChars. */
	text_truncated: boolean;
	/** Context lines before the match; empty when context_lines is 0. */
	before: string[];
	after: string[];
}

export interface SearchSummary {
	returned_matches: number;
	files_with_matches: number;
	files_scanned: number;
	skipped_binary_files: number;
	skipped_large_files: number;
	/** True when any cap cut the results short. */
	truncated: boolean;
	/** Which caps applied, so a truncated result can be explained. */
	truncation_reasons: string[];
}

export interface SearchFilesResult {
	pattern: string;
	mode: SearchMode;
	case_mode: SearchCaseMode;
	scope: string;
	engine: SearchEngine;
	matches: SearchMatch[];
	summary: SearchSummary;
}

/**
 * Searches file contents.
 *
 * Prefers ripgrep and falls back to a node implementation, reporting which ran
 * via `engine`. Resolves only on success; failures throw a SearchToolError.
 *
 * @throws SearchToolError
 */
export function searchFiles(
	input: SearchFilesInput,
	context: SearchFilesContext
): Promise<SearchFilesResult>;

/** Renders a result as the text block the model sees. */
export function formatSearchFilesForModel(result: SearchFilesResult): string;

/** Always throws; normalises an unknown error into a SearchToolError. */
export function normalizeError5(error: unknown): never;
