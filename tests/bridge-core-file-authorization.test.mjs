// P1.2 boundary tests for the host-owned file authorization policy.
//
// Scope: real temporary fixture files driven by SCRIPTED approvers in-process.
// This is NOT a user GUI approval flow, NOT an OS sandbox, and NOT evidence for
// the authorization-integration release gate. It exercises the maintenance
// policy and its binding to the original executors' permission callback.

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm, mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  FileAuthorizationPolicy, FileAuthorizationError, resolveOwnerScope,
  operationForCheckpoint, FILE_TOOLS, OPERATIONS,
} from '../community/bridge-core/file-authorization-policy.mjs';
import {invokeFileToolWithPolicy, createPermissionCallback} from '../community/bridge-core/authorized-file-tools.mjs';

const CONTENT = 'alpha\nbeta\n';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shuncode-authz-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(path.join(root, 'a.txt'), CONTENT);
  await writeFile(path.join(root, 'pixel.gif'),
    Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  await mkdir(path.join(root, 'nested'), {recursive: true});
  await writeFile(path.join(root, 'nested', 'b.txt'), 'gamma\n');
  return root;
}

const allow = () => true;
const bridgeOwner = () => resolveOwnerScope({sessionKind: 'bridge', sessionId: 'session-A'});

// ---------------------------------------------------------------------------
// Owner scope derivation
// ---------------------------------------------------------------------------

test('owner scope is fail-closed and mirrors the three original owner sources', () => {
  assert.deepEqual(resolveOwnerScope({sessionKind: 'bridge', sessionId: 'abc'}),
    {ownerId: 'bridge:abc', sessionKind: 'bridge', revocable: true});
  assert.deepEqual(resolveOwnerScope({sessionKind: 'native'}),
    {ownerId: 'native-chat', sessionKind: 'native', revocable: true});

  // Modern requests have no server-side teardown, so they are not revocable.
  const modern = resolveOwnerScope({sessionKind: 'modern', ownerId: 'modern:deadbeef'});
  assert.equal(modern.revocable, false);

  // Blank/absent bridge session must raise, never degrade to an anonymous owner.
  for (const sessionId of [undefined, '', '   ']) {
    assert.throws(() => resolveOwnerScope({sessionKind: 'bridge', sessionId}),
      (error) => error instanceof FileAuthorizationError && error.code === 'MCP_SESSION_UNAVAILABLE');
  }
  assert.throws(() => resolveOwnerScope({sessionKind: 'guessed'}), /sessionKind must be one of/);
});

test('apply_patch checkpoints map to distinct operations, unknown actions fail closed', () => {
  assert.equal(operationForCheckpoint('read_files'), 'read');
  assert.equal(operationForCheckpoint('read_image'), 'read');
  assert.equal(operationForCheckpoint('find_files'), 'list');
  assert.equal(operationForCheckpoint('search_files'), 'list');
  assert.equal(operationForCheckpoint('apply_patch', 'add'), 'create');
  assert.equal(operationForCheckpoint('apply_patch', 'update'), 'modify');
  assert.equal(operationForCheckpoint('apply_patch', 'move'), 'move');
  assert.equal(operationForCheckpoint('apply_patch', 'delete'), 'delete');
  assert.throws(() => operationForCheckpoint('apply_patch', undefined), /requires a known operation/);
  assert.throws(() => operationForCheckpoint('apply_patch', 'sneak'), /requires a known operation/);
  assert.throws(() => operationForCheckpoint('run_command'), /Unsupported file tool/);
  assert.deepEqual([...FILE_TOOLS].sort(),
    ['apply_patch', 'find_files', 'read_files', 'read_image', 'search_files']);
  assert.ok(OPERATIONS.includes('delete') && OPERATIONS.includes('read'));
});

// ---------------------------------------------------------------------------
// Denial matrix (NEXT_AUTHORIZATION.md P1.4)
// ---------------------------------------------------------------------------

test('policy construction refuses to default to allow', () => {
  for (const approve of [undefined, null, true, 'yes', {}]) {
    assert.throws(() => new FileAuthorizationPolicy({approve}),
      (error) => error.code === 'PERMISSION_POLICY_REQUIRED');
  }
  assert.throws(() => new FileAuthorizationPolicy({approve: allow, defaultTtlMs: 0}), /positive, finite/);
});

test('only a literal true authorizes; truthy, throwing and missing approvals deny', async t => {
  const root = await fixture(t);
  const request = {
    owner: bridgeOwner(), tool: 'read_files', operation: 'read',
    absolutePath: path.join(root, 'a.txt'), workspaceRoots: [root],
  };
  for (const decision of [false, undefined, null, 'true', 1, {}, []]) {
    const policy = new FileAuthorizationPolicy({approve: () => decision});
    assert.equal(await policy.authorize(request), false, `decision ${JSON.stringify(decision)}`);
  }
  const thrower = new FileAuthorizationPolicy({approve: () => {throw new Error('fixture-denied');}});
  assert.equal(await thrower.authorize(request), false);
  assert.equal(thrower.decisions.at(-1).reason, 'approver-threw');

  const rejects = new FileAuthorizationPolicy({approve: async () => Promise.reject(new Error('nope'))});
  assert.equal(await rejects.authorize(request), false);

  const allowed = new FileAuthorizationPolicy({approve: allow});
  assert.equal(await allowed.authorize(request), true);
});

test('malformed requests are rejected without consulting the approver', async t => {
  const root = await fixture(t);
  let consulted = 0;
  const policy = new FileAuthorizationPolicy({approve: () => {consulted++; return true;}});
  const base = {
    owner: bridgeOwner(), tool: 'read_files', operation: 'read',
    absolutePath: path.join(root, 'a.txt'), workspaceRoots: [root],
  };
  const bad = [
    {...base, owner: {ownerId: ''}},
    {...base, owner: {}},
    {...base, tool: 'run_command'},
    {...base, operation: 'exfiltrate'},
    {...base, absolutePath: ''},
    {...base, workspaceRoots: []},
    {...base, workspaceRoots: 'not-an-array'},
    {...base, workspaceRoots: [root, '']},
  ];
  for (const request of bad) {
    assert.equal(await policy.authorize(request), false, JSON.stringify(request.tool ?? request));
  }
  assert.equal(consulted, 0, 'approver must not see structurally invalid requests');
});

test('a grant is scoped to one owner, tool, operation and path; neighbours stay denied', async t => {
  const root = await fixture(t);
  const seen = [];
  const policy = new FileAuthorizationPolicy({
    approve: request => {
      seen.push(request);
      return request.operation === 'read' && request.absolutePath === path.join(root, 'a.txt');
    },
  });
  const owner = bridgeOwner();
  const target = path.join(root, 'a.txt');
  assert.equal(await policy.authorize(
    {owner, tool: 'read_files', operation: 'read', absolutePath: target, workspaceRoots: [root]}), true);

  // Same path, escalated operation: must be decided separately and denied.
  assert.equal(await policy.authorize(
    {owner, tool: 'apply_patch', operation: 'delete', absolutePath: target, workspaceRoots: [root]}), false);

  // Same TOOL and same path, different operation: a cached grant must not be
  // reused across operations, otherwise "may modify" would imply "may delete".
  const escalation = [];
  const perOperation = new FileAuthorizationPolicy({
    approve: request => {escalation.push(request.operation); return request.operation === 'modify';},
  });
  const patchRequest = operation =>
    ({owner, tool: 'apply_patch', operation, absolutePath: target, workspaceRoots: [root]});
  assert.equal(await perOperation.authorize(patchRequest('modify')), true);
  assert.equal(await perOperation.authorize(patchRequest('modify')), true, 'cached within one operation');
  assert.equal(await perOperation.authorize(patchRequest('delete')), false, 'modify grant must not cover delete');
  assert.equal(await perOperation.authorize(patchRequest('move')), false, 'modify grant must not cover move');
  assert.deepEqual(escalation, ['modify', 'delete', 'move'],
    'each distinct operation is evaluated on its own; only the repeat is cached');
  // Same operation, different path.
  assert.equal(await policy.authorize({owner, tool: 'read_files', operation: 'read',
    absolutePath: path.join(root, 'nested', 'b.txt'), workspaceRoots: [root]}), false);

  assert.ok(seen.some(r => r.operation === 'delete' && r.mutates === true));
  assert.ok(seen.some(r => r.operation === 'read' && r.mutates === false));
});

test('the approver sees frozen host facts and never model arguments', async t => {
  const root = await fixture(t);
  let captured;
  const policy = new FileAuthorizationPolicy({approve: request => {captured = request; return true;}});
  await policy.authorize({
    owner: bridgeOwner(), tool: 'read_files', operation: 'read',
    absolutePath: path.join(root, 'a.txt'), workspaceRoots: [root],
    // Anything extra on the request must not reach the approver.
    approved: true, checkPermission: () => true, config: {maxLinesPerFile: 9999},
  });
  assert.ok(Object.isFrozen(captured));
  assert.deepEqual(Object.keys(captured).sort(),
    ['absolutePath', 'mutates', 'operation', 'ownerId', 'revocable', 'sessionKind', 'tool', 'workspaceRoots']);
  assert.equal(captured.approved, undefined);
  assert.equal(captured.config, undefined);
  assert.throws(() => {captured.operation = 'delete';}, TypeError);
});

test('grants expire, respect root changes, and are revoked per owner', async t => {
  const root = await fixture(t);
  let clock = 1000;
  let approvals = 0;
  const policy = new FileAuthorizationPolicy({
    approve: () => {approvals++; return true;}, now: () => clock, defaultTtlMs: 500,
  });
  const owner = bridgeOwner();
  const request = {owner, tool: 'read_files', operation: 'read',
    absolutePath: path.join(root, 'a.txt'), workspaceRoots: [root]};

  assert.equal(await policy.authorize(request), true);
  assert.equal(await policy.authorize(request), true);
  assert.equal(approvals, 1, 'second call served by the cached grant');

  clock += 501;
  assert.equal(await policy.authorize(request), false, 'expired grant must not revive the task');
  assert.equal(policy.decisions.at(-1).reason, 'expired');

  // Re-approve, then change the workspace roots snapshot.
  assert.equal(await policy.authorize(request), true);
  assert.equal(await policy.authorize({...request, workspaceRoots: [root, path.join(root, 'nested')]}), false);
  assert.equal(policy.decisions.at(-1).reason, 'roots-changed');

  assert.equal(await policy.authorize(request), true);
  assert.equal(policy.revokeOwner(owner.ownerId), 1);
  approvals = 0;
  assert.equal(await policy.authorize(request), true);
  assert.equal(approvals, 1, 'revoked grant must be re-approved, not reused');
});

test('cancellation and policy close deny, including mid-approval', async t => {
  const root = await fixture(t);
  const request = () => ({owner: bridgeOwner(), tool: 'read_files', operation: 'read',
    absolutePath: path.join(root, 'a.txt'), workspaceRoots: [root]});

  const controller = new AbortController();
  controller.abort();
  const policy = new FileAuthorizationPolicy({approve: allow});
  assert.equal(await policy.authorize({...request(), signal: controller.signal}), false);

  // Cancelled while the host UI is deciding.
  const late = new AbortController();
  const waiting = new FileAuthorizationPolicy({
    approve: async () => {late.abort(); return true;},
  });
  assert.equal(await waiting.authorize({...request(), signal: late.signal}), false);
  assert.equal(waiting.decisions.at(-1).reason, 'ABORTED');

  // Session closed while the host UI is deciding.
  const closing = new FileAuthorizationPolicy({approve: async () => {closing.close(); return true;}});
  assert.equal(await closing.authorize(request()), false);
  assert.equal(closing.decisions.at(-1).reason, 'POLICY_CLOSED');

  // A policy closed BEFORE the call must deny without ever consulting the host
  // approver, not merely deny after it returns.
  let consultedAfterClose = 0;
  const closed = new FileAuthorizationPolicy({approve: () => {consultedAfterClose++; return true;}});
  closed.close();
  assert.equal(await closed.authorize(request()), false);
  assert.equal(consultedAfterClose, 0, 'a closed policy must not reach the approver at all');
  assert.equal(closed.decisions.at(-1).reason, 'POLICY_CLOSED');
  assert.equal(closed.closed, true);

  // close() must also drop cached grants, so a reopened path is re-approved.
  const cached = new FileAuthorizationPolicy({approve: allow});
  assert.equal(await cached.authorize(request()), true);
  cached.close();
  assert.equal(await cached.authorize(request()), false);
});

test('two sessions are isolated: B cannot reuse or revoke A grants', async t => {
  const root = await fixture(t);
  const approved = [];
  const policy = new FileAuthorizationPolicy({
    approve: request => {approved.push(request.ownerId); return request.ownerId === 'bridge:session-A';},
  });
  const a = resolveOwnerScope({sessionKind: 'bridge', sessionId: 'session-A'});
  const b = resolveOwnerScope({sessionKind: 'bridge', sessionId: 'session-B'});
  const shared = {tool: 'read_files', operation: 'read',
    absolutePath: path.join(root, 'a.txt'), workspaceRoots: [root]};

  assert.equal(await policy.authorize({owner: a, ...shared}), true);
  assert.equal(await policy.authorize({owner: b, ...shared}), false);
  assert.ok(approved.includes('bridge:session-B'), 'B must be evaluated on its own, not inherit A');

  // B releasing its own owner must not disturb A's grant.
  assert.equal(policy.revokeOwner(b.ownerId), 0);
  approved.length = 0;
  assert.equal(await policy.authorize({owner: a, ...shared}), true);
  assert.equal(approved.length, 0, "A's grant survived B's release");
});

// ---------------------------------------------------------------------------
// End-to-end against the original executors, with real files on disk
// ---------------------------------------------------------------------------

test('all five tools deny without a policy and leave the fixture unchanged', async t => {
  const root = await fixture(t);
  const calls = [
    ['read_files', {files: [{path: 'a.txt'}]}],
    ['read_image', {path: 'pixel.gif'}],
    ['find_files', {patterns: ['*.txt']}],
    ['search_files', {pattern: 'alpha'}],
    ['apply_patch', {patch: '*** Begin Patch\n*** Update File: a.txt\n@@\n-alpha\n+CHANGED\n*** End Patch'}],
  ];
  for (const [name, args] of calls) {
    const result = await invokeFileToolWithPolicy(name, args, {workspaceRoots: [root]});
    assert.equal(result.structuredContent.error_code, 'PERMISSION_POLICY_REQUIRED', name);
    assert.ok(!JSON.stringify(result).includes('alpha\nbeta'), name);
  }
  assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), CONTENT);
});

test('denied reads return no protected content and approved reads honour host config', async t => {
  const root = await fixture(t);
  const owner = bridgeOwner();

  const denied = await invokeFileToolWithPolicy('read_files', {files: [{path: 'a.txt'}]},
    {policy: new FileAuthorizationPolicy({approve: () => false}), owner, workspaceRoots: [root]});
  assert.equal(denied.isError, true);
  assert.ok(!JSON.stringify(denied).includes('alpha\nbeta'));

  const allowed = await invokeFileToolWithPolicy('read_files', {files: [{path: 'a.txt'}]},
    {policy: new FileAuthorizationPolicy({approve: allow, configByTool: {read_files: {maxLinesPerFile: 1}}}),
      owner, workspaceRoots: [root]});
  assert.equal(allowed.isError, undefined);
  assert.equal(allowed.structuredContent.files[0].content, '1: alpha');
});

test('args cannot forge owner, approval or host config', async t => {
  const root = await fixture(t);
  let sawOwner;
  const policy = new FileAuthorizationPolicy({
    approve: request => {sawOwner = request.ownerId; return false;},
    configByTool: {read_files: {maxLinesPerFile: 1}},
  });
  const owner = bridgeOwner();

  // The original input validator refuses unknown properties outright, so a
  // forged owner/approved/config never even reaches the policy. Assert that
  // real behaviour rather than assuming authorization is the first gate.
  const rejectedEarly = await invokeFileToolWithPolicy('read_files', {
    files: [{path: 'a.txt'}],
    owner: 'bridge:attacker', approved: true, checkPermission: () => true,
  }, {policy, owner, workspaceRoots: [root]});
  assert.equal(rejectedEarly.isError, true);
  assert.match(rejectedEarly.text, /is not an allowed property/);
  assert.equal(sawOwner, undefined, 'validator rejected the forged input before authorization');
  assert.ok(!JSON.stringify(rejectedEarly).includes('alpha\nbeta'));

  // With a schema-valid request, the owner still comes from the host and the
  // caller-supplied approval cannot flip the decision.
  const denied = await invokeFileToolWithPolicy('read_files', {files: [{path: 'a.txt'}]},
    {policy, owner, workspaceRoots: [root], checkPermission: () => true, approved: true});
  assert.equal(denied.isError, true);
  assert.equal(sawOwner, 'bridge:session-A', 'owner came from the host, not from args');
  assert.ok(!JSON.stringify(denied).includes('alpha\nbeta'));
  assert.ok(Object.isFrozen(policy.configByTool));

  // Host config wins over anything a caller passes alongside the tool args.
  const allowedPolicy = new FileAuthorizationPolicy({
    approve: allow, configByTool: {read_files: {maxLinesPerFile: 1}},
  });
  const capped = await invokeFileToolWithPolicy('read_files', {files: [{path: 'a.txt'}]},
    {policy: allowedPolicy, owner, workspaceRoots: [root], configByTool: {read_files: {maxLinesPerFile: 9999}}});
  assert.equal(capped.structuredContent.files[0].content, '1: alpha');
});

test('apply_patch authorizes add, modify, move and delete as distinct operations', async t => {
  const root = await fixture(t);
  const owner = bridgeOwner();
  const target = path.join(root, 'a.txt');

  // "Allowed to read" must not permit deletion of the same file. The operation
  // is derived from the patch itself, so the caller cannot mislabel it.
  const readOnly = new FileAuthorizationPolicy({approve: request => request.operation === 'read'});
  const refusedDelete = await invokeFileToolWithPolicy('apply_patch',
    {patch: '*** Begin Patch\n*** Delete File: a.txt\n*** End Patch'},
    {policy: readOnly, owner, workspaceRoots: [root]});
  assert.equal(refusedDelete.isError, true);
  assert.equal(await readFile(target, 'utf8'), CONTENT, 'file survives a denied delete');

  // A correctly authorized modify does apply.
  const seen = [];
  const modifyPolicy = new FileAuthorizationPolicy({
    approve: request => {seen.push(request.operation); return request.operation === 'modify';},
  });
  const patched = await invokeFileToolWithPolicy('apply_patch',
    {patch: '*** Begin Patch\n*** Update File: a.txt\n@@\n-alpha\n+CHANGED\n*** End Patch'},
    {policy: modifyPolicy, owner, workspaceRoots: [root]});
  assert.equal(patched.isError, undefined);
  assert.equal(await readFile(target, 'utf8'), 'CHANGED\nbeta\n');
  assert.ok(seen.every(operation => operation === 'modify'));

  // A delete is classified as 'delete' even though apply_patch is one tool.
  const deleteOps = [];
  const deletePolicy = new FileAuthorizationPolicy({
    approve: request => {deleteOps.push(request.operation); return request.operation === 'delete';},
  });
  const deleted = await invokeFileToolWithPolicy('apply_patch',
    {patch: '*** Begin Patch\n*** Delete File: a.txt\n*** End Patch'},
    {policy: deletePolicy, owner, workspaceRoots: [root]});
  assert.equal(deleted.isError, undefined, deleted.text);
  assert.deepEqual(deleteOps, ['delete']);
  await assert.rejects(readFile(target), {code: 'ENOENT'});

  // An unparseable patch authorizes nothing and changes nothing.
  const unparseable = await invokeFileToolWithPolicy('apply_patch', {patch: 'not a patch'},
    {policy: new FileAuthorizationPolicy({approve: allow}), owner, workspaceRoots: [root]});
  assert.equal(unparseable.isError, true);
  assert.equal(await readFile(path.join(root, 'nested', 'b.txt'), 'utf8'), 'gamma\n');

  // A missing or non-Map plan must DENY, and must never reach the approver:
  // "no plan" must not degrade into "no checks". Asserted on the raw callback
  // and on the policy, so the defensive try/catch cannot mask a real regression.
  for (const patchPlan of [undefined, null, {}, new Map()]) {
    let consulted = 0;
    const noPlan = createPermissionCallback({
      policy: new FileAuthorizationPolicy({approve: () => {consulted++; return true;}}), owner,
      tool: 'apply_patch', workspaceRoots: () => [root], patchPlan,
    });
    assert.equal(await noPlan(path.join(root, 'nested', 'b.txt')), false,
      `plan ${JSON.stringify(patchPlan)} must deny`);
    assert.equal(consulted, 0, 'an unclassifiable path must not reach the approver');
  }

  // And end to end: if plan derivation fails, nothing is authorized or changed.
  let approverCalls = 0;
  const derailed = await invokeFileToolWithPolicy('apply_patch',
    {patch: '*** Begin Patch\n*** Update File: missing-file.txt\n@@\n-x\n+y\n*** End Patch'},
    {policy: new FileAuthorizationPolicy({approve: () => {approverCalls++; return true;}}),
      owner, workspaceRoots: [root]});
  assert.equal(derailed.isError, true);
  assert.equal(approverCalls, 0, 'an unresolvable patch authorizes nothing');
});

test('a caller cannot mislabel a delete by supplying its own patch plan', async t => {
  const root = await fixture(t);
  const secret = path.join(root, 'a.txt');
  const seen = [];
  // Host allows modify but refuses delete.
  const policy = new FileAuthorizationPolicy({
    approve: request => {seen.push(request.operation); return request.operation === 'modify';},
  });
  const result = await invokeFileToolWithPolicy('apply_patch',
    {patch: '*** Begin Patch\n*** Delete File: a.txt\n*** End Patch'},
    // A caller-supplied plan claiming this is an 'update' must be ignored: the
    // operation is derived from the patch by the original parser.
    {policy, owner: bridgeOwner(), workspaceRoots: [root],
      patchPlan: new Map([[secret, 'update']])});
  assert.deepEqual(seen, ['delete'], 'derived from the patch, not from the caller');
  assert.equal(result.isError, true);
  assert.equal(await readFile(secret, 'utf8'), CONTENT, 'the refused delete did not happen');
});

test('a move authorizes both the source and the destination', async t => {
  const root = await fixture(t);
  const owner = bridgeOwner();
  const seen = [];
  // Approve the source modify but refuse the destination: the move must not happen.
  const partial = new FileAuthorizationPolicy({
    approve: request => {seen.push([request.operation, path.basename(request.absolutePath)]);
      return request.operation === 'modify';},
  });
  const patch = {patch: '*** Begin Patch\n*** Update File: a.txt\n*** Move to: moved.txt\n@@\n-alpha\n+CHANGED\n*** End Patch'};
  const refused = await invokeFileToolWithPolicy('apply_patch', patch,
    {policy: partial, owner, workspaceRoots: [root]});
  assert.equal(refused.isError, true);
  assert.ok(seen.some(([operation]) => operation === 'move'), 'destination evaluated as a move');
  await assert.rejects(readFile(path.join(root, 'moved.txt')), {code: 'ENOENT'});
  assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), CONTENT, 'source untouched');

  const full = new FileAuthorizationPolicy({approve: allow});
  const moved = await invokeFileToolWithPolicy('apply_patch', patch,
    {policy: full, owner, workspaceRoots: [root]});
  assert.equal(moved.isError, undefined, moved.text);
  assert.equal(await readFile(path.join(root, 'moved.txt'), 'utf8'), 'CHANGED\nbeta\n');
});

test('an approved add creates the file and a denied add does not', async t => {
  const root = await fixture(t);
  const owner = bridgeOwner();
  const created = path.join(root, 'new.txt');
  const patch = {patch: '*** Begin Patch\n*** Add File: new.txt\n+hello\n*** End Patch'};
  const plan = new Map([[created, 'add']]);

  const denied = await invokeFileToolWithPolicy('apply_patch', patch,
    {policy: new FileAuthorizationPolicy({approve: () => false}), owner, workspaceRoots: [root], patchPlan: plan});
  assert.equal(denied.isError, true);
  await assert.rejects(readFile(created), {code: 'ENOENT'});

  const allowedResult = await invokeFileToolWithPolicy('apply_patch', patch,
    {policy: new FileAuthorizationPolicy({approve: request => request.operation === 'create'}),
      owner, workspaceRoots: [root], patchPlan: plan});
  assert.equal(allowedResult.isError, undefined);
  assert.equal(await readFile(created, 'utf8'), 'hello\n');
});

test('each tool is authorized on its own; read approval does not unlock the other four', async t => {
  const root = await fixture(t);
  const owner = bridgeOwner();
  const policy = new FileAuthorizationPolicy({approve: request => request.tool === 'read_files'});

  const read = await invokeFileToolWithPolicy('read_files', {files: [{path: 'a.txt'}]},
    {policy, owner, workspaceRoots: [root]});
  assert.equal(read.isError, undefined);

  for (const [name, args] of [
    ['read_image', {path: 'pixel.gif'}],
    ['find_files', {patterns: ['*.txt']}],
    ['search_files', {pattern: 'alpha'}],
  ]) {
    const result = await invokeFileToolWithPolicy(name, args, {policy, owner, workspaceRoots: [root]});
    assert.equal(result.isError, true, name);
  }

  // And each one works once its own tool is approved.
  const permissive = new FileAuthorizationPolicy({approve: allow});
  const image = await invokeFileToolWithPolicy('read_image', {path: 'pixel.gif'},
    {policy: permissive, owner, workspaceRoots: [root]});
  assert.equal(image.content[1].type, 'image');
  const found = await invokeFileToolWithPolicy('find_files', {patterns: ['*.txt']},
    {policy: permissive, owner, workspaceRoots: [root]});
  assert.equal(found.isError, undefined);
});

test('patch plans survive a root whose realpath differs from the host spelling', async t => {
  // Regression: the executors realpath() workspace roots before calling
  // checkPermission, so a plan keyed by the host's raw spelling never matched.
  // On Windows this fires by default because mkdtemp/TEMP hands back an 8.3
  // short name (RUNNER~1) that realpath expands; a symlinked root reproduces
  // the identical mismatch on POSIX. CI caught this on windows-2022 only.
  const base = await mkdtemp(path.join(os.tmpdir(), 'shuncode-authz-link-'));
  t.after(() => rm(base, {recursive: true, force: true}));
  const real = path.join(base, 'real');
  const link = path.join(base, 'link');
  await mkdir(real, {recursive: true});
  await writeFile(path.join(real, 'a.txt'), CONTENT);
  const {symlink, realpath} = await import('node:fs/promises');
  try {
    await symlink(real, link, 'junction');
  } catch (error) {
    t.skip(`symlinked roots unavailable here: ${error.code}`);
    return;
  }

  // Only run the assertion when the two spellings genuinely differ.
  const resolvedRoot = await realpath(link);
  assert.notEqual(resolvedRoot, link, 'fixture must produce a differing realpath');

  const owner = bridgeOwner();
  const seen = [];
  const policy = new FileAuthorizationPolicy({
    approve: request => {seen.push([request.operation, request.absolutePath]); return true;},
  });
  const created = await invokeFileToolWithPolicy('apply_patch',
    {patch: '*** Begin Patch\n*** Add File: new.txt\n+hello\n*** End Patch'},
    {policy, owner, workspaceRoots: [link]});

  assert.equal(created.isError, undefined, created.text);
  assert.equal(await readFile(path.join(real, 'new.txt'), 'utf8'), 'hello\n');
  assert.deepEqual(seen.map(([operation]) => operation), ['create']);
  // The approver must see the resolved path, matching what the executor uses.
  assert.equal(seen[0][1], path.join(resolvedRoot, 'new.txt'));

  // Denial still works through the same resolved-root path.
  const denied = await invokeFileToolWithPolicy('apply_patch',
    {patch: '*** Begin Patch\n*** Update File: a.txt\n@@\n-alpha\n+CHANGED\n*** End Patch'},
    {policy: new FileAuthorizationPolicy({approve: () => false}), owner, workspaceRoots: [link]});
  assert.equal(denied.isError, true);
  assert.equal(await readFile(path.join(real, 'a.txt'), 'utf8'), CONTENT);
});

test('cancelling mid-call denies and the permission callback reports the owner scope', async t => {
  const root = await fixture(t);
  const controller = new AbortController();
  const policy = new FileAuthorizationPolicy({approve: async () => {controller.abort(); return true;}});
  const result = await invokeFileToolWithPolicy('read_files', {files: [{path: 'a.txt'}]},
    {policy, owner: bridgeOwner(), workspaceRoots: [root], signal: controller.signal});
  assert.equal(result.isError, true);
  assert.ok(!JSON.stringify(result).includes('alpha\nbeta'));

  // The callback shape the executors rely on: (absolutePath) -> boolean.
  const direct = createPermissionCallback({
    policy: new FileAuthorizationPolicy({approve: allow}), owner: bridgeOwner(),
    tool: 'read_files', workspaceRoots: () => [root],
  });
  assert.equal(await direct(path.join(root, 'a.txt')), true);
});
