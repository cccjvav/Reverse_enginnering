import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, applyEdits, allNodes, only } from '../tools/patch_utils.mjs';
import { learningArtifacts, verifyAnnotation } from '../tools/build_learning.mjs';
import { runLearningLab } from '../tools/learning_lab.mjs';
import { parse } from 'acorn';

test('every line of the four explained files is mapped; coverage and lessons are fresh',async()=>{
  const {report,files}=await learningArtifacts();
  assert.equal(report.summary.fullyExplainedFiles,4);assert.equal(report.summary.explainedLines,271);
  assert.equal(report.summary.projectWideExplanationComplete,false);
  assert.ok(report.files.some(f=>f.status==='pending'));
  for(const [file,text] of files)assert.equal(await readFile(path.join(ROOT,'docs/learning',file),'utf8'),text);
});

test('lesson verifier rejects changed source, stale line code and missing explanations',async()=>{
  const data=JSON.parse(await readFile(path.join(ROOT,'docs/learning/annotations.json'),'utf8'));
  const entry=data.files[0],bytes=await readFile(path.join(ROOT,entry.source));
  assert.throws(()=>verifyAnnotation(entry,Buffer.concat([bytes,Buffer.from('// changed') ])),/source changed/);
  const stale=structuredClone(entry);stale.lines[0].code='wrong';assert.throws(()=>verifyAnnotation(stale,bytes),/Stale line/);
  const empty=structuredClone(entry);empty.lines[0].explanation='';assert.throws(()=>verifyAnnotation(empty,bytes),/explanation/);
  const missing=structuredClone(entry);missing.lines.pop();assert.throws(()=>verifyAnnotation(missing,bytes),/Missing line/);
});

test('beginner exercise runs reviewed maintenance code using only a simulated Bridge',async()=>{
  const result=await runLearningLab();assert.equal(result.realBridgeStarted,false);assert.equal(result.simulationOnly,true);
  assert.equal(result.stubStarts,1);assert.equal(result.stubStops,1);assert.equal(result.paymentRejected,true);
  assert.equal(result.edited,'aXdefYj');assert.equal(result.locatedVariable,'price');
});

test('patch utility examples preserve edit input, use UTF-16 offsets and refuse ambiguous selection',()=>{
  const edits=[{start:0,end:1,text:'A'},{start:2,end:3,text:'C'}];const before=structuredClone(edits);
  assert.equal(applyEdits('abc',edits),'AbC');assert.deepEqual(edits,before);
  assert.equal(applyEdits('a😀b',[{start:1,end:3,text:'X'}]),'aXb');
  const nodes=allNodes(parse('const a=1; const b=2;',{ecmaVersion:'latest'}));
  assert.throws(()=>only(nodes,n=>n.type==='VariableDeclarator','declaration'),/got 2/);
  assert.throws(()=>only(nodes,n=>n.type==='NotANode','missing'),/got 0/);
});
