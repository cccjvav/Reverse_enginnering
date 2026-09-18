// Maintenance design, NOT a recovered original module.
//
// The original extension never constructed any file-permission service: grep
// for `checkPermission` across recovered/shuncode-extension/src/*.ts returns 0
// hits, and the original tool callback signature carries only an absolute path.
// This module is therefore new, host-owned policy written during recovery. Do
// not label it as a restored d.ts or original implementation.
//
// Design record: docs/handoff/P1_1_OWNER_LIFECYCLE.md
//
// Deliberate boundaries (do not overstate these):
//   * This is an in-process policy object, NOT an OS sandbox and NOT a GUI
//     approval flow. Tests drive it with scripted approvers.
//   * It cannot close the TOCTOU window between a permission check and the
//     actual open/write performed by the executors.
//   * `native-chat` is a fallback owner constant, not an authenticated subject.
//
// Threat model note: every field the policy trusts is supplied by the host
// call path. Nothing here may be derived from model-supplied tool arguments.

/** Canonical file tools this policy understands. */
export const FILE_TOOLS = Object.freeze(['apply_patch', 'find_files', 'read_files', 'read_image', 'search_files']);

/**
 * Operations a grant can cover.
 *
 * The original callback has no operation field, yet apply_patch alone spans
 * four distinct checkpoints (add / modify / move-destination / delete). Reusing
 * one "may touch this path" bit for all of them would let "allowed to read"
 * silently become "allowed to delete", so the operation is modelled explicitly.
 */
export const OPERATIONS = Object.freeze(['read', 'list', 'create', 'modify', 'move', 'delete']);

/** Owner scope kinds; see P1_1_OWNER_LIFECYCLE.md section 2. */
export const SESSION_KINDS = Object.freeze(['bridge', 'modern', 'native']);

/** Operations that never mutate the workspace. */
const READ_ONLY_OPERATIONS = Object.freeze(new Set(['read', 'list']));

export class FileAuthorizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FileAuthorizationError';
    this.code = code;
  }
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new FileAuthorizationError('INVALID_AUTHORIZATION_REQUEST', `${field} must be a non-empty string.`);
  }
  return value;
}

/**
 * Derive the owner scope from host-side transport facts only.
 *
 * Mirrors bridgeManagedCommandOwnerId's fail-closed behaviour: an absent or
 * blank session id raises instead of degrading to an anonymous owner.
 */
export function resolveOwnerScope({sessionKind, sessionId, ownerId} = {}) {
  if (!SESSION_KINDS.includes(sessionKind)) {
    throw new FileAuthorizationError('INVALID_AUTHORIZATION_REQUEST',
      `sessionKind must be one of: ${SESSION_KINDS.join(', ')}.`);
  }
  if (sessionKind === 'bridge') {
    const normalized = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalized) {
      throw new FileAuthorizationError('MCP_SESSION_UNAVAILABLE',
        'The Bridge MCP session is not initialized.');
    }
    return {ownerId: `bridge:${normalized}`, sessionKind, revocable: true};
  }
  if (sessionKind === 'modern') {
    // Modern requests have no server-side session teardown, so a grant here can
    // only expire; there is no onSessionDestroyed hook to revoke it.
    return {ownerId: requireNonEmptyString(ownerId, 'ownerId'), sessionKind, revocable: false};
  }
  return {ownerId: 'native-chat', sessionKind, revocable: true};
}

/**
 * Map a tool + executor checkpoint to the operation being requested.
 *
 * `patchAction` is supplied by the maintenance dispatcher from the parsed patch
 * plan, never from raw model arguments.
 */
export function operationForCheckpoint(tool, patchAction) {
  switch (tool) {
    case 'read_files':
    case 'read_image':
      return 'read';
    case 'find_files':
    case 'search_files':
      return 'list';
    case 'apply_patch': {
      const mapped = {add: 'create', update: 'modify', move: 'move', delete: 'delete'}[patchAction];
      if (!mapped) {
        throw new FileAuthorizationError('INVALID_AUTHORIZATION_REQUEST',
          `apply_patch requires a known operation; received ${JSON.stringify(patchAction)}.`);
      }
      return mapped;
    }
    default:
      throw new FileAuthorizationError('INVALID_AUTHORIZATION_REQUEST', `Unsupported file tool: ${tool}.`);
  }
}

function sameRoots(left, right) {
  return left.length === right.length && left.every((root, index) => root === right[index]);
}

/**
 * Host-owned, fail-closed per-file authorization policy.
 *
 * The host supplies an `approve` callback that represents a real trust
 * decision. Only a literal `true` authorizes; anything else — false, a truthy
 * non-boolean, a rejected promise, a timeout, a closed session — denies.
 */
export class FileAuthorizationPolicy {
  #approve;
  #now;
  #defaultTtlMs;
  #grants = new Map();
  #closed = false;
  #decisions = [];

  /**
   * @param {object} options
   * @param {(request: object) => boolean | Promise<boolean>} options.approve Host trust decision.
   * @param {() => number} [options.now] Injectable clock (host-owned, not client time).
   * @param {number} [options.defaultTtlMs] Bounded lifetime for a cached grant.
   * @param {Record<string, object>} [options.configByTool] Trusted host configuration.
   */
  constructor({approve, now = Date.now, defaultTtlMs = 60_000, configByTool} = {}) {
    if (typeof approve !== 'function') {
      throw new FileAuthorizationError('PERMISSION_POLICY_REQUIRED',
        'A host-owned approval callback is required; the policy refuses to default to allow.');
    }
    if (!Number.isFinite(defaultTtlMs) || defaultTtlMs <= 0) {
      throw new FileAuthorizationError('INVALID_AUTHORIZATION_REQUEST',
        'defaultTtlMs must be a positive, finite number of milliseconds.');
    }
    this.#approve = approve;
    this.#now = now;
    this.#defaultTtlMs = defaultTtlMs;
    // Frozen so a later caller cannot widen host configuration in place.
    this.configByTool = Object.freeze({...(configByTool ?? {})});
  }

  /** Audit trail of decisions; for tests and host diagnostics, not a security log. */
  get decisions() {
    return [...this.#decisions];
  }

  #record(entry) {
    this.#decisions.push({...entry, at: this.#now()});
  }

  #key(owner, tool, operation, absolutePath) {
    return JSON.stringify([owner, tool, operation, absolutePath]);
  }

  /**
   * Evaluate one checkpoint.
   *
   * Returns `true` only when the host approved this exact
   * owner + tool + operation + canonical path, within the workspace roots
   * snapshot that was current at approval time, before the grant expired.
   */
  async authorize(request) {
    const {owner, tool, operation, absolutePath, workspaceRoots, signal} = request;
    try {
      if (this.#closed) throw new FileAuthorizationError('POLICY_CLOSED', 'The authorization policy is closed.');
      requireNonEmptyString(owner?.ownerId, 'owner.ownerId');
      if (!FILE_TOOLS.includes(tool)) {
        throw new FileAuthorizationError('INVALID_AUTHORIZATION_REQUEST', `Unsupported file tool: ${tool}.`);
      }
      if (!OPERATIONS.includes(operation)) {
        throw new FileAuthorizationError('INVALID_AUTHORIZATION_REQUEST', `Unsupported operation: ${operation}.`);
      }
      requireNonEmptyString(absolutePath, 'absolutePath');
      if (!Array.isArray(workspaceRoots) || workspaceRoots.length === 0
        || workspaceRoots.some(root => typeof root !== 'string' || !root)) {
        throw new FileAuthorizationError('INVALID_AUTHORIZATION_REQUEST',
          'At least one workspace root is required.');
      }
      // Cancellation is checked before consulting any cached grant so an
      // aborted request cannot be served from an earlier approval.
      if (signal?.aborted) throw new FileAuthorizationError('ABORTED', 'Authorization was cancelled.');

      const roots = [...workspaceRoots];
      const key = this.#key(owner.ownerId, tool, operation, absolutePath);
      const cached = this.#grants.get(key);
      if (cached) {
        if (cached.expiresAt <= this.#now()) {
          this.#grants.delete(key);
          this.#record({outcome: 'denied', reason: 'expired', owner: owner.ownerId, tool, operation, absolutePath});
          return false;
        }
        if (!sameRoots(cached.workspaceRoots, roots)) {
          this.#grants.delete(key);
          this.#record({outcome: 'denied', reason: 'roots-changed', owner: owner.ownerId, tool, operation, absolutePath});
          return false;
        }
        this.#record({outcome: 'allowed', reason: 'cached-grant', owner: owner.ownerId, tool, operation, absolutePath});
        return true;
      }

      // The host decision may await UI. Only the frozen, host-derived facts are
      // handed over: no model arguments, and no mutable references.
      const decision = await this.#approve(Object.freeze({
        ownerId: owner.ownerId,
        sessionKind: owner.sessionKind,
        revocable: owner.revocable === true,
        tool,
        operation,
        absolutePath,
        mutates: !READ_ONLY_OPERATIONS.has(operation),
        workspaceRoots: Object.freeze([...roots]),
      }));

      // Re-check liveness after the await: the session may have closed or the
      // request may have been cancelled while the host was deciding.
      if (this.#closed) throw new FileAuthorizationError('POLICY_CLOSED',
        'The authorization policy closed while awaiting approval.');
      if (signal?.aborted) throw new FileAuthorizationError('ABORTED',
        'Authorization was cancelled while awaiting approval.');

      if (decision !== true) {
        this.#record({outcome: 'denied', reason: 'host-declined', owner: owner.ownerId, tool, operation, absolutePath});
        return false;
      }

      const ttl = Number.isFinite(request.ttlMs) && request.ttlMs > 0 ? request.ttlMs : this.#defaultTtlMs;
      this.#grants.set(key, {expiresAt: this.#now() + ttl, workspaceRoots: roots});
      this.#record({outcome: 'allowed', reason: 'host-approved', owner: owner.ownerId, tool, operation, absolutePath});
      return true;
    } catch (error) {
      this.#record({
        outcome: 'denied',
        reason: error instanceof FileAuthorizationError ? error.code : 'approver-threw',
        owner: request?.owner?.ownerId, tool: request?.tool,
        operation: request?.operation, absolutePath: request?.absolutePath,
      });
      return false;
    }
  }

  /**
   * Drop every grant for one owner.
   *
   * Call this from the host's session teardown (onSessionDestroyed ->
   * releaseCommandOwner). Modern-era owners have no such hook, which is exactly
   * why grants also expire on their own.
   */
  revokeOwner(ownerId) {
    let removed = 0;
    for (const key of [...this.#grants.keys()]) {
      if (JSON.parse(key)[0] === ownerId) {
        this.#grants.delete(key);
        removed += 1;
      }
    }
    this.#record({outcome: 'revoked', reason: 'owner-released', owner: ownerId, removed});
    return removed;
  }

  /** Deny everything from here on; used on transport shutdown. */
  close() {
    this.#closed = true;
    this.#grants.clear();
  }

  get closed() {
    return this.#closed;
  }
}
