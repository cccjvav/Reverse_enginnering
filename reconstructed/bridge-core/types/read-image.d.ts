// Hand-written types for reconstructed/bridge-core/src/read-image.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE. No recovered .ts imports this module, so
// none of these type names are known to be the author's spelling.
//
//   STRUCTURAL  Both contracts are exact and evidenced twice. READ_IMAGE_TOOL
//               ships an input schema (path required, include_data_uri
//               optional) AND an output schema naming every result field,
//               including that width/height/aspect_ratio are
//               ["integer"|"string", "null"] - which is why they are `| null`
//               below rather than optional.
//   OBSERVED    The success literal at line 274, the error literals in
//               normalizeError4 (line 224), the five ReadImageToolError codes,
//               and the 25 MB cap in DEFAULT_READ_IMAGE_CONFIG.
//   INFERRED    Nothing material.
//
// Note this module differs from its siblings: readImage RETURNS an error result
// rather than throwing. apply-patch, search-files and find-files all throw.

/** Codes raised internally. FILE_NOT_FOUND also covers an empty path. */
export type ReadImageErrorCode =
	| 'ABORTED'
	| 'FILE_NOT_FOUND'
	| 'IO_ERROR'
	| 'NOT_AN_IMAGE'
	| 'NOT_A_FILE'
	| 'PATH_OUTSIDE_WORKSPACE'
	| 'PERMISSION_DENIED';

export class ReadImageToolError extends Error {
	constructor(code: ReadImageErrorCode, message: string);
	readonly code: ReadImageErrorCode;
}

/** Formats this module can identify from file headers. */
export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp';

export interface ReadImageInput {
	path: string;
	/** Defaults to false; when false, data_uri is omitted but base64 is not. */
	include_data_uri?: boolean;
}

export interface ReadImageConfig {
	/** Files larger than this are rejected. Defaults to 25 MB. */
	maxBytes: number;
}

export const DEFAULT_READ_IMAGE_CONFIG: ReadImageConfig;

export interface ReadImageContext {
	workspaceRoots: readonly string[] | (() => readonly string[]);
	signal?: AbortSignal;
	config?: Partial<ReadImageConfig>;
	/** Optional policy gate consulted before the file is opened. */
	checkPermission?: (absolutePath: string) => boolean | Promise<boolean>;
}

export interface ReadImageSuccess {
	path: string;
	status: 'success';
	format: ImageFormat;
	mime_type: string;
	/**
	 * Null when the dimensions could not be read from the header - progressive
	 * JPEGs in particular. A caller must handle null rather than assume a size.
	 */
	width: number | null;
	height: number | null;
	aspect_ratio: string | null;
	size_bytes: number;
	/** Human-readable size, e.g. "1.2 MB". */
	size_formatted: string;
	/** Present only when include_data_uri was true. */
	data_uri?: string;
	base64: string;
}

export interface ReadImageFailure {
	path: string;
	status: 'error';
	error: { code: ReadImageErrorCode; message: string };
}

export type ReadImageResult = ReadImageSuccess | ReadImageFailure;

/**
 * Reads an image and reports its metadata.
 *
 * Returns an error result instead of throwing, so a failed read still yields a
 * structured answer.
 */
export function readImage(
	input: ReadImageInput,
	context: ReadImageContext
): Promise<ReadImageResult>;

/** Renders a result as the text block the model sees. */
export function formatReadImageForModel(result: ReadImageResult): string;
