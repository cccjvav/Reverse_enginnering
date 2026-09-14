import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createBridgeHttpRoutes, handleBridgeHttpRequest, readJsonBody, writeBridgeJsonRpcError } from '../reconstructed/bridge-core/src/bridge-http-router.js';

// Ephemeral loopback test only: no public tunnel, real tool executor, files or shell.
async function fixture(t,{standaloneGetEnabled=true}={}){
  const calls=[];
  const handlers={getSessionCount:()=>2,
    async handlePost(_req,res,body,sessionId,protocolVersion){calls.push({kind:'post',body,sessionId,protocolVersion});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({accepted:true}));},
    async handleGet(_req,res,session){calls.push({kind:'get',session});res.writeHead(200);res.end('stream stub');},
    async handleDelete(_req,res,session){calls.push({kind:'delete',session});res.writeHead(204);res.end();},
  };
  const server=http.createServer((req,res)=>void handleBridgeHttpRequest({routes:createBridgeHttpRoutes('fixture-secret'),maxRequestBytes:128,standaloneGetEnabled},handlers,req,res).catch(err=>writeBridgeJsonRpcError(res,400,-32700,err.message,null)));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return {base:`http://127.0.0.1:${server.address().port}`,calls};
}

test('wrong or missing route token is rejected before any tool handler',async t=>{
  const {base,calls}=await fixture(t);
  for(const suffix of ['/mcp','/mcp/wrong','/mcp/fixture-secret/extra','/healthz/wrong']){
    const res=await fetch(base+suffix,{headers:{authorization:'Bearer fixture-secret'}});
    assert.equal(res.status,404);assert.equal((await res.json()).error.code,-32004);
  }
  assert.equal(calls.length,0);
});

test('health GET/HEAD does not invoke tools and never returns the secret token',async t=>{
  const {base,calls}=await fixture(t);
  const res=await fetch(base+'/healthz/fixture-secret');assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
  const body=await res.text();assert.ok(!body.includes('fixture-secret'));assert.equal(JSON.parse(body).sessions,2);
  const head=await fetch(base+'/healthz/fixture-secret',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal(calls.length,0);
});

test('valid POST forwards JSON, session and protocol headers; OPTIONS invokes no handler',async t=>{
  const {base,calls}=await fixture(t);
  const preflight=await fetch(base+'/mcp/fixture-secret',{method:'OPTIONS'});assert.equal(preflight.status,204);assert.equal(calls.length,0);
  const body={jsonrpc:'2.0',id:1,method:'ping'};
  const res=await fetch(base+'/mcp/fixture-secret',{method:'POST',headers:{'content-type':'application/json','mcp-session-id':'A','mcp-protocol-version':'2025-11-25'},body:JSON.stringify(body)});
  assert.equal(res.status,200);await res.text();assert.deepEqual(calls,[{kind:'post',body,sessionId:'A',protocolVersion:'2025-11-25'}]);
});

test('GET/DELETE need a session header and unsupported methods fail',async t=>{
  const {base,calls}=await fixture(t);
  for(const method of ['GET','DELETE']){const res=await fetch(base+'/mcp/fixture-secret',{method});assert.equal(res.status,400);await res.text();}
  const put=await fetch(base+'/mcp/fixture-secret',{method:'PUT'});assert.equal(put.status,405);await put.text();
  assert.equal(calls.length,0);
  const del=await fetch(base+'/mcp/fixture-secret',{method:'DELETE',headers:{'mcp-session-id':'A'}});assert.equal(del.status,204);assert.deepEqual(calls,[{kind:'delete',session:'A'}]);
});

test('quick-tunnel mode retains its standalone SSE restriction',async t=>{
  const {base,calls}=await fixture(t,{standaloneGetEnabled:false});
  const res=await fetch(base+'/mcp/fixture-secret',{headers:{'mcp-session-id':'A'}});assert.equal(res.status,405);assert.match(await res.text(),/Standalone SSE is disabled/);assert.equal(calls.length,0);
});

test('body parser rejects malformed and oversized payloads',async()=>{
  const bad=new EventEmitter();const p=readJsonBody(bad,128);bad.emit('data',Buffer.from('{'));bad.emit('end');await assert.rejects(p,/not valid JSON/);
  const huge=new EventEmitter();let destroyed=false;huge.destroy=()=>{destroyed=true;};
  const pending=readJsonBody(huge,4);huge.emit('data','12345');await assert.rejects(pending,/exceeds 4 bytes/);assert.equal(destroyed,true);
});
