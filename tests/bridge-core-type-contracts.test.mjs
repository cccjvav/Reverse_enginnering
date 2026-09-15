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

test('candidate contracts remove ten diagnostics without hiding remaining host/type failures', async () => {
  const actual = await diagnoseTypes({ contracts: true });
  const stored = JSON.parse(await readFile(path.join(ROOT, 'docs/evidence/contract-type-diagnostics.json'), 'utf8'));
  assert.deepEqual(actual, stored);
  assert.equal(actual.errorCount, 49);
  assert.equal(actual.contractModules.length, 4);
  assert.equal(actual.candidateTypecheckPassed, false);
  assert.equal(actual.runtimeImplementationCheckedByTypeScript, false);
  assert.equal(actual.originalTypesRecovered, false);
  assert.ok(actual.diagnostics.some(d => d.message.includes('ChatSimpleToolResultData')));
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
