import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildUiPatch, parseClass, patchUiClass } from '../tools/patch_bridge_ui.mjs';
import { ROOT } from '../tools/patch_utils.mjs';
import { runUiLearningLab } from '../tools/learning_ui_lab.mjs';

const card = await readFile(path.join(ROOT, 'community/ui/access-card.js.txt'), 'utf8');

test('UI parser accepts only a single class expression and never runs static blocks', () => {
  for (const value of [null, undefined, 12, {}]) assert.throws(() => parseClass(value), /must be a string/);
  for (const value of ['({})', '1', '(class {}, class {})', 'class {}); 1; (class {}']) {
    assert.throws(() => parseClass(value), /Expected one UI class expression/);
  }
  const ast = parseClass('class { static { throw new Error("must not execute"); } }');
  assert.equal(ast.type, 'ClassExpression');
});

test('parenthesis compensation preserves UTF-16 method slices after non-BMP characters', () => {
  const code = 'class Demo { first() { return "😀"; } second() { return 2; } }';
  const methods = parseClass(code).body.body;
  assert.equal(code.slice(methods[1].start - 1, methods[1].end - 1), 'second() { return 2; }');
});

test('both hosts reject missing guards, missing cards and reversed card boundaries', async () => {
  for (const variant of ['workbench', 'sessions']) {
    const { original } = await buildUiPatch(variant);
    assert.throws(() => patchUiClass(original.replaceAll('this.lastAccessStatus?.licensed', 'this.lastAccessStatus?.notLicensed'), card), /commercial guards, got 0/);
    assert.throws(() => patchUiClass(original.replace('this.accessCard =', 'this.notAccessCard ='), card), /account card start/);
    const reversed = original.replace('this.accessCard =', 'this.temporaryCard =')
      .replace('this.connectionCard =', 'this.accessCard =').replace('this.temporaryCard =', 'this.connectionCard =');
    assert.throws(() => patchUiClass(reversed, card), /Unexpected UI card order/);
  }
});

test('unknown host names and introduced commercial references are rejected', async () => {
  await assert.rejects(() => buildUiPatch('other-host'), /Unknown UI variant/);
  const { original } = await buildUiPatch();
  assert.throws(() => patchUiClass(original, card + '\n// BRIDGE_PAYMENT_DO_NOT_SHIP'), /Commercial UI reference remains/);
});

test('static UI lesson checks both hosts without instantiating or writing application code', async () => {
  const report = await runUiLearningLab();
  assert.equal(report.staticAnalysisOnly, true);
  assert.equal(report.recoveredClassExecuted, false);
  assert.equal(report.filesWritten, false);
  assert.equal(report.distinctHostInputs, true);
  assert.deepEqual(report.hosts.map(h => h.variant), ['workbench', 'sessions']);
  for (const host of report.hosts) {
    assert.equal(host.preservedMethodCount, 73);
    assert.equal(host.toolRenderingPreserved, true);
    assert.equal(host.tunnelTokenClearingPreserved, true);
    assert.equal(host.paymentMethodRemoved, true);
  }
});
