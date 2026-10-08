const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { buildSync } = require('esbuild');
// Tests live at extensions/shuncode/test/ on every platform: three levels up is the repo root.
const root = path.resolve(__dirname, '..', '..', '..');
const entry = 'vscode-main/src/vs/workbench/contrib/chat/common/chatService/shunCodeSharedChat.ts';
const code = buildSync({ stdin: { contents: `export { ShunCodeSharedChat } from './${entry}';\nexport { Emitter } from './vscode-main/src/vs/base/common/event.ts';\nexport { observableValue, constObservable } from './vscode-main/src/vs/base/common/observable.ts';\nexport { URI } from './vscode-main/src/vs/base/common/uri.ts';`, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, define: { 'import.meta.url': JSON.stringify(pathToFileURL(__filename).href) } }).outputFiles[0].text;
const mod = { exports: {} };
vm.runInNewContext(code, { module: mod, exports: mod.exports, require, process, Buffer, crypto: require("node:crypto").webcrypto, console, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate, queueMicrotask, performance, AbortController });
const { ShunCodeSharedChat, Emitter, observableValue, constObservable, URI } = mod.exports;

async function fixture(t, enabled = true) {
  const { WorkspaceHubStore, hubChatKey } = await import('../dist/src/workspace-hub-store.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shuncode-adapter-'));
  const scope = { id: createHash('sha256').update('original-project').digest('hex'), name: 'Original project', uri: 'file:///projects/original', kind: 'folder', folders: [] };
  const store = new WorkspaceHubStore(directory, randomUUID(), scope);
  await store.initialize();
  const sessionId = 'chat-adapter';
  const sessionResource = URI.parse(`vscode-chat-session://local/${Buffer.from(sessionId).toString('base64url')}`);
  const modelChanges = new Emitter(), responseChanges = new Emitter(), configChanges = new Emitter();
  const data = { version: 3, sessionId, creationDate: 100, inputState: { text: 'unsent-private-draft' }, pendingRequests: [{ prompt: 'never-replay' }], requests: [{ requestId: 'request-1', message: { text: 'question' }, response: [{ kind: 'markdownContent', content: { value: 'first' } }] }] };
  const model = { sessionResource, isReadOnly: constObservable(false), onDidChange: modelChanges.event, toJSON: () => data, getRequests: () => [{ response: { id: 'response-1', onDidChange: responseChanges.event } }] };
  const models = observableValue('models', [model]);
  const frames = [], calls = [], waiters = [];
  const commands = { async executeCommand(name, frame, importing) {
    calls.push(name);
    if (name.endsWith('.importedKeys')) return [];
    if (name.endsWith('.chatKey')) return hubChatKey(scope.id, frame);
    if (name.endsWith('.beginChat')) return store.beginGeneration(frame);
    if (name.endsWith('.publishChat')) {
      frames.push(frame); const result = await store.publishChat(frame, importing);
      for (const waiter of waiters) if (frame.serialized.includes(waiter.text)) waiter.resolve();
      return result;
    }
    if (name.endsWith('.finishChat')) { frames.push(frame); return store.finishGeneration(frame); }
    if (name.endsWith('.deleteChat')) return store.deleteChat(frame);
    throw new Error('Unexpected command: ' + name);
  } };
  const configuration = { getValue: () => enabled, onDidChangeConfiguration: configChanges.event };
  const sync = new ShunCodeSharedChat(models, { getIndex: async () => ({}), readSession: async () => undefined }, commands, configuration, { warn() {} });
  t.after(async () => { sync.dispose(); modelChanges.dispose(); responseChanges.dispose(); configChanges.dispose(); await store.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  return { sync, model, data, responseChanges, commands, calls, frames, store, key: hubChatKey(scope.id, sessionResource.toString()), waitForText: text => new Promise(resolve => waiters.push({ text, resolve })) };
}

test('native model response events automatically publish streaming updates with the actual URI scheme', { timeout: 10000 }, async t => {
  const h = await fixture(t);
  const generation = await h.sync.begin(h.model);
  const published = h.waitForText('streamed-second-part');
  h.data.requests[0].response[0].content.value = 'streamed-second-part';
  h.responseChanges.fire({});
  await published;
  const read = await h.store.readChat(h.key);
  assert.ok(JSON.stringify(read.data).includes('streamed-second-part'));
  h.data.requests[0].response[0].content.value = 'complete';
  await h.sync.finish(h.model, generation);
  assert.equal((await h.store.readChat(h.key)).active, false);
  assert.ok(h.frames.every(f => !f.serialized.includes('unsent-private-draft') && !f.serialized.includes('never-replay')));
});

test('an unavailable native bridge cannot silently allow model execution', async t => {
  const h = await fixture(t);
  const original = h.commands.executeCommand;
  h.commands.executeCommand = async (...args) => args[0].endsWith('.beginChat') ? undefined : original(...args);
  let invokedAgent = false;
  await assert.rejects((async () => { await h.sync.begin(h.model); invokedAgent = true; })(), /未就绪/);
  assert.equal(invokedAgent, false);
});

test('native deletion creates a shared tombstone instead of leaving a hidden copy', async t => {
  const h = await fixture(t);
  const generation = await h.sync.begin(h.model); await h.sync.finish(h.model, generation);
  await h.sync.remove(h.model.sessionResource);
  assert.equal((await h.store.readChat(h.key)).deleted, true);
  assert.equal((await h.store.readChat(h.key)).data, null);
});

test('native carrier guard precedes context/hooks and continuation only opens the original UI', async () => {
  const source = await fs.readFile(path.join(root, 'vscode-main/src/vs/workbench/contrib/chat/common/chatService/chatServiceImpl.ts'), 'utf8');
  assert.ok(source.indexOf('sharedGeneration = await this.sharedChatSync()?.begin(model)') < source.indexOf('const [hooksResult, instructionEntries'));
  assert.match(source, /finally\s*\{[\s\S]*?finish\(model, sharedGeneration\)/);
  const action = await fs.readFile(path.join(root, 'vscode-main/src/vs/workbench/contrib/chat/browser/actions/shunCodeSharedChatActions.ts'), 'utf8');
  assert.match(action, /prepareContinuation/); assert.match(action, /openSession/);
  assert.doesNotMatch(action, /\.sendRequest\(/);
  const network = await fs.readFile(path.join(root, 'vscode-main/src/vs/base/common/network.ts'), 'utf8');
  assert.match(network, /vscodeLocalChatSession\s*=\s*'vscode-chat-session'/);
});

test('shared reader has restrictive CSP and never inserts transcript HTML or command links', async () => {
  const html = await fs.readFile(path.join(root, 'extensions/shuncode/media/workspace-hub.html'), 'utf8');
  const js = await fs.readFile(path.join(root, 'extensions/shuncode/media/workspace-hub.js'), 'utf8');
  assert.match(html, /default-src 'none'/); assert.match(html, /nonce-/);
  assert.doesNotMatch(js, /innerHTML\s*=|insertAdjacentHTML|eval\(/);
  assert.match(js, /textContent/); assert.match(js, /msg\.key === selected/);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'extensions/shuncode/package.json'), 'utf8'));
  assert.ok(manifest.contributes.commands.some(c => c.command === 'shuncode.workspaceHub.openChats'));
  assert.ok(manifest.contributes.commands.some(c => c.command === 'shuncode.openNewInstance'));
  assert.ok(manifest.contributes.menus['view/title'].some(c => c.command === 'shuncode.workspaceHub.open'));
  assert.equal(manifest.contributes.configuration.properties['shuncode.chat.sharedHistory'].default, true);
  for (const command of ['open', 'openChats', 'beginChat', 'publishChat', 'importedKeys']) {
    assert.ok(manifest.activationEvents.includes(`onCommand:shuncode.workspaceHub.${command}`), command);
  }
});

test('multi-instance carrier: continuation focus is forced across processes and focusWindow exists', async () => {
  const action = await fs.readFile(path.join(root, 'vscode-main/src/vs/workbench/contrib/chat/browser/actions/shunCodeSharedChatActions.ts'), 'utf8');
  assert.match(action, /host\.focus\(mainWindow, \{ mode: FocusMode\.Force \}\)/);
  assert.match(action, /registerCommand\('shuncode\.chat\.focusWindow'/);
  // macOS registers the actions side effect in chat.contribution.ts, Windows in
  // chat.shared.contribution.ts; exactly one of them must carry the import.
  let contribution = '';
  for (const name of ['chat.contribution.ts', 'chat.shared.contribution.ts']) {
    try { contribution += await fs.readFile(path.join(root, 'vscode-main/src/vs/workbench/contrib/chat/browser', name), 'utf8'); } catch {}
  }
  assert.equal((contribution.match(/actions\/shunCodeSharedChatActions\.js';/g) || []).length, 1);
  const service = await fs.readFile(path.join(root, 'vscode-main/src/vs/workbench/contrib/chat/common/chatService/chatServiceImpl.ts'), 'utf8');
  assert.match(service, /private sharedChatSync\(\): ShunCodeSharedChat \| undefined/);
  assert.match(service, /await this\.sharedChatSync\(\)\?\.remove\(sessionResource\);/);
  assert.match(service, /await this\.sharedChatSync\(\)\?\.removeWorkspaceHistory\(\);/);
  assert.equal((service.match(/sharedGeneration = await this\.sharedChatSync\(\)\?\.begin\(model\)/g) || []).length, 2, 'both the agent and the slash-command paths must claim the generation');
});
