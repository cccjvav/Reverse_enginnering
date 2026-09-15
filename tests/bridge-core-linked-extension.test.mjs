import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { ROOT, hash } from '../tools/patch_utils.mjs';
import { buildLinkedExtension, communityEntry, verifySource } from '../tools/build_linked_extension.mjs';
import { diagnoseTypes } from '../tools/diagnose_linked_types.mjs';

const { code, report } = await buildLinkedExtension();

test('source-linked extension bundle is deterministic and does not reuse original dist code', async () => {
  const stored = JSON.parse(await readFile(path.join(ROOT, 'docs/evidence/linked-extension.json'), 'utf8'));
  assert.deepEqual(report, stored);
  assert.equal(hash(code), report.outputSha256);
  assert.equal(report.summary.inputs, 73);
  assert.equal(report.summary.sharedResolutions, 31);
  assert.equal(report.summary.communityPolicyReplacements, 2);
  assert.ok(report.inputs.every(i => !i.source.includes('/dist/')));
  assert.ok(report.inputs.some(i => i.source.endsWith('/src/extension.ts')));
  assert.ok(report.inputs.some(i => i.source.endsWith('/src/file-tool-registry.js')));
  assert.match(code, /function activate\(/);
  assert.match(code, /function deactivate\(/);
});

test('locked npm candidates are bundled but host and native runtime are not falsely claimed', () => {
  const builtins = new Set(builtinModules.flatMap(n => [n, 'node:' + n]));
  assert.ok(report.dependencyInputs.length > 100);
  assert.equal(report.dependencyVersions['@modelcontextprotocol/server'].version, '2.0.0');
  assert.equal(report.dependencyVersions['@modelcontextprotocol/node'].version, '2.0.0');
  assert.equal(report.dependencyVersions['https-proxy-agent'].version, '7.0.6');
  assert.equal(report.dependencyVersions['supports-color'].version, '8.1.1');
  assert.ok(report.externalImports.every(n => n === 'vscode' || builtins.has(n)));
  assert.ok(report.externalImports.includes('vscode'));
  assert.equal(report.extensionLoaded, false); assert.equal(report.installerBuilt, false);
  assert.equal(report.fullTypecheckPassed, false); assert.equal(report.originalSourcesModified, false);
  assert.ok(report.unresolvedRuntimeRequirements.some(s => s.includes('Agent host')));
});

test('linked entry retains community policy and rejects changed source instead of ignoring integrity', async () => {
  const source = await readFile(path.join(ROOT, 'recovered/shuncode-extension/src/extension.ts'), 'utf8');
  assert.doesNotThrow(() => verifySource(Buffer.from(source), hash(source), 'fixture'));
  assert.throws(() => verifySource(Buffer.from(source + '\n'), hash(source), 'fixture'), /integrity mismatch/);
  assert.throws(() => communityEntry('no expected source here'), /entry boundaries/);
  assert.throws(() => communityEntry(source.replace('persistentMode", false, vscode.ConfigurationTarget.Global', 'persistentMode", true, vscode.ConfigurationTarget.Global')), /sign-out source/);
  for (const value of ['SHUNCODE_BRIDGE_LICENSE_SMOKE_BYPASS', 'PAYMENT_POLL_INTERVAL_MS', 'LICENSE_REVALIDATION_INTERVAL_MS', '/v1/payments']) assert.ok(!code.includes(value), value);
  assert.ok(code.includes('community')); assert.ok(code.includes('requireFeature'));
});

test('strict candidate type diagnostics record real failures rather than equating bundling with type safety', async () => {
  const actual = await diagnoseTypes();
  const stored = JSON.parse(await readFile(path.join(ROOT, 'docs/evidence/linked-type-diagnostics.json'), 'utf8'));
  assert.deepEqual(actual, stored);
  assert.equal(actual.sourceFiles, 34); assert.equal(actual.hostDeclarationFiles, 8);
  assert.equal(actual.errorCount, 59); assert.equal(actual.candidateTypecheckPassed, false);
  assert.equal(actual.originalTypesRecovered, false); assert.equal(actual.originalHostIdentityConfirmed, false);
  assert.equal(actual.noEmit, true); assert.equal(actual.strict, true);
  assert.ok(actual.diagnostics.some(d => d.code === 2305 && d.message.includes('CustomToolManifest')));
  assert.ok(actual.diagnostics.some(d => d.code === 2339 && d.message.includes('ChatSimpleToolResultData')));
});
