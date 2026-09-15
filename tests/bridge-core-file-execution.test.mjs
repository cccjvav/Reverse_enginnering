import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { findFiles } from '../reconstructed/bridge-core/src/find-files.js';
import { searchFiles } from '../reconstructed/bridge-core/src/search-files.js';
import { invokeFileTool } from '../reconstructed/bridge-core/src/file-tool-registry.js';
import { rgPath } from '../reconstructed/bridge-core/src/snapshot-packaged-ripgrep.js';
import * as barrel from '../reconstructed/bridge-core/src/custom-tools.js';
import { executeCustomTool } from '../reconstructed/bridge-core/src/custom-tool-sandbox.js';
import { CUSTOM_TOOL_OUTPUT_SCHEMA } from '../reconstructed/bridge-core/src/custom-tool-contract.js';
import { ROOT } from '../tools/patch_utils.mjs';
import { originalBaseline } from './helpers/bridge-core-baseline.mjs';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'shuncode files fixture ')));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  await fs.writeFile(path.join(root, 'a.txt'), 'first\nneedle here\nlast\n');
  await fs.writeFile(path.join(root, 'b.txt'), 'other\n');
  return root;
}

test('packaged ripgrep path relocation is explicit and shared barrel exports retain identity', () => {
  assert.equal(rgPath, path.join(ROOT, 'recovered/shuncode-extension/runtime/bin/rg.exe'));
  assert.equal(barrel.executeCustomTool, executeCustomTool);
  assert.equal(barrel.CUSTOM_TOOL_OUTPUT_SCHEMA, CUSTOM_TOOL_OUTPUT_SCHEMA);
  assert.equal(barrel.CUSTOM_TOOLS_DIR_NAME, '.shuncode/mcp-tools');
});

test('Node find/search engines match isolated original results in a temporary workspace', async t => {
  const root = await fixture(t), baseline = await originalBaseline();
  const context = { workspaceRoots: [root], checkPermission: async () => true };
  for (const [name, fn, input] of [['findFiles', findFiles, { patterns: ['*.txt'] }], ['searchFiles', searchFiles, { pattern: 'needle' }]]) {
    const actual = await fn(input, context), expected = await baseline[name](input, context);
    assert.equal(actual.engine, 'node');
    assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  }
});

test('direct search and find honor permission denial, cancellation and out-of-root scope', async t => {
  const root = await fixture(t);
  for (const [fn, input] of [[findFiles, { patterns: ['*.txt'] }], [searchFiles, { pattern: 'needle' }]]) {
    await assert.rejects(fn(input, { workspaceRoots: [root], checkPermission: async () => false }), e => e.code === 'PERMISSION_DENIED');
    const c = new AbortController(); c.abort();
    await assert.rejects(fn(input, { workspaceRoots: [root], signal: c.signal }), e => e.code === 'ABORTED');
    await assert.rejects(fn({ ...input, path: '..' }, { workspaceRoots: [root] }), e => e.code === 'PATH_OUTSIDE_WORKSPACE');
  }
});

test('dispatcher resolves lazy workspace roots, reads text/images and applies a temporary patch', async t => {
  const root = await fixture(t), context = { workspaceRoots: () => [root] };
  const read = await invokeFileTool('read_files', { files: [{ path: 'a.txt' }] }, context);
  assert.match(read.text, /needle here/); assert.notEqual(read.isError, true);
  await fs.writeFile(path.join(root, 'tiny.gif'), Buffer.from('GIF89a\x01\x00\x02\x00', 'binary'));
  const image = await invokeFileTool('read_image', { path: 'tiny.gif' }, context);
  assert.equal(image.content[1].type, 'image'); assert.equal(image.content[1].mimeType, 'image/gif');
  assert.equal(image.structuredContent.base64, undefined);
  const patch = await invokeFileTool('apply_patch', { patch: '*** Begin Patch\n*** Add File: created.txt\n+fixture\n*** End Patch' }, context);
  assert.notEqual(patch.isError, true); assert.equal(await fs.readFile(path.join(root, 'created.txt'), 'utf8'), 'fixture\n');
});

test('dispatcher formats invalid arguments and unknown tools as errors', async t => {
  const root = await fixture(t);
  for (const [name, args] of [['unknown', {}], ['read_files', { files: [] }], ['find_files', { patterns: [] }]]) {
    const result = await invokeFileTool(name, args, { workspaceRoots: [root] });
    assert.equal(result.isError, true); assert.match(result.text, /status: error/);
  }
});

test('original dispatcher drops permission callback: characterize, do not claim this is safe', async t => {
  const root = await fixture(t); let calls = 0;
  const result = await invokeFileTool('read_files', { files: [{ path: 'a.txt' }] }, { workspaceRoots: [root], checkPermission: async () => { calls++; return false; } });
  assert.equal(calls, 0); assert.match(result.text, /needle here/);
  // The original caller must authorize separately. No real workspace is used here.
});

test('dispatcher find/search fall back to Node when every ripgrep candidate is unavailable', async t => {
  const { default: childProcess } = await import('node:child_process');
  const { syncBuiltinESMExports } = await import('node:module');
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const root = await fixture(t); let attempts = 0;
  const mocked = t.mock.method(childProcess, 'spawn', () => {
    attempts++;
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    queueMicrotask(() => { child.emit('error', Object.assign(new Error('fixture missing executable'), { code: 'ENOENT' })); child.emit('close', -2); child.stdout.destroy(); child.stderr.destroy(); });
    return child;
  });
  syncBuiltinESMExports();
  try {
    const context = { workspaceRoots: [root] };
    const found = await invokeFileTool('find_files', { patterns: ['*.txt'] }, context);
    assert.notEqual(found.isError, true); assert.equal(found.structuredContent.engine, 'node');
    assert.equal(found.structuredContent.summary.returned_files, 2);
    const searched = await invokeFileTool('search_files', { pattern: 'needle' }, context);
    assert.notEqual(searched.isError, true); assert.equal(searched.structuredContent.engine, 'node');
    assert.equal(searched.structuredContent.summary.returned_matches, 1);
    assert.ok(attempts >= 2);
  } finally {
    mocked.mock.restore(); syncBuiltinESMExports();
  }
});
