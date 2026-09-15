import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import http from 'node:http';
import ts from 'typescript';
import {ROOT, hash} from '../tools/patch_utils.mjs';
import {buildLinkedExtension} from '../tools/build_linked_extension.mjs';
import {diagnoseTypes} from '../tools/diagnose_linked_types.mjs';

const {code,report}=await buildLinkedExtension({httpMaintenance:true});

test('HTTP variant actually resolves the preserved transport to reviewed adapter and keeps old bundle separate',async()=>{
  const stored=JSON.parse(await readFile(path.join(ROOT,'docs/evidence/http-linked-extension.json'),'utf8'));
  assert.deepEqual(report,stored);
  assert.equal(report.summary.inputs,74);
  assert.equal(report.summary.sharedResolutions,31);
  assert.equal(report.sourceIntegrated,true);assert.equal(report.runtimeActivationVerified,false);
  assert.ok(report.sharedResolutions.some(r=>r.importer.endsWith('bridge-mcp-transport.ts') && r.linkedTo==='community/bridge-core/http-router.mjs'));
  assert.ok(report.inputs.some(i=>i.source==='community/bridge-core/http-router.mjs'));
  assert.match(code,/Ambiguous MCP protocol header/);
  const baseline=JSON.parse(await readFile(path.join(ROOT,'docs/evidence/linked-extension.json'),'utf8'));
  assert.notEqual(report.output,baseline.output);assert.notEqual(hash(code),baseline.outputSha256);
  assert.equal(report.extensionLoaded,false);assert.equal(report.installerBuilt,false);
  await assert.rejects(buildLinkedExtension({transportOnly:true}),/requires HTTP maintenance mode/);
});

test('HTTP type mode removes only the three repaired boundary diagnostics, not host errors',async()=>{
  const actual=await diagnoseTypes({httpMaintenance:true});
  const stored=JSON.parse(await readFile(path.join(ROOT,'docs/evidence/http-type-diagnostics.json'),'utf8'));
  assert.deepEqual(actual,stored);assert.equal(actual.errorCount,11);
  assert.equal(actual.candidateTypecheckPassed,false);
  assert.ok(actual.diagnostics.every(d=>d.source.endsWith('/tool-presentation.ts')));
});

test('adapter JS body and declarations typecheck strictly against the raw boundary without casts',async()=>{
  const options={strict:true,noEmit:true,allowJs:true,checkJs:true,skipLibCheck:false,
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,
    types:['node'],typeRoots:[path.join(ROOT,'node_modules/@types')]};
  const host=ts.createCompilerHost(options);
  host.resolveModuleNames=(names,containing)=>names.map(name=>{
    if(name==='../../reconstructed/bridge-core/src/bridge-http-router.js') return {
      resolvedFileName:path.join(ROOT,'reconstructed/type-contracts/bridge-http-router.d.ts'),extension:ts.Extension.Dts};
    return ts.resolveModuleName(name,containing,options,host).resolvedModule;
  });
  const program=ts.createProgram(['community/bridge-core/http-router.mjs','community/bridge-core/http-router.d.mts'].map(f=>path.join(ROOT,f)),options,host);
  const diagnostics=ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[]);
});

function request(port,route,method,headers={},body) {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers:{accept:'application/json, text/event-stream',...headers}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>{
        try{resolve({status:res.statusCode,headers:res.headers,body:text?JSON.parse(text):null});}catch(error){reject(error);}
      });
    });
    req.setTimeout(10000,()=>req.destroy(new Error('Local transport test timeout')));
    req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
}

test('preserved transport with real candidate SDK initializes, lists and tears down local sessions through adapter',async t=>{
  const built=await buildLinkedExtension({httpMaintenance:true,transportOnly:true});
  assert.ok(!built.report.externalImports.includes('vscode'));
  const out=path.join(ROOT,built.report.output);await mkdir(path.dirname(out),{recursive:true});await writeFile(out,built.code);
  const {BridgeMcpTransport}=createRequire(import.meta.url)(out);
  const dispatched=[],began=[],ended=[];let server;
  const transport=new BridgeMcpTransport({
    dispatchToolCall:async(name,args,extra)=>{dispatched.push({name,args,owner:extra.commandOwnerId});return {content:[{type:'text',text:'INERT_FIXTURE_NO_FILE_ACCESS'}]};},
    beginRemoteConversation:owner=>began.push(owner),endRemoteConversation:owner=>ended.push(owner),releaseCommandOwner:()=>{},
    log:()=>{},diag:()=>{},createTimer:()=>({clear(){}}),
    createHttpServer:handler=>(server=http.createServer(handler))
  });
  t.after(async()=>{transport.destroySessionsAndStopPruning();server?.closeAllConnections();await transport.closeListener();});
  await transport.start({provider:'cloudflare',routeToken:'fixture-only',namedTunnelLocalPort:0});
  const port=transport.snapshot().localPort;
  const route='/mcp/fixture-only';
  const initialize={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'recovery-inert-fixture',version:'1.0'}}};
  const init=await request(port,route,'POST',{'content-type':'application/json'},initialize);
  assert.equal(init.status,200,JSON.stringify(init.body));
  assert.equal(init.body.result.serverInfo.name,'shuncode-bridge');
  assert.equal(init.body.result.protocolVersion,'2025-11-25');
  const sid=init.headers['mcp-session-id'];assert.equal(typeof sid,'string');
  const headers={'content-type':'application/json','mcp-session-id':sid,'mcp-protocol-version':'2025-11-25'};
  const initialized=await request(port,route,'POST',headers,{jsonrpc:'2.0',method:'notifications/initialized'});
  assert.equal(initialized.status,202);
  const listed=await request(port,route,'POST',headers,{jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.equal(listed.status,200);assert.ok(listed.body.result.tools.some(t=>t.name==='read_files'));
  const call={jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'read_files',arguments:{files:[{path:'fixture-only.txt'}]}}};
  const duplicate=await request(port,route,'POST',{...headers,'mcp-session-id':[sid,'INVALID']},call);
  assert.equal(duplicate.status,400);assert.equal(dispatched.length,0);
  const wrong=await request(port,'/mcp/WRONG','POST',headers,call);
  assert.equal(wrong.status,404);assert.equal(dispatched.length,0);
  const result=await request(port,route,'POST',headers,call);
  assert.equal(result.status,200);assert.equal(result.body.result.content[0].text,'INERT_FIXTURE_NO_FILE_ACCESS');
  assert.equal(dispatched.length,1);assert.equal(dispatched[0].owner,'bridge:'+sid);
  assert.deepEqual(began,['bridge:'+sid]);assert.equal(transport.snapshot().sessions,1);
  const second=await request(port,route,'POST',{'content-type':'application/json'},initialize);
  assert.equal(second.status,200);
  const sid2=second.headers['mcp-session-id'];assert.notEqual(sid2,sid);
  const headers2={...headers,'mcp-session-id':sid2};
  assert.equal((await request(port,route,'POST',headers2,{jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
  assert.equal((await request(port,route,'POST',headers2,call)).status,200);
  assert.equal(dispatched[1].owner,'bridge:'+sid2);assert.equal(transport.snapshot().sessions,2);
  const removed=await request(port,route,'DELETE',headers);assert.ok([200,204].includes(removed.status));
  assert.equal(transport.snapshot().sessions,1);assert.equal(ended.filter(owner=>owner==='bridge:'+sid).length,1);
  const stale=await request(port,route,'POST',headers,call);assert.equal(stale.status,404);assert.equal(dispatched.length,2);
  assert.equal((await request(port,route,'POST',headers2,{jsonrpc:'2.0',id:4,method:'tools/list'})).status,200);
  transport.destroySessionsAndStopPruning();server.closeAllConnections();await transport.closeListener();
  assert.equal(transport.isListening(),false);assert.equal(transport.snapshot().localPort,undefined);
  assert.equal(transport.snapshot().sessions,0);
  const evidence={scope:'Preserved BridgeMcpTransport + HTTP maintenance adapter + locked SDK2.0.0 on loopback; inert dispatch, not real files/models/GUI/tunnels or full extension activation.',
    fixtureBundleSha256:hash(built.code),fixtureInputs:built.report.inputs,
    sdkVersions:built.report.dependencyVersions,protocolVersion:init.body.result.protocolVersion,
    initializePassed:true,toolsListPassed:true,inertToolCallPassed:true,duplicateHeaderRejected:true,wrongRouteTokenRejected:true,
    distinctOwnerScopes:true,deleteAndStaleSessionRejectionPassed:true,otherSessionSurvivesDelete:true,listenerShutdownPassed:true,
    platform:process.platform,node:process.version,realFileToolsInvoked:false,extensionLoaded:false};
  await writeFile(path.join(ROOT,'.work/http-transport-smoke.json'),JSON.stringify(evidence,null,2)+'\n');
});


test('adapter rechecks header type at dispatch instead of relying only on the initial read',async()=>{
  const {handleBridgeHttpRequest,createBridgeHttpRoutes}=await import('../community/bridge-core/http-router.mjs');
  let reads=0,called=0,status;
  const headers={};
  Object.defineProperty(headers,'mcp-session-id',{get:()=>++reads===1?'A':['A','B']});
  const request={url:'/mcp/fixture',method:'GET',headers,rawHeaders:[]};
  const response={headersSent:false,setHeader(){},writeHead(code){status=code;return this;},end(){}};
  const handlers={getSessionCount:()=>0,handlePost:()=>called++,handleGet:()=>called++,handleDelete:()=>called++};
  await handleBridgeHttpRequest({routes:createBridgeHttpRoutes('fixture'),maxRequestBytes:32,standaloneGetEnabled:true},handlers,request,response);
  assert.equal(status,400);assert.equal(called,0);assert.equal(reads,2);
});
