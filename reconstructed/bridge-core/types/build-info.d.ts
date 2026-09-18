// Hand-written types for reconstructed/bridge-core/src/build-info.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE for the type names. The module is ~20
// lines and every field is observable.
//
//   OBSERVED    getBuildInfo's return literal, and the fallbacks it applies.
//   INFERRED    The injected metadata is Partial: every field goes through
//               asNonEmptyString with a fallback, so none can be relied on.

/** Build metadata baked in at package time. */
export interface BuildInfo {
	/** Falls back to the behaviour version when not injected. */
	version: string;
	/** "unknown" when not injected. */
	gitSha: string;
	/** "unknown" when not injected. */
	builtAt: string;
	/** True only for an explicit release build; anything else is false. */
	release: boolean;
}

/** Raw injected metadata. Every field is optional and unvalidated. */
export function injectedBuildInfo(): Partial<Record<keyof BuildInfo, unknown>>;

/** Returns the value only when it is a non-empty string. */
export function asNonEmptyString(value: unknown): string | undefined;

/** Build metadata with fallbacks applied; never throws, always complete. */
export function getBuildInfo(): BuildInfo;
