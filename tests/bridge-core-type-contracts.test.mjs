import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { ROOT } from '../tools/patch_utils.mjs';
import { diagnoseTypes } from '../tools/diagnose_linked_types.mjs';
import { Semaphore } from '../reconstructed/bridge-core/src/concurrency.js';
import { AdaptiveConcurrencyController } from '../reconstructed/bridge-core/src/adaptive-concurrency.js';
import { JsonRpcRequestIdRegistry, requestIdsOfRequest } from '../reconstructed/bridge-core/src/jsonrpc-request-id-registry.js';
import { BridgeSessionRegistry } from '../reconstructed/bridge-core/src/bridge-session-registry.js';

test('candidate contracts expose typed HTTP boundary mismatches without hiding remaining host/type failures', async () => {
  const actual = await diagnoseTypes({ contracts: true });
  const stored = JSON.parse(await readFile(path.join(ROOT, 'docs/evidence/contract-type-diagnostics.json'), 'utf8'));
  assert.deepEqual(actual, stored);
  assert.equal(actual.errorCount, 14);
  assert.equal(actual.contractModules.length, 14);
  assert.equal(actual.candidateTypecheckPassed, false);
  assert.equal(actual.runtimeImplementationCheckedByTypeScript, false);
  assert.equal(actual.originalTypesRecovered, false);
  assert.ok(actual.diagnostics.some(d => d.message.includes('ChatSimpleToolResultData')));
  assert.equal(actual.diagnostics.filter(d => d.code === 2345 && d.source.endsWith('bridge-mcp-transport.ts')).length, 3);
  assert.equal(actual.counts.TS7006, undefined);
  assert.ok(!actual.diagnostics.some(d => d.code === 2749 && /Semaphore|AdaptiveConcurrencyController|JsonRpcRequestIdRegistry|BridgeSessionRegistry/.test(d.message)));
});

test('contracts check strictly including declarations and reject invalid callers', async () => {
  const dir = path.join(ROOT, '.work/type-contract-tests');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'fixture.mts');
  await writeFile(file, `
import { Semaphore } from '../../reconstructed/type-contracts/concurrency.js';
import { AdaptiveConcurrencyController } from '../../reconstructed/type-contracts/adaptive-concurrency.js';
import { JsonRpcRequestIdRegistry, requestIdsOfRequest } from '../../reconstructed/type-contracts/jsonrpc-request-id-registry.js';
import { BridgeSessionRegistry } from '../../reconstructed/type-contracts/bridge-session-registry.js';
const gate = new Semaphore(2);
const result: number = await gate.run(async () => 42);
const release: () => void = await gate.acquire(new AbortController().signal);
release();
// @ts-expect-error numeric constructor required
new Semaphore('2');
// @ts-expect-error generic output must not be widened to any
const wrong: string = await gate.run(() => 42);
const adaptive = new AdaptiveConcurrencyController({min: 1, max: 4});
const reason: 'hold' | 'grow' | 'shrink' = adaptive.record({failed: false, queued: 1, durationMs: 10}).reason;
// @ts-expect-error sample must carry observed duration and queue
adaptive.record({failed: false});
const ids = new JsonRpcRequestIdRegistry();
const claim = ids.claim(requestIdsOfRequest({method: 'ping', id: 1}));
if (!claim.ok) { const conflict: string | number = claim.conflictId; }
// @ts-expect-error null is not a supported request ID
ids.claim([null]);
interface Session { activeRequests: number; activeStreams: number; lastActivity: number; label: string }
const sessions = new BridgeSessionRegistry<Session>({closeSession: s => { const label: string = s.label; }});
sessions.set('a', {activeRequests: 0, activeStreams: 0, lastActivity: 1, label: 'A'});
// @ts-expect-error session activity fields are required
sessions.set('b', {label: 'B'});
// @ts-expect-error get may miss
const missing: Session = sessions.get('missing');
// @ts-expect-error arbitrary object cannot be the session generic
new BridgeSessionRegistry<{label: string}>();
await sessions.destroyAfter('a', async s => s.label);
import { BridgeActivityTracker } from '../../reconstructed/type-contracts/bridge-activity-tracker.js';
import { BoundedInMemoryEventStore } from '../../reconstructed/type-contracts/bridge-event-store.js';
import type { EventStore, JSONRPCMessage } from '@modelcontextprotocol/server';
import type { BridgeHttpHandlers } from '../../reconstructed/type-contracts/bridge-http-router.js';
const tracker = new BridgeActivityTracker<{title: string}>(3, () => 'time');
const activityId: number = tracker.push({tool: 'read_files', status: 'running', presentation: {title: 'Read'}});
tracker.finish(activityId, 'completed', 10);
const title: string | undefined = tracker.snapshot().activities[0].presentation?.title;
// @ts-expect-error presentation must retain the chosen generic
tracker.push({tool: 'read_files', status: 'running', presentation: {title: 42}});
// @ts-expect-error finish is a terminal transition in the preserved consumer
tracker.finish(activityId, 'progress', 10);
const store = new BoundedInMemoryEventStore(3);
const sdkStore: EventStore = store;
await sdkStore.storeEvent('s', {jsonrpc: '2.0', method: 'ping', id: 1});
// @ts-expect-error invalid JSON-RPC version
await store.storeEvent('s', {jsonrpc: '1.0', method: 'ping', id: 1});
await store.replayEventsAfter('id', {send: async (id, message) => {
  const event: JSONRPCMessage = message;
}});
import { loadCustomTools, findCustomTool, executeCustomTool, type CustomToolManifest } from '../../reconstructed/type-contracts/custom-tools.js';
import { diagnoseSkillTools, type SkillLoadDiagnosis } from '../../reconstructed/type-contracts/custom-tool-skill.js';
import { importSkill, generateSkillRunner, type SkillImportResult } from '../../reconstructed/type-contracts/custom-tool-skill-import.js';
import { toggleCustomTool, deleteCustomTool } from '../../reconstructed/type-contracts/custom-tool-admin.js';
import { resolveBridgeToolName } from '../../reconstructed/type-contracts/bridge-tool-name.js';
const tools = loadCustomTools(['fixture'], message => { const text: string = message; }, {skillsEnabled: false});
// @ts-expect-error find can miss or filter out a disabled tool
const definitelyFound: CustomToolManifest = findCustomTool(['fixture'], 'missing');
// @ts-expect-error skill option is boolean
loadCustomTools([], undefined, {skillsEnabled: 'yes'});
// @ts-expect-error command entries must be strings
const badManifest: CustomToolManifest = {...tools[0], command: [123]};
// @ts-expect-error schema type must be object (not a deep schema validity guarantee)
const badSchema: CustomToolManifest = {...tools[0], inputSchema: {type: 'array'}};
for (const diagnosis of diagnoseSkillTools('fixture')) {
  if (diagnosis.loaded) { const name: string = diagnosis.name; }
  else { const reason: string = diagnosis.reason; const optionalName: string | undefined = diagnosis.name; }
}
// @ts-expect-error loaded success requires a name
const badDiagnosis: SkillLoadDiagnosis = {dirName: 'a', loaded: true};
const collision: SkillLoadDiagnosis = {dirName: 'a', name: 'tool_a', loaded: false, reasonCode: 'duplicate-name', reason: 'collision', fix: 'open-folder'};
const imported = importSkill('fixture', 'source', message => { const text: string = message; });
const renamed: string | undefined = imported.renamedFrom;
// @ts-expect-error import emits true or undefined, not false
const badImport: SkillImportResult = {...imported, generatedRunner: false};
const runner = generateSkillRunner('fixture', 'tool');
if (runner.generated) { const rel: string = runner.runnerRel; }
else {
  // @ts-expect-error already-present entry has no runnerRel
  const rel: string = runner.runnerRel;
}
const enabled: boolean = toggleCustomTool(['fixture'], 'tool').enabled;
const deleted: string = deleteCustomTool(['fixture'], 'tool').deleted;
const execution = await executeCustomTool(['fixture'], tools[0], {}, {log: message => { const text: string = message; }});
const exitCode: number | null = execution.structuredContent.exit_code;
// @ts-expect-error nullable exit status cannot be assumed successful numeric exit
const definiteExit: number = execution.structuredContent.exit_code;
resolveBridgeToolName('mcp__server__tool', name => { const text: string = name; return name === 'tool'; });
// @ts-expect-error known-name predicate must return boolean
resolveBridgeToolName('tool', name => name);
import { ManagedCommandCanceller, NATIVE_MANAGED_COMMAND_OWNER_ID, type ManagedCommandCancellationTarget } from '../../reconstructed/type-contracts/managed-command-cancellation.js';
import { invokeFileTool, type ToolContentBlock } from '../../reconstructed/type-contracts/file-tool-registry.js';
const cancel = new ManagedCommandCanceller({waitForGrace: async (target, ms) => { const command: string = target.command; }});
declare const target: ManagedCommandCancellationTarget;
const owner: string = NATIVE_MANAGED_COMMAND_OWNER_ID;
const preview = cancel.preview(target, 'bridge:fixture');
const risk: 'normal' | 'high' = preview.riskLevel;
// @ts-expect-error ownership is required even for cancellation
cancel.cancel(target, {graceMs: 10});
// @ts-expect-error unknown is not a lifecycle status
const invalidTarget: ManagedCommandCancellationTarget = {...target, status: 'unknown'};
const fileResult = await invokeFileTool('read_files', {}, {workspaceRoots: () => ['fixture']});
const blocks: ToolContentBlock[] | undefined = fileResult.content;
// @ts-expect-error an image block requires actual data and MIME type
const invalidImage: ToolContentBlock = {type: 'image', text: 'not image data'};
const handlers: BridgeHttpHandlers = {
  getSessionCount: () => 0,
  handlePost: async (req, res, body, sessionId) => {
    // @ts-expect-error raw header can be string[]
    const id: string | undefined = sessionId;
    // @ts-expect-error JSON body requires narrowing before property access
    const method: string = body.method;
  },
  handleGet: async (req, res, sessionId) => {
    // @ts-expect-error non-empty header still is not guaranteed string
    const id: string = sessionId;
  },
  handleDelete: async (req, res, sessionId) => { if (typeof sessionId === 'string') sessionId.trim(); }
};
`);
  const options = { strict: true, noEmit: true, skipLibCheck: false, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'], typeRoots: [path.join(ROOT, 'node_modules/@types')] };
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options));
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});

test('observed runtime bodies agree with generic result, claim union and session callback contracts', async () => {
  const gate = new Semaphore(1);
  assert.equal(await gate.run(() => 42), 42);
  assert.equal(await gate.run(async () => 'async'), 'async');
  const release = await gate.acquire(); release(); release();
  assert.equal(gate.active, 0);
  const adaptive = new AdaptiveConcurrencyController({ min: 1, max: 3, windowSize: 1 });
  assert.deepEqual(adaptive.record({ failed: false, queued: 1, durationMs: 1 }), {limit: 2, changed: true, reason: 'grow'});
  const ids = new JsonRpcRequestIdRegistry();
  assert.deepEqual(requestIdsOfRequest([{method: 'a', id: null}, {method: 'a', id: 1}, {method: 'b', id: '1'}]), [1, '1']);
  assert.deepEqual(ids.claim([1, '1']), {ok: true});
  assert.deepEqual(ids.claim([1]), {ok: false, conflictId: 1});
  ids.release([1]); assert.deepEqual(ids.claim([1]), {ok: true});
  const events = [];
  const sessions = new BridgeSessionRegistry({closeSession: s => events.push(s.label), onSessionDestroyed: (id, s, reason) => events.push([id, s.label, reason])});
  const session = {activeRequests: 0, activeStreams: 0, lastActivity: 1, label: 'A'};
  assert.equal(sessions.get('missing'), undefined);
  sessions.set('a', session);
  assert.equal(await sessions.destroyAfter('a', async s => { assert.equal(s, session); }), true);
  assert.deepEqual(events, ['A', ['a', 'A', 'delete']]);
  assert.equal(await sessions.destroyAfter('missing', () => assert.fail('must not call action')), false);
});

test('activity contract preserves typed presentation and running-only completion accounting', async () => {
  const { BridgeActivityTracker } = await import('../reconstructed/bridge-core/src/bridge-activity-tracker.js');
  const tracker = new BridgeActivityTracker(3, () => 'fixture-time');
  assert.equal(tracker.snapshot().stats.lastTool, undefined);
  const id = tracker.push({ tool: 'read_files', status: 'running', presentation: { title: 'Read' } });
  tracker.push({ tool: 'progress', status: 'progress', percent: 50 });
  assert.equal(tracker.snapshot().stats.toolCalls, 1);
  assert.equal(tracker.clear(), 1);
  assert.equal(tracker.finish(id, 'completed', 12), true);
  assert.equal(tracker.snapshot().activities[0].presentation.title, 'Read');
  assert.equal(tracker.finish(id, 'error', 99), true);
  assert.equal(tracker.snapshot().stats.completedToolCalls, 1);
  assert.equal(tracker.snapshot().stats.failedToolCalls, 0);
  assert.equal(tracker.finish(999, 'completed', 1), false);
  assert.equal(tracker.reset(), true);
  assert.equal(tracker.reset(), false);
});

test('event contract replays only the cursor stream, awaits send and propagates rejection', async () => {
  const { BoundedInMemoryEventStore } = await import('../reconstructed/bridge-core/src/bridge-event-store.js');
  const store = new BoundedInMemoryEventStore(3);
  const first = await store.storeEvent('A', { jsonrpc: '2.0', method: 'ping', id: 1 });
  await store.storeEvent('B', { jsonrpc: '2.0', method: 'ping', id: 2 });
  const message = { jsonrpc: '2.0', method: 'ping', id: 3 };
  const third = await store.storeEvent('A', message);
  const sent = [];
  assert.equal(await store.replayEventsAfter(first, { send: async (id, msg) => { await Promise.resolve(); sent.push([id, msg]); } }), 'A');
  assert.deepEqual(sent, [[third, message]]);
  await assert.rejects(store.replayEventsAfter(first, { send: async () => { throw new Error('fixture-send-failed'); } }), /fixture-send-failed/);
  await store.storeEvent('A', { jsonrpc: '2.0', method: 'ping', id: 4 });
  assert.equal(await store.replayEventsAfter(first, { send: async () => assert.fail('evicted cursor must not replay') }), '');
});

test('raw HTTP router forwards array headers: declarations must not claim normalization', async () => {
  const { EventEmitter } = await import('node:events');
  const { createBridgeHttpRoutes, handleBridgeHttpRequest } = await import('../reconstructed/bridge-core/src/bridge-http-router.js');
  const options = { routes: createBridgeHttpRoutes('fixture-token'), maxRequestBytes: 128, standaloneGetEnabled: true };
  for (const method of ['POST', 'GET', 'DELETE']) {
    const request = new EventEmitter();
    Object.assign(request, { method, url: '/mcp/fixture-token', headers: { 'mcp-session-id': ['A', 'B'], 'mcp-protocol-version': ['one', 'two'] } });
    const response = { setHeader() {}, writeHead() { return this; }, end() {} };
    const calls = [];
    const handlers = { getSessionCount: () => 0,
      handlePost: async (_req, _res, body, sessionId, protocol) => calls.push({ body, sessionId, protocol }),
      handleGet: async (_req, _res, sessionId) => calls.push({ sessionId }),
      handleDelete: async (_req, _res, sessionId) => calls.push({ sessionId }) };
    const pending = handleBridgeHttpRequest(options, handlers, request, response);
    if (method === 'POST') { request.emit('data', Buffer.from('{"fixture":true}')); request.emit('end'); }
    await pending;
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].sessionId, ['A', 'B']);
    if (method === 'POST') { assert.deepEqual(calls[0].body, {fixture: true}); assert.deepEqual(calls[0].protocol, ['one', 'two']); }
  }
});

test('CustomTool discovery and Skill diagnosis preserve absence, failure and sidecar state', async t => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const { loadCustomTools, findCustomTool, toStatusEntries } = await import('../reconstructed/bridge-core/src/custom-tools.js');
  const { diagnoseSkillTools } = await import('../reconstructed/bridge-core/src/custom-tool-skill.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'shuncode-contract-skill-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const dir = path.join(root, '.shuncode/mcp-tools');
  await mkdir(path.join(dir, 'good-skill'), {recursive: true});
  await mkdir(path.join(dir, 'bad-skill'));
  const description = 'A synthetic Skill description for validating loader contracts without executing any scripts or accessing external services.';
  await writeFile(path.join(dir, 'good-skill/SKILL.md'), `---\nname: good-skill\ndescription: ${description}\n---\nFixture instructions.`);
  await writeFile(path.join(dir, 'good-skill/run.mjs'), 'throw new Error("THIS FIXTURE MUST NOT EXECUTE");');
  await writeFile(path.join(dir, 'good-skill/skill-tool.json'), '{"enabled":false}');
  await writeFile(path.join(dir, 'invalid.json'), '{');
  const logs = [];
  const tools = loadCustomTools([root], text => logs.push(text));
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'good_skill');
  assert.equal(tools[0].enabled, false);
  assert.equal(findCustomTool([root], 'good_skill'), undefined);
  assert.equal(toStatusEntries(tools)[0].source, 'skill');
  assert.ok(logs.every(x => typeof x === 'string'));
  assert.ok(logs.some(x => x.includes('invalid JSON')));
  const diagnoses = diagnoseSkillTools(root);
  assert.deepEqual(diagnoses.find(x => x.loaded), {dirName: 'good-skill', loaded: true, name: 'good_skill'});
  const failed = diagnoses.find(x => !x.loaded);
  assert.equal(failed.reasonCode, 'no-skill-md');
  assert.equal(failed.fix, 'open-folder');
  assert.equal(failed.name, undefined);
  assert.ok(diagnoseSkillTools(root, undefined, {skillsEnabled: false}).every(x => !x.loaded && x.reasonCode === 'skills-disabled'));
});

test('Skill import and runner contract distinguish generated, existing and renamed outcomes', async t => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const { importSkill, generateSkillRunner } = await import('../reconstructed/bridge-core/src/custom-tool-skill-import.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'shuncode-contract-import-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  await mkdir(source); await mkdir(target);
  await writeFile(path.join(source, 'SKILL.md'), '---\nname: import-fixture\n---\nSynthetic instructions only.');
  const first = importSkill(target, source);
  assert.equal(first.generatedRunner, true);
  assert.equal(first.renamedFrom, undefined);
  const existing = generateSkillRunner(target, first.name);
  assert.equal(existing.generated, false);
  assert.equal(Object.hasOwn(existing, 'runnerRel'), false);
  await rm(path.join(first.directory, 'scripts/run.mjs'));
  const generated = generateSkillRunner(target, first.name);
  assert.equal(generated.generated, true);
  assert.equal(generated.runnerRel, 'scripts/run.mjs');
  await writeFile(path.join(source, 'run.mjs'), 'throw new Error("MUST NOT EXECUTE");');
  const second = importSkill(target, source);
  assert.equal(second.name, 'import-fixture-2');
  assert.equal(second.renamedFrom, 'import-fixture');
  assert.equal(second.generatedRunner, undefined);
  assert.throws(() => importSkill(target, path.join(root, 'missing')));
});

test('executor accepts but ignores caller log option; pre-abort result remains nullable and no child runs', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const { executeCustomTool } = await import('../reconstructed/bridge-core/src/custom-tools.js');
  const { resolveBridgeToolName } = await import('../reconstructed/bridge-core/src/bridge-tool-name.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'shuncode-contract-abort-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  let logs = 0;
  const controller = new AbortController(); controller.abort();
  const result = await executeCustomTool([root], {
    name: 'aborted_fixture', title: 'Fixture', description: 'Only a synthetic contract fixture.',
    command: ['node', '-e', 'throw new Error("MUST NOT RUN")'],
    inputSchema: {type: 'object'}, timeoutMs: 1000, enabled: true, sourcePath: 'fixture.json'
  }, {}, {signal: controller.signal, log: () => logs++});
  assert.equal(result.structuredContent.exit_code, null);
  assert.equal(result.structuredContent.aborted, true);
  assert.equal(result.isError, true);
  assert.equal(logs, 0);
  assert.equal(resolveBridgeToolName(' mcp__fixture__tool ', name => name === 'tool'), 'tool');
  assert.equal(resolveBridgeToolName(' unknown ', () => false), 'unknown');
});
