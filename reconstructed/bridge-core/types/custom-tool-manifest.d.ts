// Hand-written types for reconstructed/bridge-core/src/custom-tool-manifest.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE for the type names, but the produced
// value IS the author's CustomToolManifest (see custom-tools.d.ts), so the
// return type is anchored to a first-hand type.
//
//   OBSERVED    parseManifest (line 15) is a single validation cascade: every
//               rule below is an explicit check, and every failure path returns
//               undefined rather than throwing.
//   INFERRED    Nothing material.

import type { CustomToolManifest } from './custom-tools.js';

export const MAX_MANIFEST_BYTES: number;
export const MAX_COMMAND_PARTS: number;
export const MAX_COMMAND_PART_LENGTH: number;

/**
 * Validates a parsed manifest object.
 *
 * Returns undefined - never throws - when anything fails: a bad or reserved
 * name, a title over 80 characters, a description outside the length bounds, a
 * non-object inputSchema, an empty or oversized command, or a timeout outside
 * MIN/MAX_TIMEOUT_MS.
 *
 * Note the command restriction: unless the head is exactly "node", it may not
 * be an absolute path and may not contain "..". That is the check stopping a
 * manifest from executing something outside the workspace, so it is a security
 * boundary rather than a convenience.
 */
export function parseManifest(
	value: unknown,
	sourcePath: string
): CustomToolManifest | undefined;

/**
 * Reads and validates a manifest file.
 *
 * Returns undefined for an unreadable file, one over MAX_MANIFEST_BYTES, or
 * invalid JSON, logging the reason instead of throwing - one bad manifest must
 * not stop the others loading.
 */
export function readManifest(
	sourcePath: string,
	log?: (message: string) => void
): CustomToolManifest | undefined;
