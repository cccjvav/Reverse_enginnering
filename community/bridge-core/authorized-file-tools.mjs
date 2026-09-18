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

import {
  FileAuthorizationError, FileAuthorizationPolicy, operationForCheckpoint, resolveOwnerScope,
} from './file-authorization-policy.mjs';
import {invokeAuthorizedFileTool} from './file-tool-dispatcher.mjs';
import {normalizeFileToolName} from '../../reconstructed/bridge-core/src/file-tool-input-compat.js';

/**
 * Infer the apply_patch checkpoint for a path.
 *
 * The executor's callback passes only an absolute path, so the operation is
 * recovered from the parsed patch plan the host computed, never from model
 * arguments. An unmapped path fails closed rather than defaulting to `modify`.
 */
function patchActionForPath(plan, absolutePath) {
  const entry = plan?.get(absolutePath);
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
 */
export function createPermissionCallback({policy, owner, tool, workspaceRoots, signal, patchPlan}) {
  return async absolutePath => {
    const operation = tool === 'apply_patch'
      ? operationForCheckpoint(tool, patchActionForPath(patchPlan, absolutePath))
      : operationForCheckpoint(tool);
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
export async function invokeFileToolWithPolicy(name, args, {policy, owner, workspaceRoots, signal, patchPlan} = {}) {
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
  return await invokeAuthorizedFileTool(name, args, {
    workspaceRoots: roots,
    signal,
    configByTool: policy.configByTool,
    // The dispatcher calls this as (absolutePath, canonicalToolName) and
    // requires a literal true; the policy returns exactly that.
    checkPermission: createPermissionCallback({
      policy, owner, tool: canonical, workspaceRoots: roots, signal, patchPlan,
    }),
  });
}

export {FileAuthorizationPolicy, resolveOwnerScope, FileAuthorizationError};
