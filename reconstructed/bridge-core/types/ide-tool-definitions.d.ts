// Hand-written types for reconstructed/bridge-core/src/ide-tool-definitions.js
//
// PROVENANCE. Export names are FIRST-HAND: the author imports
// IDE_TOOL_DEFINITIONS, BRIDGE_EXCLUDED_TOOL_NAMES and getIdeToolDefinition in
// recovered src/bridge-constants.ts:5, src/bridge-tool-dispatcher.ts:12 and
// src/ide-tool-broker.ts:7. Line 239 compares the lookup against `undefined`,
// which is why the return type is optional rather than throwing.
//
//   OBSERVED    The definition fields are literals in IDE_TOOL_DEFINITIONS
//               (line 24); capability only ever takes "read" or "execute";
//               IDE_TOOL_NAMES is derived from the table; the excluded set is
//               the single name "wait".
//   INFERRED    Nothing material.

/** What a tool is permitted to do. Only these two appear in the table. */
export type IdeToolCapability = 'read' | 'execute';

/** One IDE-side tool as advertised to the model. */
export interface IdeToolDefinition {
	readonly name: string;
	/** Command id registered with the editor host. */
	readonly vscodeToolName: string;
	readonly capability: IdeToolCapability;
	readonly description: string;
	readonly inputSchema: Record<string, unknown>;
	readonly outputSchema?: Record<string, unknown>;
}

export const IDE_TOOL_DEFINITIONS: readonly IdeToolDefinition[];
/** Names from the table above, in declaration order. */
export const IDE_TOOL_NAMES: readonly string[];

/**
 * Tools the bridge does not expose to remote clients.
 *
 * Currently just "wait": it is useful in-editor but would let a remote session
 * hold a slot doing nothing.
 */
export const BRIDGE_EXCLUDED_TOOL_NAMES: ReadonlySet<string>;

/** Shared description text for the managed shell tools. */
export const MANAGED_SHELL_DESCRIPTION: string;
/** Default output schema for tools with no bespoke one. */
export const GENERIC_OUTPUT_SCHEMA: Record<string, unknown>;
export const RUN_COMMAND_OUTPUT_SCHEMA: Record<string, unknown>;

/** Looks up one definition. Undefined when the name is not an IDE tool. */
export function getIdeToolDefinition(name: string): IdeToolDefinition | undefined;
