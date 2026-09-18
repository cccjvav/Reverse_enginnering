// Hand-written types for reconstructed/bridge-core/src/custom-tool-sandbox.js
//
// PROVENANCE. The original .ts was never shipped; reconstructed from use.
//
//   FIRST-HAND  The author calls executeCustomTool at recovered
//               src/bridge-tool-dispatcher.ts:340 with
//               `{ signal, log }`, and consumes `result.isError`,
//               `result.text` and `result.structuredContent`.
//   OBSERVED    The result literal is built at line 85 of the shipped module,
//               and its structuredContent keys match CUSTOM_TOOL_OUTPUT_SCHEMA
//               exactly (exit_code, timed_out, aborted, duration_ms).
//               runChild's resolve literals (lines 24, 39) give the outcome
//               shape.
//   INFERRED    `log` is optional. The author passes it, but the shipped
//               implementation only ever reads options.signal, so it cannot be
//               required without contradicting the code. Typed as accepted and
//               possibly unused rather than dropped, because dropping it would
//               make the author's own call site an error.

import type { CustomToolManifest } from './custom-tools.js';

/** Environment variable carrying the invoked tool's name. */
export const CUSTOM_TOOL_NAME_ENV: string;
/** Environment variable carrying the JSON-encoded arguments. */
export const CUSTOM_TOOL_ARGS_ENV: string;
/** Grace period between SIGTERM and SIGKILL. */
export const FORCE_KILL_GRACE_MS: number;
/** Output past this many bytes is truncated rather than buffered. */
export const MAX_OUTPUT_BYTES: number;
/**
 * Interpreters a skill may invoke by bare name.
 *
 * Only skill-backed tools get this exemption; a plain manifest tool must point
 * at a path inside the workspace, which is what stops it escaping.
 */
export const SKILL_INTERPRETERS: ReadonlySet<string>;

/** Raw result of running the child process. */
export interface CustomToolChildOutcome {
	/** Null when the process was killed rather than exiting normally. */
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly timedOut: boolean;
	readonly aborted: boolean;
}

/** Structured payload, matching CUSTOM_TOOL_OUTPUT_SCHEMA. */
export interface CustomToolStructuredContent {
	readonly exit_code: number | null;
	readonly timed_out: boolean;
	readonly aborted: boolean;
	readonly duration_ms: number;
	/**
	 * CUSTOM_TOOL_OUTPUT_SCHEMA sets additionalProperties: true, so a tool may
	 * return extra keys. The index signature also lets the author pass this
	 * straight where a Record<string, unknown> is expected
	 * (bridge-tool-dispatcher.ts:349).
	 */
	readonly [key: string]: unknown;
}

/** What the dispatcher receives back. */
export interface CustomToolExecutionResult {
	/** True when the tool aborted, timed out, or exited non-zero. */
	readonly isError: boolean;
	readonly text: string;
	readonly structuredContent: CustomToolStructuredContent;
}

export interface CustomToolExecuteOptions {
	readonly signal?: AbortSignal;
	/**
	 * Accepted for symmetry with the other loaders and used by the author's
	 * call site; the current implementation does not read it.
	 */
	readonly log?: (message: string) => void;
	readonly timeoutMs?: number;
}

/**
 * Runs a custom tool in a child process.
 *
 * Throws - rather than returning an error result - when the request is
 * structurally invalid: failed input-schema validation, no open workspace, an
 * empty command, a script that escapes the workspace, or a missing script.
 * Runtime failures of the tool itself come back as `isError` instead.
 */
export function executeCustomTool(
	workspaceRoots: readonly string[],
	tool: CustomToolManifest,
	args: unknown,
	options?: CustomToolExecuteOptions
): Promise<CustomToolExecutionResult>;

/** Spawns the child and collects its output. Never rejects. */
export function runChild(
	executable: string,
	argv: readonly string[],
	options: {
		cwd: string;
		env: NodeJS.ProcessEnv;
		timeoutMs: number;
		signal?: AbortSignal;
	}
): Promise<CustomToolChildOutcome>;
