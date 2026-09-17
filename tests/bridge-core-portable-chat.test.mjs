import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {ROOT,hash} from '../tools/patch_utils.mjs';
import {buildLinkedExtension} from '../tools/build_linked_extension.mjs';
import {diagnoseTypes} from '../tools/diagnose_linked_types.mjs';
import {portablePresentationSource} from '../tools/portable_presentation_inputs.mjs';

const built=await buildLinkedExtension({portableChat:true});
const fixture=await buildLinkedExtension({portableChat:true,presentationOnly:true});
const module={exports:{}};
vm.runInNewContext(fixture.code,{module,exports:module.exports,require(name){
  // No GUI simulation. Fixtures omit workspaceRoot, so no Uri/Location APIs are invoked.
  assert.equal(name,'vscode'); return Object.freeze({});
}},{timeout:1000});
const present=module.exports.createToolPresentation;

test('portable variant rewrites only the verified formatter and reports fallback rather than restored host cards',async()=>{
  assert.deepEqual(built.report,JSON.parse(await readFile(path.join(ROOT,'docs/evidence/portable-linked-extension.json'),'utf8')));
  assert.equal(built.report.summary.inputs,75);
  assert.equal(built.report.customHostCardsRestored,false);
  assert.equal(built.report.extensionLoaded,false);
  assert.ok(built.report.inputs.some(i=>i.transformation==='portable-public-chat-fallback'));
  assert.ok(built.report.inputs.some(i=>i.source.endsWith('portable-tool-presentation.ts')));
  const original=await readFile(path.join(ROOT,'recovered/shuncode-extension/src/tool-presentation.ts'),'utf8');
  assert.throws(()=>portablePresentationSource(original.replace('    data: {','    unexpected: {')),/boundaries/);
  assert.throws(()=>portablePresentationSource(original.replace('metrics: options.isComplete','metrics: false')),/boundary/);
  assert.notEqual(hash(built.code),JSON.parse(await readFile(path.join(ROOT,'docs/evidence/http-linked-extension.json'),'utf8')).outputSha256);
});

test('portable consumer typecheck reaches zero without augmenting the host namespace',async()=>{
  const report=await diagnoseTypes({portableChat:true});
  assert.deepEqual(report,JSON.parse(await readFile(path.join(ROOT,'docs/evidence/portable-type-diagnostics.json'),'utf8')));
  assert.equal(report.errorCount,0);assert.equal(report.candidateTypecheckPassed,true);
  assert.equal(report.originalHostIdentityConfirmed,false);assert.equal(report.originalTypesRecovered,false);
  assert.equal(report.customHostCardsRestored,false);
});

test('actual transformed formatter returns public fields with file counts and errors, not ignored rich metadata',()=>{
  const result=present({toolName:'find_files',args:{patterns:['*.ts']}},'returned_files: 2\n--- FILES ---\na.ts\nb.ts\n',{isComplete:true,durationMs:120,useShunCodeStyle:true});
  assert.deepEqual(Object.keys(result.data).sort(),['input','output']);
  assert.equal(result.title,'Found 2 files');
  for(const value of ['a.ts','b.ts','Files: 2','120 ms']) assert.ok(result.data.output.includes(value),value);
  const error=present({toolName:'read_files',args:{apiKey:'FIXTURE_SECRET_KEY'}},'password=FIXTURE_SECRET_PASSWORD',{isComplete:true,isError:true});
  assert.equal(error.title,'read_files failed');assert.match(error.data.output,/Status: error/);
  assert.ok(!JSON.stringify(error).includes('FIXTURE_SECRET'));
  const running=present({toolName:'wait',args:{ms:1000}},undefined,{isComplete:false});
  assert.match(running.data.output,/Waiting 1 s/);
});

test('portable formatting preserves textual diff, redacts parsed labels, and bounds large output',()=>{
  const diff='--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new';
  const patch=present({toolName:'apply_patch',args:{patch:'fixture'}},'files_changed: 1\nadditions: 1\ndeletions: 1\n--- CANONICAL APPLIED DIFF ---\n'+diff+'\n=== APPLY_PATCH END ===',{isComplete:true});
  assert.match(patch.data.output,/Diff\n/);assert.ok(patch.data.output.includes('-old\n+new'));
  const secret=present({toolName:'find_files',args:{}},'returned_files: 1\n--- FILES ---\napi_key=FIXTURE_SECRET_VALUE\n',{isComplete:true});
  assert.ok(!secret.data.output.includes('FIXTURE_SECRET_VALUE'));
  const large=present({toolName:'fixture_unknown',args:{}},'fragment! '.repeat(5000),{isComplete:true});
  assert.ok(large.data.output.length<=12000);assert.match(large.data.output,/truncated/);
});

test('local rich contract and portable converter check strictly against pinned public declarations',async()=>{
  const dir=path.join(ROOT,'.work/portable-types');await mkdir(dir,{recursive:true});
  const file=path.join(dir,'fixture.mts');
  await writeFile(file,`
import {toPortableToolResultData,type ShunCodeToolResultData} from '../../community/extension/src/portable-tool-presentation.js';
const rich:ShunCodeToolResultData={input:'',output:'',items:[{label:'file'}],diffPreview:[{path:'a',hunks:[{lines:[{kind:'add',newLine:1,text:'x'}]}]}]};
const data=toPortableToolResultData(rich,'input','output',true);
const output:string=data.output;
// @ts-expect-error no invented public host items
const items=data.items;
// @ts-expect-error metric values must be strings
const invalid:ShunCodeToolResultData={input:'',output:'',metrics:[{label:'n',value:1}]};
// @ts-expect-error add lines require their new-line number
const badLine:NonNullable<ShunCodeToolResultData['diffPreview']>[number]['hunks'][number]['lines'][number]={kind:'add',text:'x'};
`);
  const provenance=JSON.parse(await readFile(path.join(ROOT,'reference/vscode-types/provenance.json'),'utf8'));
  const hostFiles=provenance.files.filter(f=>f.file.endsWith('.d.ts')).map(f=>path.join(ROOT,'reference/vscode-types',f.file));
  const options={strict:true,noEmit:true,skipLibCheck:false,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,types:['node'],typeRoots:[path.join(ROOT,'node_modules/@types')]};
  const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram([file,...hostFiles],options));
  assert.deepEqual(diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[]);
});
