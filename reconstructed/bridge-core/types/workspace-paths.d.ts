// Hand-written types for reconstructed/bridge-core/src/workspace-paths.js
//
// PROVENANCE — NO FIRST-HAND EVIDENCE for the type names; the module is small
// enough that every behaviour below is directly observable in the shipped code.
//
//   OBSERVED    STALE_ROOT_CODES is a literal Set of two errno codes; the
//               canonicalisation loop, its two throw sites and the dedupe are
//               all visible in ~25 lines.
//   INFERRED    The `createUnavailableError` callback returns the error to
//               throw rather than throwing itself - the implementation writes
//               `throw createUnavailableError(...)`. Callers pass a factory so
//               each tool raises its own error type (apply-patch passes one
//               producing PatchToolError PATH_OUTSIDE_WORKSPACE).

/** errno codes treated as "this root is gone", rather than as a failure. */
export const STALE_ROOT_CODES: ReadonlySet<string>;

/**
 * Resolves workspace roots to real paths, dropping ones that have vanished.
 *
 * Roots failing with ENOENT or ENOTDIR are skipped so a deleted folder does
 * not break the others; any other error propagates. Symlinks are resolved and
 * duplicates removed, so two roots pointing at the same directory collapse.
 *
 * @param createUnavailableError Factory returning the error to throw when no
 * root is configured, or when every configured root has gone. It must return
 * an error, not throw one.
 * @throws whatever the factory returns, or an unexpected filesystem error.
 */
export function canonicalizeWorkspaceRoots(
	roots: readonly string[],
	createUnavailableError: (message: string) => Error
): Promise<string[]>;

/**
 * Candidate spellings for a requested path, literal form first.
 *
 * A path containing backslashes also yields a forward-slash variant, so a
 * Windows-style path still resolves on a POSIX filesystem. Returns exactly one
 * entry when there is nothing to vary.
 */
export function literalFirstPathSpellings(requestedPath: string): string[];
