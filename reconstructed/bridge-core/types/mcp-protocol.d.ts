// Hand-written types for reconstructed/bridge-core/src/mcp-protocol.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE for the type names. Every value is a
// literal or a derivation of one in a ~40-line module.
//
//   OBSERVED    Version constants, the date-string comparison that classifies
//               an era, and describeProtocolSupport's return literal - which
//               is also what the health endpoint serves
//               (bridge-http-router.js), so the field names are corroborated.

/** Versions at or after MODERN_ERA_MIN_VERSION are "modern". */
export type ProtocolEra = 'modern' | 'legacy';

/** Boundary date. Comparison is lexicographic on ISO dates, not numeric. */
export const MODERN_ERA_MIN_VERSION: string;
export const MODERN_PROTOCOL_VERSION: string;
/** SDK-supported versions, newest first. */
export const LEGACY_PROTOCOL_VERSIONS: readonly string[];
export const NEGOTIABLE_LATEST_PROTOCOL_VERSION: string;
/** Everything offered during negotiation, modern version first. */
export const NEGOTIABLE_PROTOCOL_VERSIONS: readonly string[];
/** True when any negotiable version is modern. */
export const SUPPORTS_STATELESS_TRANSPORT: boolean;
/** Human-readable transport summary for the health endpoint. */
export const PROTOCOL_TRANSPORT_MODE: string;

/** An absent or empty version is treated as legacy, not rejected. */
export function classifyProtocolEra(version: string | undefined): ProtocolEra;

/** Capability summary served by the health endpoint. */
export function describeProtocolSupport(): {
	latest: string;
	supportedVersions: readonly string[];
	transport: string;
	statelessCapable: boolean;
	modernVersion: string;
	legacyVersions: readonly string[];
};
