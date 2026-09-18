// Maintenance design, NOT a recovered original module.
// Binds the host-owned FileAuthorizationPolicy to the original executors'
// per-path `checkPermission(absolutePath)` callback shape.
//
// Design record: docs/handoff/P1_1_OWNER_LIFECYCLE.md
//
// Known, deliberately un-hidden limitations:
//   * apply_patch runs preflight TWICE (once to collect locks, once under the
//     locks). The same path is therefore authorized more than once per call.
//     Grants are cached per owner+tool+operation+path so the host is not
//     re-prompted mid-operation; this is a usability decision with a security
//     cost, and it is why grants are bounded by TTL and dropped on revoke.
//   * Supplying a permission callback makes find_files/search_files fall back
//     from the preferred engine (ripgrep) to the per-entry Node walker; see
//     find-files.js:372 and search-files.js:534. Behaviour and performance
//     change versus the default path.
//   * The executors re-resolve paths after the callback returns; this narrows
//     but does not eliminate TOCTOU.

import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {
  FileAuthorizationError, FileAuthorizationPolicy, operationForCheckpoint, resolveOwnerScope,
} from './file-authorization-policy.mjs';
import {invokeAuthorizedFileTool} from './file-tool-dispatcher.mjs';
import {normalizeFileToolName, normalizeFileToolInput} from '../../reconstructed/bridge-core/src/file-tool-input-compat.js';
import {
  DEFAULT_APPLY_PATCH_CONFIG, parsePatch, resolveExistingPath, resolveNewPath,
} from '../../reconstructed/bridge-core/src/apply-patch.js';

/**
 * Derive the authorized patch plan from the patch itself, using the ORIGINAL
 * parser and the ORIGINAL path resolvers.
 *
 * Earlier this plan was supplied by the caller, which made a correct grant
 * depend on the caller spelling paths exactly as the executors would. That is
 * both fragile (it shipped a Windows-only defect: mkdtemp short names expand
 * under realpath, so no key matched) and a weak trust boundary, since a wrong
 * or hostile plan could mislabel a delete as a modify.
 *
 * Deriving it here means the operation attached to each path comes from the
 * same parse the executor will perform, not from anything a caller asserts.
 * Parse/resolution failures are surfaced as denials: the executor re-parses and
 * reports the authoritative error, and a path we could not classify stays
 * unauthorized.
 */
async function derivePatchPlan(args, workspaceRoots, config) {
  const plan = new Map();
  const normalized = normalizeFileToolInput('apply_patch', args);
  if (!normalized || typeof normalized.patch !== 'string' || normalized.patch.length === 0) return plan;
  const roots = workspaceRoots();
  const record = (absolutePath, action) => {
    plan.set(absolutePath, action);
    if (process.platform === 'win32') plan.set(absolutePath.toLowerCase(), action);
  };
  for (const operation of parsePatch(normalized.patch, {...DEFAULT_APPLY_PATCH_CONFIG, ...config})) {
    if (operation.action === 'add') {
      record((await resolveNewPath(operation.path, roots)).absolutePath, 'add');
      continue;
    }
    const source = await resolveExistingPath(operation.path, roots);
    record(source.absolutePath, operation.action);
    if (operation.action === 'update' && operation.moveTo) {
      record((await resolveNewPath(operation.moveTo, roots)).absolutePath, 'move');
    }
  }
  return plan;
}

/**
 * Infer the apply_patch checkpoint for a path.
 *
 * The executor's callback passes only an absolute path, so the operation comes
 * from the derived plan above. An unmapped path fails closed rather than
 * defaulting to `modify`.
 *
 * Windows filesystems are case-insensitive, so a case-folded lookup is tried
 * before giving up.
 */
function patchActionForPath(plan, absolutePath) {
  // An absent plan is a denial, not an exemption. Derivation failures hand us
  // an empty Map, but guard the missing/!Map case explicitly so a future edit
  // cannot turn "no plan" into "no checks".
  if (!(plan instanceof Map)) {
    throw new FileAuthorizationError('INVALID_AUTHORIZATION_REQUEST',
      'apply_patch has no derived authorization plan; refusing to guess the operation.');
  }
  const entry = plan.get(absolutePath)
    ?? (process.platform === 'win32' ? plan.get(absolutePath.toLowerCase()) : undefined);
  if (!entry) {
    throw new FileAuthorizationError('INVALID_AUTHORIZATION_REQUEST',
      'apply_patch touched a path that was not in the authorized plan.');
  }
  return entry;
}

/**
 * Build the `context.checkPermission` callback for one tool invocation.
 *
 * @param {object} options
 * @param {FileAuthorizationPolicy} options.policy Host-owned policy.
 * @param {object} options.owner Result of resolveOwnerScope().
 * @param {string} options.tool Canonical tool name.
 * @param {() => string[]} options.workspaceRoots Host root resolver.
 * @param {AbortSignal} [options.signal]
 * @param {Map<string, string>} [options.patchPlan] absolutePath -> patch action.
 *   Supplied by invokeFileToolWithPolicy from the parsed patch, not by callers.
 */
export function createPermissionCallback({policy, owner, tool, workspaceRoots, signal, patchPlan}) {
  return async absolutePath => {
    // The executors treat any falsy return as "denied", so classification
    // failures must resolve to false rather than propagate. Throwing here would
    // abort the whole tool call and, depending on the caller, could be reported
    // as a generic error instead of a permission denial.
    let operation;
    try {
      operation = tool === 'apply_patch'
        ? operationForCheckpoint(tool, patchActionForPath(patchPlan, absolutePath))
        : operationForCheckpoint(tool);
    } catch {
      return false;
    }
    return await policy.authorize({
      owner, tool, operation, absolutePath,
      workspaceRoots: workspaceRoots(), signal,
    });
  };
}

/**
 * Invoke a file tool under host-owned authorization.
 *
 * `owner` must come from resolveOwnerScope() using transport facts. Passing
 * owner/approved/config through `args` cannot influence the decision: args are
 * forwarded to the original parsers only, and the policy reads none of them.
 */
export async function invokeFileToolWithPolicy(name, args, {policy, owner, workspaceRoots, signal} = {}) {
  if (!(policy instanceof FileAuthorizationPolicy)) {
    return {
      text: 'PERMISSION_POLICY_REQUIRED: A host-owned FileAuthorizationPolicy is required.',
      isError: true,
      structuredContent: {
        status: 'error', error_code: 'PERMISSION_POLICY_REQUIRED',
        message: 'A host-owned FileAuthorizationPolicy is required.',
      },
    };
  }
  const canonical = normalizeFileToolName(name);
  const roots = typeof workspaceRoots === 'function' ? workspaceRoots : () => workspaceRoots;
  // Derive the plan from the patch itself so no caller can mislabel an operation.
  // A parse/resolve failure yields an empty plan: every checkpoint then fails
  // closed and the executor re-parses to report the authoritative error.
  let resolvedPlan;
  if (canonical === 'apply_patch') {
    try {
      resolvedPlan = await derivePatchPlan(args, roots, policy.configByTool?.apply_patch);
    } catch {
      resolvedPlan = new Map();
    }
  }
  return await invokeAuthorizedFileTool(name, args, {
    workspaceRoots: roots,
    signal,
    configByTool: policy.configByTool,
    // The dispatcher calls this as (absolutePath, canonicalToolName) and
    // requires a literal true; the policy returns exactly that.
    checkPermission: createPermissionCallback({
      policy, owner, tool: canonical, workspaceRoots: roots, signal, patchPlan: resolvedPlan,
    }),
  });
}

export {FileAuthorizationPolicy, resolveOwnerScope, FileAuthorizationError};
