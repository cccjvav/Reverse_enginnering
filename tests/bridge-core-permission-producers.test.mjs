// Locks in the audit finding that reframed P1: in the shipped 0.7.4 nothing
// ever SUPPLIES checkPermission, so the per-file hook never ran.
//
// This is a test about recovered evidence, not about our own code. It exists so
// that if someone later edits the recovered bundles (they must not) or rewrites
// the reconstructed modules, the claim in
// docs/handoff/PROJECT_AUDIT_2026-09-18.md cannot quietly become false while
// the roadmap still cites it.

import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runAudit() {
  const stdout = execFileSync(process.execPath,
    [path.join(repoRoot, 'tools', 'audit_permission_producers.mjs')],
    {encoding: 'utf8', cwd: repoRoot});
  return JSON.parse(stdout);
}

test('no shipped or reconstructed caller ever supplies checkPermission', () => {
  const report = runAudit();
  assert.equal(report.producerTotalAcrossAllFiles, 0,
    'A producer appeared. The P1 framing in the audit and roadmap must be revisited, not the assertion loosened.');
  for (const file of report.files) {
    assert.equal(file.producerTotal, 0, `${file.file} now supplies checkPermission`);
    assert.equal(file.everSupplied, false);
  }
});

test('the audit actually inspected the shipped bundles, not an empty set', () => {
  const report = runAudit();
  // Guards against the audit silently passing because every path was missing.
  const inspected = report.files.map(f => f.file);
  for (const required of [
    'recovered/shuncode-extension/dist/extension.js',
    'recovered/shuncode-extension/runtime/mcp-server.js',
  ]) {
    assert.ok(inspected.includes(required), `${required} was not inspected`);
  }
  const totalOccurrences = report.files.reduce((sum, f) => sum + f.occurrences, 0);
  assert.ok(totalOccurrences > 50,
    `expected many checkPermission occurrences, saw ${totalOccurrences}`);
});

test('every call site is a short-circuiting guard, which is why the hook was inert', () => {
  // The whole finding rests on `context.checkPermission && ...`: if the
  // property is undefined the call is skipped and the path is allowed.
  const shipped = readFileSync(
    path.join(repoRoot, 'recovered/shuncode-extension/runtime/mcp-server.js'), 'utf8');
  const guarded = shipped.match(/context\.checkPermission\s*&&/g) ?? [];
  assert.ok(guarded.length >= 5,
    `expected several guarded call sites, saw ${guarded.length}`);
  // And the dispatcher forwards only roots and signal, never the callback.
  assert.match(shipped, /workspaceRoots: context\.workspaceRoots,\s*\n\s*signal: context\.signal/,
    'dispatchFileTool no longer shows the roots+signal-only context shape');
});
