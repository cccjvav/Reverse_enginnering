import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseManifest } from '../reconstructed/bridge-core/src/custom-tool-manifest.js';
import { CUSTOM_TOOLS_DIR_NAME, LEGACY_SKILLS_DIR_NAME } from '../reconstructed/bridge-core/src/custom-tool-contract.js';
import { loadCustomTools, findCustomTool, customToolsFingerprint } from '../reconstructed/bridge-core/src/custom-tools.js';
import { toggleCustomTool, deleteCustomTool } from '../reconstructed/bridge-core/src/custom-tool-admin.js';
import { migrateLegacySkillDirs } from '../reconstructed/bridge-core/src/custom-tool-migration.js';
import { importSkill, generateSkillRunner, safeArchiveEntry } from '../reconstructed/bridge-core/src/custom-tool-skill-import.js';
import { executeCustomTool } from '../reconstructed/bridge-core/src/custom-tool-sandbox.js';
import { readImage } from '../reconstructed/bridge-core/src/read-image.js';
import { originalBaseline } from './helpers/bridge-core-baseline.mjs';

const description = 'A controlled fixture tool used only in a temporary workspace to test recovered code without external services.';
const manifest = (extra = {}) => ({ name: 'fixture_tool', title: 'Fixture', description, inputSchema: { type: 'object', properties: { value: { type: 'string' } }, additionalProperties: false }, command: ['node', 'fixture.mjs'], ...extra });
async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shuncode custom fixture '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, CUSTOM_TOOLS_DIR_NAME), { recursive: true });
  return root;
}
async function save(root, name, data) {
  const file = path.join(root, CUSTOM_TOOLS_DIR_NAME, name + '.json');
  await writeFile(file, JSON.stringify(data)); return file;
}

test('custom manifest parsing matches isolated original declarations for accepted and rejected cases', async () => {
  const baseline = await originalBaseline();
  for (const value of [null, {}, manifest(), manifest({ name: 'read_files' }), manifest({ command: ['../outside'] }), manifest({ enabled: 'yes' }), manifest({ timeout_ms: 1 }), manifest({ description: 'short' })]) {
    assert.equal(JSON.stringify(parseManifest(value, 'fixture.json')), JSON.stringify(baseline.parseManifest(value, 'fixture.json')));
  }
  assert.equal(parseManifest(manifest(), 'fixture.json').enabled, true);
  assert.equal(parseManifest(manifest({ name: 'read_files' }), 'fixture.json'), undefined);
});

test('manifest discovery keeps first duplicate, filters disabled tools and fingerprints state', async t => {
  const root = await workspace(t);
  await save(root, 'a', manifest()); await save(root, 'b', manifest({ title: 'Duplicate' }));
  await save(root, 'c', manifest({ name: 'disabled_tool', enabled: false }));
  const tools = loadCustomTools([root], undefined, { skillsEnabled: false });
  assert.equal(tools.length, 2); assert.equal(tools.find(x => x.name === 'fixture_tool').title, 'Fixture');
  assert.equal(findCustomTool([root], 'disabled_tool', undefined, { skillsEnabled: false }), undefined);
  assert.equal(customToolsFingerprint(tools), 'disabled_tool:0,fixture_tool:1');
});

test('admin toggle and deletion affect only the temporary selected manifest', async t => {
  const root = await workspace(t); const file = await save(root, 'a', manifest());
  await writeFile(path.join(root, 'keep.txt'), 'keep');
  assert.equal(toggleCustomTool([root], 'fixture_tool').enabled, false);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).enabled, false);
  assert.equal(toggleCustomTool([root], 'fixture_tool').enabled, true);
  assert.equal(deleteCustomTool([root], 'fixture_tool').deleted, file);
  await assert.rejects(access(file)); assert.equal(await readFile(path.join(root, 'keep.txt'), 'utf8'), 'keep');
  assert.throws(() => deleteCustomTool([root], 'unknown'), /Unknown custom tool/);
});

test('legacy migration moves directories, leaves conflicts and is once per process root', async t => {
  const root = await workspace(t); const legacy = path.join(root, LEGACY_SKILLS_DIR_NAME);
  await mkdir(path.join(legacy, 'example'), { recursive: true });
  await writeFile(path.join(legacy, 'example', 'keep.txt'), 'moved');
  await mkdir(path.join(legacy, 'conflict'), { recursive: true });
  await mkdir(path.join(root, CUSTOM_TOOLS_DIR_NAME, 'conflict'), { recursive: true });
  assert.deepEqual(migrateLegacySkillDirs(root), ['example']);
  assert.equal(await readFile(path.join(root, CUSTOM_TOOLS_DIR_NAME, 'example', 'keep.txt'), 'utf8'), 'moved');
  await access(path.join(legacy, 'conflict')); assert.deepEqual(migrateLegacySkillDirs(root), []);
});

test('directory Skill import generates a runner, supports discovery, toggling and deletion', async t => {
  const root = await workspace(t); const source = path.join(root, 'source'); await mkdir(source);
  await writeFile(path.join(source, 'SKILL.md'), `---\nname: fixture-skill\ndescription: ${description}\n---\nSafe fixture instructions.\n`);
  const imported = importSkill(root, source);
  assert.equal(imported.name, 'fixture-skill'); assert.equal(imported.generatedRunner, true);
  assert.equal(generateSkillRunner(root, 'fixture-skill').generated, false);
  const tool = findCustomTool([root], 'fixture_skill'); assert.ok(tool);
  // Runs only the reviewed generated runner over this fixture's plain text.
  const result = await executeCustomTool([root], tool, { input: 'fixture invocation' });
  assert.equal(result.isError, false); assert.match(result.text, /Safe fixture instructions/); assert.match(result.text, /fixture invocation/);
  assert.equal(toggleCustomTool([root], 'fixture_skill').enabled, false);
  assert.equal(findCustomTool([root], 'fixture_skill'), undefined);
  deleteCustomTool([root], 'fixture_skill'); await assert.rejects(access(imported.directory));
  await access(path.join(source, 'SKILL.md'));
});

test('duplicate Skill imports receive distinct directories without replacing the first', async t => {
  const root = await workspace(t); const source = path.join(root, 'source'); await mkdir(source);
  await writeFile(path.join(source, 'SKILL.md'), `---\nname: same-skill\n---\n${description}`);
  const first = importSkill(root, source), second = importSkill(root, source);
  assert.equal(second.name, 'same-skill-2'); assert.equal(second.renamedFrom, 'same-skill');
  await access(first.directory); await access(second.directory);
  // Original importer renames the folder, not the frontmatter tool name: collision remains.
  assert.equal(loadCustomTools([root]).filter(t => t.name === "same_skill").length, 1);
});

test('archive name filter rejects traversal but is not an archive confinement proof', () => {
  for (const entry of ['../outside', 'nested/../../outside', '/absolute', 'C:\\outside', 'nested\\..\\outside']) assert.equal(safeArchiveEntry(entry), false);
  assert.equal(safeArchiveEntry('nested/SKILL.md'), true);
  // No tar.exe extraction or untrusted archive is executed in these tests.
});

test('executor validates arguments and runs only a controlled Node fixture without a shell', async t => {
  const root = await workspace(t);
  await writeFile(path.join(root, 'fixture.mjs'), 'process.stdout.write(JSON.parse(process.env.SHUNCODE_TOOL_ARGS).value);');
  const tool = parseManifest(manifest(), 'fixture.json');
  await assert.rejects(executeCustomTool([root], tool, { bad: true }), /INVALID_ARGUMENT/);
  const result = await executeCustomTool([root], tool, { value: 'literal & shell-looking input' });
  assert.equal(result.structuredContent.exit_code, 0); assert.equal(result.isError, false);
  assert.match(result.text, /literal & shell-looking input/);
  await assert.rejects(executeCustomTool([], tool, {}), /open workspace/);
});

test('pre-aborted execution never runs the fixture command', async t => {
  const root = await workspace(t);
  await writeFile(path.join(root, 'fixture.mjs'), 'throw new Error("must not run");');
  const controller = new AbortController(); controller.abort();
  const result = await executeCustomTool([root], parseManifest(manifest(), 'fixture.json'), {}, { signal: controller.signal });
  assert.equal(result.isError, true); assert.equal(result.structuredContent.aborted, true);
  assert.doesNotMatch(result.text, /must not run/);
});

test('image reader returns bytes, rejects denied permission, cancellation and size limits', async t => {
  const root = await workspace(t); const bytes = Buffer.from('GIF89a\x01\x00\x02\x00', 'binary');
  await writeFile(path.join(root, 'fixture.gif'), bytes);
  const context = { workspaceRoots: [root] };
  const result = await readImage({ path: 'fixture.gif', include_data_uri: false }, context);
  assert.equal(result.status, 'success'); assert.equal(result.width, 1); assert.equal(result.height, 2);
  assert.equal(result.data_uri, undefined); assert.equal(result.base64, bytes.toString('base64'));
  assert.equal((await readImage({ path: 'fixture.gif' }, { ...context, checkPermission: async () => false })).error.code, 'PERMISSION_DENIED');
  assert.equal((await readImage({ path: 'fixture.gif' }, { ...context, config: { maxBytes: 1 } })).error.code, 'FILE_TOO_LARGE');
  const controller = new AbortController(); controller.abort();
  assert.equal((await readImage({ path: 'fixture.gif' }, { ...context, signal: controller.signal })).error.code, 'ABORTED');
});

test('runtime import audit distinguishes existing labels from missing exports and unwired TS', async () => {
  const { auditRuntimeImports } = await import('../tools/audit_extension_runtime.mjs');
  const actual = await auditRuntimeImports();
  const stored = JSON.parse(await readFile(new URL('../docs/evidence/extension-runtime-imports.json', import.meta.url), 'utf8'));
  assert.deepEqual(actual, stored);
  assert.equal(actual.originalTypescriptImportsRewired, false);
  assert.equal(actual.originalTypecheckPassed, false);
  assert.equal(actual.summary.unresolved, 1);
  assert.equal(actual.summary.reexportAdaptersNeeded, 3);
  assert.equal(actual.imports.find(i => i.status === 'unresolved-runtime-export').name, 'invokeFileTool');
});
