import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from '../tools/patch_utils.mjs';
import {auditAuthorizationWiring} from '../tools/audit_authorization_wiring.mjs';

test('handoff authorization audit preserves the real unwired boundary instead of inferring safety from zero type errors',async()=>{
  const actual=await auditAuthorizationWiring();
  const stored=JSON.parse(await readFile(path.join(ROOT,'docs/evidence/authorization-wiring.json'),'utf8'));
  assert.deepEqual(actual,stored);
  assert.equal(actual.authorizedDispatcherBundled,false);
  assert.equal(actual.authorizationIntegrationVerified,false);
  assert.equal(actual.observations.filter(o=>o.kind==='executor-context').length,5);
  for(const row of actual.observations.filter(o=>['executor-context','file-tool-call'].includes(o.kind))) {
    assert.deepEqual(row.fields,['signal','workspaceRoots']);
  }
  assert.ok(actual.fileRegistryResolutions.some(r=>r.importer.endsWith('bridge-tool-dispatcher.ts') && r.linkedTo==='reconstructed/bridge-core/src/file-tool-registry.js'));
});
