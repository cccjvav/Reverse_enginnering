import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readFiles, formatReadFilesForModel } from '../reconstructed/bridge-core/src/read-files.js';
import { canonicalizeWorkspaceRoots, literalFirstPathSpellings } from '../reconstructed/bridge-core/src/workspace-paths.js';
import { readFiles as communityReadFiles } from '../community/bridge-core/read-files.mjs';
import { ROOT } from '../tools/patch_utils.mjs';
import { originalBaseline } from './helpers/bridge-core-baseline.mjs';

const baseline=await originalBaseline();
const version=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
async function fixture(t){
  const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'shuncode-reader-')));
  t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const root=path.join(base,'workspace'),outside=path.join(base,'workspace-other');
  await fs.mkdir(root);await fs.mkdir(outside);
  return {base,root,outside,context:{workspaceRoots:[root]}};
}
async function one(f,request,options={}){
  return (await readFiles({files:[typeof request==='string'?{path:request}:request]},{...f.context,...options})).files[0];
}
const json=value=>JSON.parse(JSON.stringify(value));

test('workspace roots canonicalize, deduplicate, and skip missing roots without widening scope',async t=>{
  const f=await fixture(t),missing=path.join(f.base,'missing');
  const error=message=>new Error(message);
  assert.deepEqual(await canonicalizeWorkspaceRoots([missing,f.root,f.root],error),[f.root]);
  await assert.rejects(canonicalizeWorkspaceRoots([],error),/No workspace root/);
  await assert.rejects(canonicalizeWorkspaceRoots([missing],error),/No usable workspace root/);
});

test('UTF-8 BOM and CRLF normalize for display; version hashes exact original bytes',async t=>{
  const f=await fixture(t),bytes=Buffer.from('\ufeff第一行\r\nsecond\r\nthird');
  await fs.writeFile(path.join(f.root,'text.txt'),bytes);
  const r=await one(f,'text.txt');assert.equal(r.status,'success');
  assert.equal(r.content,'1: 第一行\n2: second\n3: third');assert.equal(r.total_lines,3);
  assert.equal(r.size_bytes,bytes.length);assert.equal(r.version,version(bytes));
});

test('explicit line ranges preserve full-file versions and continuation metadata',async t=>{
  const f=await fixture(t),text='one\ntwo\nthree\nfour\n';await fs.writeFile(path.join(f.root,'a'),text);
  const r=await one(f,{path:'a',start_line:2,end_line:3});
  assert.equal(r.content,'2: two\n3: three');assert.equal(r.total_lines,4);assert.equal(r.has_more,true);
  assert.equal(r.next_start_line,4);assert.equal(r.truncated,false);assert.equal(r.version,version(text));
});

test('empty files and ranges beyond EOF have no phantom content',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'empty'),'');await fs.writeFile(path.join(f.root,'a'),'one');
  const empty=await one(f,'empty');assert.equal(empty.total_lines,0);assert.equal(empty.version,version(''));assert.equal(empty.end_line,null);
  const past=await one(f,{path:'a',start_line:100});assert.equal(past.content,'');assert.equal(past.total_lines,1);assert.equal(past.has_more,false);
});

test('invalid ranges are per-file errors rather than unbounded reads',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'a'),'one');
  for(const range of [{start_line:0},{end_line:-1},{start_line:1.5},{start_line:3,end_line:2}]){
    const r=await one(f,{path:'a',...range});assert.equal(r.error.code,'INVALID_LINE_RANGE');
  }
});

test('parent traversal, absolute outside paths and sibling-prefix paths are rejected',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.outside,'secret'),'outside fixture');
  for(const requested of ['../workspace-other/secret',path.join(f.outside,'secret')]){
    const r=await one(f,requested);assert.equal(r.error.code,'PATH_OUTSIDE_WORKSPACE');assert.equal(r.content,undefined);
  }
});

test('absolute paths inside a configured workspace still use relative display paths',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'a'),'allowed');
  let checked;const r=await one(f,path.join(f.root,'a'),{checkPermission:p=>{checked=p;return true;}});
  assert.equal(r.status,'success');assert.equal(r.path,'a');assert.equal(checked,path.join(f.root,'a'));
});

test('static directory symlinks/junctions may point inside, but not outside the workspace',async t=>{
  const f=await fixture(t),inside=path.join(f.root,'data');await fs.mkdir(inside);
  await fs.writeFile(path.join(inside,'a'),'inside');await fs.writeFile(path.join(f.outside,'a'),'outside');
  await fs.symlink(inside,path.join(f.root,'in-link'),'junction');
  await fs.symlink(f.outside,path.join(f.root,'out-link'),'junction');
  assert.equal((await one(f,'in-link/a')).content,'1: inside');
  assert.equal((await one(f,'out-link/a')).error.code,'PATH_OUTSIDE_WORKSPACE');
});

test('multiple workspaces keep useful roots when earlier roots are stale or miss the file',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.outside,'a'),'second workspace');
  const r=await one(f,'a',{workspaceRoots:[path.join(f.base,'gone'),f.root,f.outside]});
  assert.equal(r.content,'1: second workspace');
  assert.equal((await one(f,'a',{workspaceRoots:[]})).error.code,'PATH_OUTSIDE_WORKSPACE');
});

test('backslash spelling uses literal-first POSIX behavior and native Windows separators',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.root,'dir'));await fs.writeFile(path.join(f.root,'dir','a'),'separator');
  assert.deepEqual(literalFirstPathSpellings('dir\\a'),['dir\\a','dir/a']);
  if(process.platform!=='win32')await fs.writeFile(path.join(f.root,'dir\\a'),'literal');
  assert.equal((await one(f,'dir\\a')).content,process.platform==='win32'?'1: separator':'1: literal');
  if(process.platform!=='win32'){
    await fs.unlink(path.join(f.root,'dir\\a'));assert.equal((await one(f,'dir\\a')).content,'1: separator');
  }
});

test('directories, missing files, binary data and malformed UTF-8 return distinct errors',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.root,'dir'));
  await fs.writeFile(path.join(f.root,'binary'),Buffer.from([0,1,2]));await fs.writeFile(path.join(f.root,'bad-utf8'),Buffer.from([255,254,255]));
  for(const [name,code] of [['dir','NOT_A_FILE'],['gone','FILE_NOT_FOUND'],['binary','BINARY_FILE'],['bad-utf8','UNSUPPORTED_ENCODING']]){
    assert.equal((await one(f,name)).error.code,code);
  }
});

test('large implicit reads are refused; explicit ranges still hash the whole file',async t=>{
  const f=await fixture(t),text='one\n'+'two\n'.repeat(10);await fs.writeFile(path.join(f.root,'a'),text);
  const options={config:{veryLargeFileBytes:10}};
  assert.equal((await one(f,'a',options)).error.code,'FILE_TOO_LARGE_FOR_IMPLICIT_READ');
  const r=await one(f,{path:'a',end_line:1},options);assert.equal(r.content,'1: one');assert.equal(r.version,version(text));assert.equal(r.very_large_file,true);
});

test('per-file line, byte and token output budgets truncate with a continuation',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'a'),'abc\ndef\n');
  for(const config of [{maxLinesPerFile:1},{maxBytesPerFile:7},{maxEstimatedTokensPerFile:2}]){
    const r=await one(f,'a',{config});assert.equal(r.content,'1: abc');assert.equal(r.truncated,true);assert.equal(r.next_start_line,2);
  }
});

test('long-line display truncation does not imply bounded file scanning or hashing',async t=>{
  const f=await fixture(t),text='x'.repeat(65536);await fs.writeFile(path.join(f.root,'a'),text);
  const r=await one(f,'a',{config:{maxLineChars:8}});
  assert.match(r.content,/xxxxxxxx .*<line truncated>/);assert.deepEqual(r.truncated_line_numbers,[1]);assert.equal(r.version,version(text));
});

test('batch budget omits later output while retaining explicit skipped status',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'a'),'abc');await fs.writeFile(path.join(f.root,'b'),'def');
  const r=await readFiles({files:[{path:'a'},{path:'b'}]},{...f.context,config:{maxTotalBytesPerCall:7}});
  assert.deepEqual(r.summary,{requested:2,succeeded:1,failed:0,skipped:1,truncated:0});
  assert.equal(r.files[1].reason,'BATCH_OUTPUT_BUDGET_EXCEEDED');
});

test('identical requests share one read/permission decision but retain request order',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'a'),'same');let calls=0;
  const r=await readFiles({files:[{path:'a'},{path:'gone'},{path:'a'}]},{...f.context,checkPermission:()=>{calls++;return true;}});
  assert.equal(calls,1);assert.equal(r.files[1].error.code,'FILE_NOT_FOUND');assert.deepEqual(r.files[0],r.files[2]);
});

test('host permission denial prevents returning content',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'a'),'not returned');
  const r=await one(f,'a',{checkPermission:async()=>false});assert.equal(r.error.code,'PERMISSION_DENIED');assert.equal(r.content,undefined);
});

test('cancellation before reading and during permission approval yields ABORTED',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'a'),'cancel me');
  const first=new AbortController();first.abort();assert.equal((await one(f,'a',{signal:first.signal})).error.code,'ABORTED');
  const later=new AbortController();assert.equal((await one(f,'a',{signal:later.signal,checkPermission:()=>{later.abort();return true;}})).error.code,'ABORTED');
});

test('empty and excessive batches are rejected before filesystem work',async t=>{
  const f=await fixture(t);await assert.rejects(readFiles({files:[]},f.context),/at least one file/);
  await assert.rejects(readFiles({files:Array.from({length:21},()=>({path:'a'}))},f.context),/at most 20/);
});

test('file versions change with bytes, including line ending changes',async t=>{
  const f=await fixture(t),p=path.join(f.root,'a');await fs.writeFile(p,'one\n');const a=await one(f,'a');
  await fs.writeFile(p,'one\r\n');const b=await one(f,'a');assert.equal(a.content,b.content);assert.notEqual(a.version,b.version);
});

test('formatter includes version, per-file errors and summary without requiring a host',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'a'),'one');
  const result=await readFiles({files:[{path:'a'},{path:'gone'}]},f.context),text=formatReadFilesForModel(result);
  assert.match(text,/=== READ_FILES BEGIN ===/);assert.ok(text.includes(version('one')));assert.match(text,/error_code: FILE_NOT_FOUND/);assert.match(text,/succeeded: 1/);
});

test('original Node/CJS declarations and ESM wiring agree on real filesystem fixtures',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'a'),'一\r\ntwo\nthree');
  await fs.writeFile(path.join(f.root,'bad'),Buffer.from([255,254]));await fs.writeFile(path.join(f.outside,'secret'),'outside');
  for(const input of [{files:[{path:'a'}]},{files:[{path:'a',start_line:2,end_line:2}]},{files:[{path:'bad'},{path:'gone'},{path:'../workspace-other/secret'}]}]){
    const actual=await readFiles(input,f.context),expected=await baseline.readFiles(input,f.context);
    assert.deepEqual(json(actual),json(expected));assert.equal(formatReadFilesForModel(actual),baseline.formatReadFilesForModel(expected));
  }
});

test('KNOWN SNAPSHOT RISK: replacing a checked directory during approval can escape the workspace',async t=>{
  // All directories/content are disposable fixtures. This CHARACTERIZES a flaw,
  // not a desired safety contract. No real user or repository file is accessed.
  for(const reader of [readFiles,baseline.readFiles]){
    const f=await fixture(t),slot=path.join(f.root,'slot');await fs.mkdir(slot);
    await fs.writeFile(path.join(slot,'a'),'inside fixture');await fs.writeFile(path.join(f.outside,'a'),'OUTSIDE_FIXTURE_SENTINEL');
    const result=await reader({files:[{path:'slot/a'}]},{...f.context,checkPermission:async p=>{
      assert.equal(p,path.join(slot,'a'));
      await fs.rename(slot,path.join(f.root,'saved'));
      await fs.symlink(f.outside,slot,'junction');
      return true;
    }});
    assert.equal(result.files[0].content,'1: OUTSIDE_FIXTURE_SENTINEL');
  }
});


test('community checkpoint refuses an external junction installed during permission approval',async t=>{
  const f=await fixture(t),slot=path.join(f.root,'slot');await fs.mkdir(slot);
  await fs.writeFile(path.join(slot,'a'),'inside');await fs.writeFile(path.join(f.outside,'a'),'outside');
  const r=await communityReadFiles({files:[{path:'slot/a'}]},{...f.context,checkPermission:async()=>{
    await fs.rename(slot,path.join(f.root,'saved'));await fs.symlink(f.outside,slot,'junction');return true;
  }});
  assert.equal(r.files[0].error.code,'PATH_OUTSIDE_WORKSPACE');assert.equal(r.files[0].content,undefined);
});

test('community checkpoint requires new approval when a link changes to another internal path',async t=>{
  const f=await fixture(t),slot=path.join(f.root,'slot'),other=path.join(f.root,'other');
  await fs.mkdir(slot);await fs.mkdir(other);await fs.writeFile(path.join(slot,'a'),'approved');await fs.writeFile(path.join(other,'a'),'not approved');
  const r=await communityReadFiles({files:[{path:'slot/a'}]},{...f.context,checkPermission:async()=>{
    await fs.rename(slot,path.join(f.root,'saved'));await fs.symlink(other,slot,'junction');return true;
  }});
  assert.equal(r.files[0].error.code,'PERMISSION_DENIED');assert.equal(r.files[0].content,undefined);
});

test('community checkpoint does not re-trust a workspace root rebound to an external directory',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'a'),'inside');await fs.writeFile(path.join(f.outside,'a'),'outside');
  const r=await communityReadFiles({files:[{path:'a'}]},{...f.context,checkPermission:async()=>{
    await fs.rename(f.root,path.join(f.base,'saved-root'));await fs.symlink(f.outside,f.root,'junction');return true;
  }});
  assert.equal(r.files[0].error.code,'PATH_OUTSIDE_WORKSPACE');assert.equal(r.files[0].content,undefined);
});

test('community checkpoint retains static read/range/version/denial/cancellation behavior',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'a'),'one\ntwo\n');const abort=new AbortController();abort.abort();
  for(const extra of [{},{checkPermission:()=>true},{checkPermission:()=>false},{signal:abort.signal}]){
    const input={files:[{path:'a',start_line:2},{path:'gone'}]},context={...f.context,...extra};
    assert.deepEqual(await communityReadFiles(input,context),await readFiles(input,context));
  }
});

test('community reader changes only documented import wiring and the approval checkpoint',async()=>{
  const snapshot=await fs.readFile(path.join(ROOT,'reconstructed/bridge-core/src/read-files.js'),'utf8');
  const candidate=await fs.readFile(path.join(ROOT,'community/bridge-core/read-files.mjs'),'utf8');
  const insertion=`    // The permission callback may wait for host UI. Recheck the resolved name,
    // against the original root, before proceeding. This is NOT an atomic open.
    const recheckedPath = await (0, import_promises4.realpath)(safePath);
    if (!isInsideRoot3(resolved.root, recheckedPath)) {
      throw new ReadToolError("PATH_OUTSIDE_WORKSPACE", "Path moved outside the approved workspace while awaiting permission.");
    }
    if (recheckedPath !== safePath) {
      throw new ReadToolError("PERMISSION_DENIED", "Resolved path changed while awaiting permission; request approval again.");
    }
`;
  const needle='    const fileStat = await (0, import_promises4.stat)(safePath);';
  assert.equal(candidate.slice(candidate.indexOf('import {')),snapshot.slice(snapshot.indexOf('import {')).replace("from './workspace-paths.js'","from '../../reconstructed/bridge-core/src/workspace-paths.js'").replace(needle,insertion+needle));
});
