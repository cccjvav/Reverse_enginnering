// Shared build/typecheck allowlist; an unrecorded maintenance input is never loaded.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT, hash} from './patch_utils.mjs';
export async function httpMaintenanceInputs() {
  const manifest = JSON.parse(await readFile(path.join(ROOT,'community/bridge-core/http-router.provenance.json'),'utf8'));
  const expectedNames = [
    'community/bridge-core/http-router.mjs',
    'community/bridge-core/http-router.d.mts',
    'community/bridge-core/http-router-types.d.ts'
  ];
  if (JSON.stringify(manifest.files.map(f=>f.source).sort()) !== JSON.stringify(expectedNames.sort())) throw new Error('Unexpected HTTP maintenance inputs');
  for (const file of manifest.files) {
    if (hash(await readFile(path.join(ROOT,file.source))) !== file.sha256) throw new Error('HTTP maintenance integrity mismatch: '+file.source);
  }
  const core=JSON.parse(await readFile(path.join(ROOT,'reconstructed/bridge-core/provenance.json'),'utf8'));
  const original=core.modules.find(m=>m.file==='src/bridge-http-router.js');
  if (manifest.originalSha256 !== original?.sha256 || hash(await readFile(path.join(ROOT,'reconstructed/bridge-core/src/bridge-http-router.js'))) !== manifest.originalSha256) throw new Error('HTTP original router provenance mismatch');
  return manifest;
}
