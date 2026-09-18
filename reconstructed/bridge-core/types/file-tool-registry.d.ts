// Hand-written types for reconstructed/bridge-core/src/file-tool-registry.js
//
// PROVENANCE. The original .ts was never shipped (see docs/handoff/BTYPE_PLAN.md),
// so these are reconstructed from use rather than read back. Justification per
// group below; where the evidence stops, the type says so instead of guessing.
//
//   FIRST-HAND  `ToolContentBlock` is the author's own name, imported as a type
//               by recovered src/bridge-tool-dispatcher.ts:11 and used there as
//               `ToolContentBlock[]` (line 36). The call site at lines 309-330
//               fixes both the context argument and the result shape.
//   OBSERVED    Field names and the error envelope read off the shipped
//               implementation: dispatchFileTool (line 703) builds the success
//               results, buildFileToolErrorResult (line 668) the failure one.
//   INFERRED    `content` is optional on the result because the author writes
//               `result.content ?? [{ type: "text", text: result.text }]`
//               (bridge-tool-dispatcher.ts:329) - a mandatory field would make
//               that fallback dead code.

/**
 * A block of tool output. Only the two variants the registry actually emits are
 * listed: dispatchFileTool pushes `text` blocks, and read_image additionally
 * pushes an `image` block (line 746).
 */
export type ToolContentBlock =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType: string };

/** Canonical file-tool names. Derived from FILE_TOOL_ERROR_TAGS (line 650). */
export type FileToolName =
	| 'apply_patch'
	| 'find_files'
	| 'read_files'
	| 'read_image'
	| 'search_files';

/**
 * Execution context supplied by the caller.
 *
 * `workspaceRoots` is deliberately allowed to be a thunk: invokeFileTool calls
 * it lazily (line 696) so that a failure to resolve the roots is enveloped as a
 * tool error rather than thrown. The author relies on exactly that
 * (bridge-tool-dispatcher.ts:311, "Lazy on purpose").
 */
export interface FileToolContext {
	workspaceRoots: readonly string[] | (() => readonly string[]);
	signal?: AbortSignal;
}

/**
 * What a file tool returns.
 *
 * `text` is always present - it is the model-facing rendering. `content` is
 * only built by the tools that need multi-block output, hence optional.
 */
export interface FileToolResult {
	text: string;
	structuredContent?: Record<string, unknown>;
	content?: ToolContentBlock[];
	isError?: boolean;
}

/** Error envelope produced when a tool throws. Fields from line 673. */
export interface FileToolErrorStructuredContent {
	status: 'error';
	error_code: string;
	message: string;
	/** Present only for glob errors that carry an `at` marker. */
	invalid_glob_source?: string;
}

/** A tool definition as advertised to the model. */
export interface FileToolDefinition {
	name: FileToolName;
	title?: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export const FILE_TOOL_DEFINITIONS: readonly FileToolDefinition[];
export const FILE_TOOL_NAMES: readonly FileToolName[];
export const FILE_TOOL_ERROR_TAGS: Readonly<Record<FileToolName, string>>;

export const APPLY_PATCH_TOOL: FileToolDefinition;
export const FIND_FILES_TOOL: FileToolDefinition;
export const READ_FILES_TOOL: FileToolDefinition;
export const READ_IMAGE_TOOL: FileToolDefinition;
export const SEARCH_FILES_TOOL: FileToolDefinition;

/** Narrowing guard used by the dispatcher before routing a call. */
export function isFileToolName(name: string): name is FileToolName;

/**
 * Invokes a file tool, converting any throw into an `isError` result.
 *
 * Never rejects: the author's dispatcher depends on this, since it reports
 * tool failures as results rather than exceptions.
 */
export function invokeFileTool(
	name: string,
	args: unknown,
	context: FileToolContext
): Promise<FileToolResult>;

/** Routes to the individual tool. Unlike invokeFileTool, this one can throw. */
export function dispatchFileTool(
	name: string,
	args: unknown,
	context: FileToolContext & { workspaceRoots: readonly string[] }
): Promise<FileToolResult>;

export function buildFileToolErrorResult(
	name: string,
	error: unknown
): FileToolResult & { structuredContent: FileToolErrorStructuredContent };

export function resolveFileToolErrorCode(error: unknown, message: string): string;

// Input parsers. Each validates and normalises the raw tool arguments; the
// concrete per-tool option shapes live with their own modules, so these are
// typed at the boundary rather than invented here.
export function parseApplyPatchInput(args: unknown): Record<string, unknown>;
export function parseFindFilesInput(args: unknown): Record<string, unknown>;
export function parseReadFilesInput(args: unknown): Record<string, unknown>;
export function parseReadImageInput(args: unknown): Record<string, unknown>;
export function parseSearchFilesInput(args: unknown): Record<string, unknown>;

// Shared argument validators used by the parsers above.
/**
 * Asserts the value is an object and returns it.
 *
 * Takes no label: the error message is the fixed
 * "INVALID_ARGUMENT: expected an object." An earlier draft of this file
 * declared a `label` parameter that does not exist.
 *
 * @throws if the value is null or not an object.
 */
export function asObjectRow(value: unknown): Record<string, unknown>;
export function assertOptionalBooleans(
	args: Record<string, unknown>, keys: readonly string[]): void;
export function assertOptionalIntegers(
	args: Record<string, unknown>, keys: readonly string[]): void;
export function assertOptionalNonEmptyString(
	args: Record<string, unknown>, key: string): void;
export function assertOptionalStringArrays(
	args: Record<string, unknown>, keys: readonly string[]): void;
