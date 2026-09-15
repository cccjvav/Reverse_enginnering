// Comparison harness for reviewed declarations ONLY, never the whole extension.
// Node's vm is not being used or advertised as a security sandbox.
import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, hash } from '../../tools/patch_utils.mjs';

export async function originalBaseline() {
  const report=JSON.parse(await readFile(path.join(ROOT,'reconstructed/bridge-core/provenance.json'),'utf8'));
  const original=await readFile(path.join(ROOT,report.origin),'utf8');
  assert.equal(hash(original),report.originSha256);
  const names=new Set(['__create','__defProp','__getOwnPropDesc','__getOwnPropNames','__getProtoOf','__hasOwnProp','__copyProps','__toESM']);
  const ast=parse(original,{ecmaVersion:'latest',sourceType:'script'});
  const helpers=ast.body.filter(n=>n.type==='VariableDeclaration' && n.declarations.length===1 && names.has(n.declarations[0].id.name));
  assert.equal(helpers.length,names.size);
  const declarations=report.modules.flatMap(m=>m.declarations).sort((a,b)=>a.start-b.start);
  const source=declarations.map(d=>{
    const text=original.slice(d.start,d.end);assert.equal(hash(text),d.originalSha256);
    return d.snapshotMetadataAssignment?`const ${d.names[0]} = ${text};`:text;
  }).join('\n');
  const require=createRequire(import.meta.url);
  const allowed=new Set(['node:os','node:crypto','node:fs','node:fs/promises','node:path']);
  return vm.runInNewContext('"use strict";\n'+helpers.map(n=>original.slice(n.start,n.end)).join('\n')+'\n'+source+'\n({'+declarations.flatMap(d=>d.names).join(',')+'})',{
    require:specifier=>{if(specifier==='node:child_process')return {execFile(){throw new Error('Baseline child execution forbidden');},spawnSync(){throw new Error('Baseline child execution forbidden');}};assert.ok(allowed.has(specifier),`Unexpected baseline import: ${specifier}`);return require(specifier);},
    __dirname:path.join(ROOT,"recovered/shuncode-extension/dist"),process,Buffer,TextDecoder,DOMException,Error,TypeError,RangeError,setTimeout,clearTimeout,
  },{timeout:1000});
}
