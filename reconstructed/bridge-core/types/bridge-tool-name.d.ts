// Hand-written types for reconstructed/bridge-core/src/bridge-tool-name.js
//
// PROVENANCE — the author imports resolveBridgeToolName
// (bridge-tool-dispatcher.ts:4), so the export name is FIRST-HAND; the
// parameter names are mine. OBSERVED: the whole module is 20 lines.

/**
 * Strips MCP client name-mangling to recover the real tool name.
 *
 * Clients prefix tools differently - `mcp__server__tool` or `mcp_server_tool`.
 * Candidates are tested against `isKnown` in order, and the trimmed original is
 * returned when none matches, so an unknown name is passed through rather than
 * mangled further.
 */
export function resolveBridgeToolName(
	rawName: string,
	isKnown: (name: string) => boolean
): string;
