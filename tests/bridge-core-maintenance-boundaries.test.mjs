import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {invokeAuthorizedFileTool} from '../community/bridge-core/file-tool-dispatcher.mjs';
import {handleBridgeHttpRequest, createBridgeHttpRoutes} from '../community/bridge-core/http-router.mjs';
import {ManagedCommandCanceller} from '../reconstructed/bridge-core/src/managed-command-cancellation.js';

async function files(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shuncode-maintenance-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  await writeFile(path.join(root,'a.txt'), 'alpha\nbeta\n');
  await writeFile(path.join(root,'pixel.gif'), Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'));
  return root;
}
const calls = [
  ['read_files', {files:[{path:'a.txt'}]}],
  ['read_image', {path:'pixel.gif'}],
  ['find_files', {patterns:['*.txt']}],
  ['search_files', {pattern:'alpha'}],
  ['apply_patch', {patch:'*** Begin Patch\n*** Update File: a.txt\n@@\n-alpha\n+CHANGED\n*** End Patch'}]
];

test('maintenance dispatcher fails closed without policy and forwards denial to all five tools', async t => {
  const root = await files(t);
  for (const [name,args] of calls) {
    const missing = await invokeAuthorizedFileTool(name,args,{workspaceRoots:[root]});
    assert.equal(missing.structuredContent.error_code,'PERMISSION_POLICY_REQUIRED');
    let checks=0;
    const denied = await invokeAuthorizedFileTool(name,args,{workspaceRoots:[root],checkPermission:(absolute,tool)=>{
      checks++; assert.equal(tool,name); assert.ok(path.isAbsolute(absolute)); return false;
    }});
    assert.equal(denied.isError,true,name);
    assert.ok(checks>0,name);
    assert.ok(!JSON.stringify(denied).includes('alpha\nbeta'),name);
  }
  assert.equal(await readFile(path.join(root,'a.txt'),'utf8'),'alpha\nbeta\n');
});

test('maintenance dispatcher forwards per-tool budgets and requires literal true, never truthy approval', async t => {
  const root = await files(t);
  const args={files:[{path:'a.txt'}]};
  const context={workspaceRoots:()=>[root],checkPermission:()=>true,configByTool:{read_files:{maxLinesPerFile:1}}};
  const result=await invokeAuthorizedFileTool('read_files',args,context);
  assert.equal(result.isError,undefined);
  assert.equal(result.structuredContent.files[0].content,'1: alpha');
  const invalidApproval=await invokeAuthorizedFileTool('read_files',args,{...context,checkPermission:()=> 'yes'});
  assert.equal(invalidApproval.isError,true);
  const rejected=await invokeAuthorizedFileTool('read_files',args,{...context,checkPermission:async()=>{throw new Error('fixture-denied');}});
  assert.equal(rejected.isError,true);
});

test('maintenance dispatcher retains successful image content and explicit approved patch behavior', async t => {
  const root=await files(t), context={workspaceRoots:[root],checkPermission:()=>true};
  const image=await invokeAuthorizedFileTool('read_image',{path:'pixel.gif'},context);
  assert.equal(image.content[1].type,'image'); assert.equal(image.content[1].mimeType,'image/gif');
  assert.equal(image.structuredContent.base64,undefined);
  const patched=await invokeAuthorizedFileTool(...calls[4],context);
  assert.equal(patched.isError,undefined);
  assert.equal(await readFile(path.join(root,'a.txt'),'utf8'),'CHANGED\nbeta\n');
});

// Test real Node duplicate-header parsing with a loopback-only inert handler. No MCP/GUI or tools.
async function serverFixture(t) {
  let invocations=0;
  const handlers={getSessionCount:()=>0,
    handlePost:async(_req,res)=>{invocations++;res.writeHead(200).end('ok');},
    handleGet:async(_req,res)=>{invocations++;res.writeHead(200).end('ok');},
    handleDelete:async(_req,res)=>{invocations++;res.writeHead(204).end();}};
  const server=http.createServer((req,res)=>void handleBridgeHttpRequest({routes:createBridgeHttpRoutes('fixture'),maxRequestBytes:1024,standaloneGetEnabled:true},handlers,req,res).catch(()=>res.writeHead(500).end()));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return {port:server.address().port, invocations:()=>invocations};
}
function request(port, pathname, headers, method='GET') {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:pathname,method,headers},res=>{
      let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text}));
    });req.on('error',reject);req.end();
  });
}
test('maintenance HTTP adapter rejects duplicate protocol headers before the handler and keeps token routing', async t => {
  const f=await serverFixture(t);
  for(const field of ['mcp-session-id','mcp-protocol-version','mcp-method','mcp-name']){
    const res=await request(f.port,'/mcp/fixture',{[field]:['a','b']});
    assert.equal(res.status,400,field);
    assert.ok(!res.text.includes('"a"'));
  }
  assert.equal(f.invocations(),0);
  assert.equal((await request(f.port,'/mcp/wrong',{'mcp-session-id':['a','b']})).status,404);
  assert.equal((await request(f.port,'/mcp/fixture',{'mcp-session-id':'A'})).status,200);
  assert.equal(f.invocations(),1);
  assert.equal((await request(f.port,'/mcp/fixture',{})).status,400);
});

test('cancellation contract retains owner rejection and high-risk reservation requirement', async()=>{
  let interrupts=0, forced=0;
  const target={id:'fixture',ownerId:'bridge:A',command:'npm install',cwd:'/fixture-only',startedAt:0,
    status:'running',exitCode:null,terminalReusable:true,done:Promise.resolve(),
    requestInterrupt(){interrupts++;return true;},forceClose(){forced++;this.status='killed';}};
  const canceller=new ManagedCommandCanceller({now:()=>1000,waitForGrace:async()=>{}});
  assert.throws(()=>canceller.preview(target,'bridge:B'),/COMMAND_NOT_ACCESSIBLE/);
  assert.equal(interrupts,0);
  assert.equal(canceller.preview(target,'bridge:A').riskLevel,'high');
  await assert.rejects(canceller.cancel(target,{ownerId:'bridge:A',graceMs:1,force:true,forceConfirmed:true}),/FORCE_CONFIRMATION_REQUIRED/);
  assert.equal(forced,0);
  canceller.reserveForcePrompt(target,'bridge:A');
  const result=await canceller.cancel(target,{ownerId:'bridge:A',graceMs:1,force:true,forceConfirmed:true});
  assert.equal(result.status,'killed'); assert.equal(forced,1);
});

test('release gate refuses to equate recovered contracts or a bundle with a complete product', async()=>{
  const {checkReleaseReadiness}=await import('../tools/check_release_readiness.mjs');
  const report=await checkReleaseReadiness();
  assert.equal(report.overall,'NOT_READY');
  assert.equal(report.candidateContractModules,14);
  assert.equal(report.gates.find(g=>g.id==='candidate-types').errors,14);
  assert.equal(report.gates.find(g=>g.id==='source-linkage').status,'PASS');
  for(const id of ['carrier-identity','host-chat-api','native-runtime','authorization-integration','http-integration','real-activation-gui-mcp','source-built-installer']) {
    assert.equal(report.gates.find(g=>g.id===id).status,'BLOCKED',id);
  }
  assert.equal(report.originalInstaller.isNewSourceBuild,false);
  assert.ok(report.observedRuntimeAssets.every(a=>a.candidateRuntimeVerified===false));
});
