import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../tools/patch_utils.mjs';
import { auditBoundary, classifyLabel } from '../tools/audit_custom_boundary.mjs';

test('custom boundary inventory is reproducible and all included evidence hashes match',async()=>{
  const actual=await auditBoundary();
  const stored=JSON.parse(await readFile(path.join(ROOT,'docs/evidence/custom-code-boundary.json'),'utf8'));
  assert.deepEqual(actual,stored);
  assert.equal(actual.summary.shippedTypescriptFiles,34);
  assert.equal(actual.summary.sharedLabelsAcrossBundles,43);
  assert.equal(actual.summary.originalMissingTargets,24);
  assert.equal(actual.summary.targetsWithSomeReconstructedJs,19);
  assert.equal(actual.separation.completeCustomPatchset,false);
  assert.ok(actual.missingOriginalTargets.every(t=>t.originalTypescriptImportResolved===false));
});

test('path classification does not label dependencies or unknown carrier files as exclusively custom',()=>{
  assert.equal(classifyLabel('node_modules/example/src/index.js'),'bundled-third-party');
  assert.equal(classifyLabel('extensions/shuncode/src/bridge-server.ts'),'custom-extension-path');
  assert.equal(classifyLabel('src/custom-tools.ts'),'shared-custom-candidate');
  assert.equal(classifyLabel('out/vs/workbench/workbench.desktop.main.js'),'unclassified');
});
