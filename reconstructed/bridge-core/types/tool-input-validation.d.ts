// Hand-written types for reconstructed/bridge-core/src/tool-input-validation.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  The author calls validateToolInput at recovered
//               src/bridge-tool-dispatcher.ts:253, 306 and 339, always as
//               `(name, inputSchema, args)` with the result discarded - it
//               validates by throwing, it does not return a verdict.
//   OBSERVED    The JSON Schema subset actually enforced is read off
//               validateSchema (line 36): type, enum, minLength, maxLength,
//               minimum, maximum, required, properties, items and
//               additionalProperties. Anything outside that subset is accepted
//               silently, which is worth knowing before relying on it.
//               valueType's vocabulary (line 9) is likewise literal.
//   INFERRED    `fail` returns `never`, since every path throws.
//
// Note the deliberate limit: this is a pragmatic validator, not a complete
// JSON Schema implementation. `$ref`, `oneOf`, `allOf`, `anyOf`, `pattern` and
// `format` are not enforced. The type says so rather than implying full
// coverage.

/** The type vocabulary this validator reports and understands. */
export type JsonValueType =
	| 'null'
	| 'array'
	| 'integer'
	| 'string'
	| 'number'
	| 'boolean'
	| 'object'
	| 'undefined'
	| 'function'
	| 'symbol'
	| 'bigint';

/** The JSON Schema subset this module enforces. */
export interface ToolInputSchema {
	type?: string;
	enum?: readonly unknown[];
	minLength?: number;
	maxLength?: number;
	minimum?: number;
	maximum?: number;
	required?: readonly string[];
	properties?: Record<string, ToolInputSchema>;
	items?: ToolInputSchema;
	additionalProperties?: boolean | ToolInputSchema;
	[keyword: string]: unknown;
}

/** Narrows a candidate schema; undefined for arrays, null and primitives. */
export function schemaObject(value: unknown): ToolInputSchema | undefined;

/**
 * Classifies a runtime value.
 *
 * Note integers are reported as "integer" rather than "number", matching JSON
 * Schema rather than JavaScript.
 */
export function valueType(value: unknown): JsonValueType;

/** Structural equality via JSON; false on values that cannot be serialised. */
export function sameJsonValue2(left: unknown, right: unknown): boolean;

/**
 * Raises a validation error.
 *
 * Always throws, so control flow narrows after a call.
 *
 * @throws Error prefixed `INVALID_ARGUMENT:` and tagged with the value's path.
 */
export function fail(path: string, message: string): never;

/**
 * Checks one value against a schema `type`.
 *
 * A non-string `expected` is ignored, so union types such as
 * `["integer", "null"]` pass unchecked rather than being rejected.
 *
 * @throws via fail() on mismatch.
 */
export function validateType(path: string, expected: unknown, value: unknown): void;

/**
 * Recursively validates a value against the supported schema subset.
 *
 * @param path Prefix used in error messages, so failures name the offending
 * field rather than just the tool.
 * @throws via fail() on the first violation; validation is fail-fast, not
 * exhaustive, so only one problem is reported per call.
 */
export function validateSchema(
	schema: ToolInputSchema,
	value: unknown,
	path: string
): void;

/**
 * Validates a tool's arguments against its declared input schema.
 *
 * Returns nothing: success is the absence of a throw.
 *
 * @throws if the schema itself is not an object, or if the input violates it.
 */
export function validateToolInput(
	toolName: string,
	inputSchema: unknown,
	input: unknown
): void;
