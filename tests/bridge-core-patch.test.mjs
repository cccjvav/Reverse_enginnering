import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyPatch, parsePatch, preflight, commitPlans, DEFAULT_APPLY_PATCH_CONFIG, hashBytes, formatApplyPatchForModel } from '../reconstructed/bridge-core/src/apply-patch.js';
import { createCanonicalUnifiedDiff } from '../reconstructed/bridge-core/src/canonical-diff.js';
import { originalBaseline } from './helpers/bridge-core-baseline.mjs';
const baseline=await originalBaseline();
const patch=(...lines)=>['*** Begin Patch',...lines,'*** End Patch'].join('\n');
const update=(file,oldText,newText)=>patch(`*** Update File: ${file}`,'@@',`-${oldText}`,`+${newText}`);
async function fixture(t){
  const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'shuncode-patch-')));
  t.after(()=>fs.rm(base,{recursive:true,force:true,maxRetries:3}));
  const root=path.join(base,'workspace'),outside=path.join(base,'outside');await fs.mkdir(root);await fs.mkdir(outside);
  return {base,root,outside,context:{workspaceRoots:[root]}};
}
const read=(f,name)=>fs.readFile(path.join(f.root,name),'utf8');
const write=(f,name,text)=>fs.writeFile(path.join(f.root,name),text);
const rejectsCode=(promise,code)=>assert.rejects(promise,e=>e.code===code);

test('patch adds a new file with version and an explicit non-transactional result',async t=>{
  const f=await fixture(t),r=await applyPatch({patch:patch('*** Add File: a','+hello')},f.context);
  assert.equal(await read(f,'a'),'hello\n');assert.equal(r.files[0].new_version,hashBytes(Buffer.from('hello\n')));
  assert.equal(r.multi_file_atomic,false);assert.equal(r.commit_strategy,'staged_atomic_per_file');assert.match(formatApplyPatchForModel(r),/files_changed: 1/);
});

test('update preserves BOM, CRLF and final newline convention',async t=>{
  const f=await fixture(t);await write(f,'a','\ufeffold\r\nkeep\r\n');
  await applyPatch({patch:update('a','old','new')},f.context);
  assert.equal(await read(f,'a'),'\ufeffnew\r\nkeep\r\n');
  await write(f,'b','old');await applyPatch({patch:update('b','old','new')},f.context);assert.equal(await read(f,'b'),'new');
});

test('delete and move perform the requested operations without leftover staging files',async t=>{
  const f=await fixture(t);await write(f,'a','one');await write(f,'b','two');
  const r=await applyPatch({patch:patch('*** Delete File: a','*** Update File: b','*** Move to: c')},f.context);
  assert.deepEqual((await fs.readdir(f.root)).sort(),['c']);assert.equal(await read(f,'c'),'two');assert.equal(r.files[1].action,'move');
});

test('stale expected versions reject without changing bytes',async t=>{
  const f=await fixture(t);await write(f,'a','old');
  await rejectsCode(applyPatch({patch:update('a','old','new'),expected_versions:{a:hashBytes(Buffer.from('stale'))}},f.context),'STALE_FILE');
  assert.equal(await read(f,'a'),'old');
  await applyPatch({patch:update('a','old','new'),expected_versions:{a:hashBytes(Buffer.from('old'))}},f.context);assert.equal(await read(f,'a'),'new');
});

test('missing and ambiguous exact contexts reject without editing',async t=>{
  const f=await fixture(t);await write(f,'a','same\nsame\n');
  await rejectsCode(applyPatch({patch:update('a','missing','new')},f.context),'PATCH_CONTEXT_NOT_FOUND');
  await rejectsCode(applyPatch({patch:update('a','same','new')},f.context),'PATCH_CONTEXT_AMBIGUOUS');assert.equal(await read(f,'a'),'same\nsame\n');
});

test('invalid syntax, duplicate operations and configured patch limits fail in preflight',async t=>{
  const f=await fixture(t);
  for(const input of ['invalid',patch('*** Add File: a','+x','*** Add File: a','+y')])await rejectsCode(applyPatch({patch:input},f.context),'INVALID_PATCH');
  await rejectsCode(applyPatch({patch:patch('*** Add File: a','+x')},{...f.context,config:{maxPatchBytes:4}}),'PATCH_TOO_LARGE');
  assert.deepEqual(await fs.readdir(f.root),[]);
});

test('existing destinations are never overwritten by add or move',async t=>{
  const f=await fixture(t);await write(f,'a','A');await write(f,'b','B');
  for(const text of [patch('*** Add File: b','+new'),patch('*** Update File: a','*** Move to: b')])await rejectsCode(applyPatch({patch:text},f.context),'FILE_ALREADY_EXISTS');
  assert.equal(await read(f,'a'),'A');assert.equal(await read(f,'b'),'B');
});

test('static traversal and external directory junctions reject writes',async t=>{
  const f=await fixture(t);await fs.symlink(f.outside,path.join(f.root,'link'),'junction');
  for(const target of ['../outside/a','link/a'])await rejectsCode(applyPatch({patch:patch(`*** Add File: ${target}`,'+never')},f.context),'PATH_OUTSIDE_WORKSPACE');
  assert.deepEqual(await fs.readdir(f.outside),[]);
});

test('permission denial on either preflight and pre-aborted signals prevent changes',async t=>{
  const f=await fixture(t);await write(f,'a','old');
  for(const denyAt of [1,2]){let calls=0;await rejectsCode(applyPatch({patch:update('a','old','new')},{...f.context,checkPermission:()=>++calls!==denyAt}),'PERMISSION_DENIED');assert.equal(await read(f,'a'),'old');}
  const abort=new AbortController();abort.abort();await rejectsCode(applyPatch({patch:update('a','old','new')},{...f.context,signal:abort.signal}),'ABORTED');
});

test('binary, invalid UTF-8 and oversized source files are refused',async t=>{
  const f=await fixture(t);
  for(const [bytes,code,config] of [[Buffer.from([0]),'BINARY_FILE',{}],[Buffer.from([255]),'UNSUPPORTED_ENCODING',{}],[Buffer.from('old'),'FILE_TOO_LARGE',{maxFileBytes:2}]]){
    await write(f,'a',bytes);await rejectsCode(applyPatch({patch:update('a','old','new')},{...f.context,config}),code);assert.deepEqual(await fs.readFile(path.join(f.root,'a')),bytes);
  }
});

test('a late add collision rolls back completed add/update/delete/move operations',async t=>{
  for(const action of ['add','update','delete','move']){
    const f=await fixture(t);await write(f,'a','old');
    const first={add:['*** Add File: new','+created'],update:['*** Update File: a','@@','-old','+new'],delete:['*** Delete File: a'],move:['*** Update File: a','*** Move to: moved']}[action];
    const input={patch:patch(...first,'*** Add File: collision','+planned')};
    const {plans}=await preflight(parsePatch(input.patch,DEFAULT_APPLY_PATCH_CONFIG),input,f.context,DEFAULT_APPLY_PATCH_CONFIG);
    // Controlled failure between planning and commit, not a real external file.
    await write(f,'collision','external fixture');
    await assert.rejects(commitPlans(plans),e=>e.code==='EEXIST');
    assert.equal(await read(f,'a'),'old');assert.equal(await read(f,'collision'),'external fixture');
    assert.deepEqual((await fs.readdir(f.root)).sort(),['a','collision']);
  }
});

test('concurrent same-source patches with the same expected version do not both succeed',async t=>{
  const f=await fixture(t);await write(f,'a','old');const expected_versions={a:hashBytes(Buffer.from('old'))};
  const result=await Promise.allSettled(['first','second'].map(value=>applyPatch({patch:update('a','old',value),expected_versions},f.context)));
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.code,'STALE_FILE');
  assert.ok(['first','second'].includes(await read(f,'a')));
});

test('diff output limits do not truncate the actual applied content',async t=>{
  const f=await fixture(t);await write(f,'a','old');const text='x'.repeat(100);
  const r=await applyPatch({patch:update('a','old',text)},{...f.context,config:{maxDiffBytes:10}});
  assert.equal(await read(f,'a'),text);assert.equal(r.diff_truncated,true);
});

test('original CJS and reconstructed ESM agree on actual patch results and bytes',async t=>{
  const f=await fixture(t),g=await fixture(t);await write(f,'a','old\n');await write(g,'a','old\n');
  const input={patch:patch('*** Update File: a','@@','-old','+new','*** Add File: b','+second')};
  const actual=await applyPatch(input,f.context),expected=await baseline.applyPatch(input,g.context);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected)));
  for(const name of ['a','b'])assert.equal(await read(f,name),await read(g,name));
});

test('KNOWN SNAPSHOT LIMIT: displayed diff omits a final-newline-only change',()=>{
  const diff=createCanonicalUnifiedDiff([{action:'update',old_path:'a',new_path:'a',old_bytes:Buffer.from('same'),new_bytes:Buffer.from('same\n')}]);
  assert.match(diff,/--- a\/a/);assert.doesNotMatch(diff,/@@/);
});

test('KNOWN SNAPSHOT RISK: directory substitution during locked preflight redirects an add outside',async t=>{
  // Reproduce only with self-created temporary directories, never user data.
  for(const writer of [applyPatch,baseline.applyPatch]){
    const f=await fixture(t),slot=path.join(f.root,'slot');await fs.mkdir(slot);let approvals=0;
    const result=await writer({patch:patch('*** Add File: slot/new','+OUTSIDE_FIXTURE_SENTINEL')},{...f.context,checkPermission:async()=>{
      if(++approvals===2){await fs.rename(slot,path.join(f.root,'saved'));await fs.symlink(f.outside,slot,'junction');}return true;
    }});
    assert.equal(result.status,'success');assert.equal(await fs.readFile(path.join(f.outside,'new'),'utf8'),'OUTSIDE_FIXTURE_SENTINEL\n');
    assert.deepEqual(await fs.readdir(path.join(f.root,'saved')),[]);
  }
});
