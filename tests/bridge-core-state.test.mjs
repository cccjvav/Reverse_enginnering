import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonRpcRequestIdRegistry, requestIdsOfRequest } from '../reconstructed/bridge-core/src/jsonrpc-request-id-registry.js';
import { BridgeSessionRegistry } from '../reconstructed/bridge-core/src/bridge-session-registry.js';
import { BoundedInMemoryEventStore } from '../reconstructed/bridge-core/src/bridge-event-store.js';
import { BridgeActivityTracker } from '../reconstructed/bridge-core/src/bridge-activity-tracker.js';
import { Semaphore } from '../reconstructed/bridge-core/src/concurrency.js';
import { AdaptiveConcurrencyController } from '../reconstructed/bridge-core/src/adaptive-concurrency.js';
import { ManagedCommandCanceller, bridgeManagedCommandOwnerId } from '../reconstructed/bridge-core/src/managed-command-cancellation.js';
import { createManagedCommandId, normalizeManagedCommandId } from '../reconstructed/bridge-core/src/managed-command-id.js';
import { managedCommandStateIdsToPrune } from '../reconstructed/bridge-core/src/managed-command-retention.js';
import { isManagedTerminalIdleExpired } from '../reconstructed/bridge-core/src/managed-terminal-lifecycle.js';
import { BridgeUsageCounter } from '../reconstructed/bridge-core/src/bridge-usage-counter.js';

test('request IDs distinguish numeric/string forms and batch claims are all-or-nothing',()=>{
  const r=new JsonRpcRequestIdRegistry();
  assert.deepEqual(r.claim([1,'1']),{ok:true});
  assert.equal(r.claim([2,1]).ok,false);
  assert.deepEqual(r.claim([2]),{ok:true});
  assert.equal(r.claim([3,3]).ok,false);
  assert.deepEqual(r.claim([3]),{ok:true});
  r.release([1]);assert.deepEqual(r.claim([1]),{ok:true});
  assert.deepEqual(requestIdsOfRequest([{method:'tools/call',id:1},{method:'notify'},{id:2,result:{}},{method:'ping',id:null}]),[1]);
});

test('session pruning never evicts in-flight requests/streams; idle eviction is observable',async()=>{
  const destroyed=[],closed=[];
  const r=new BridgeSessionRegistry({closeSession:s=>closed.push(s),onSessionDestroyed:(id,_s,reason)=>destroyed.push([id,reason])});
  r.set('request',{activeRequests:1,activeStreams:0,lastActivity:0});
  r.set('stream',{activeRequests:0,activeStreams:1,lastActivity:0});
  r.set('idle',{activeRequests:0,activeStreams:0,lastActivity:0});
  r.prune(1000,100,1);
  assert.equal(r.size,2);assert.equal(r.makeRoom(2),false);
  assert.deepEqual(destroyed,[['idle','idle-prune']]);assert.equal(closed.length,1);
  await assert.rejects(r.destroyAfter('request',async()=>{throw new Error('delete failed');}));
  assert.equal(r.has('request'),true);
  await r.destroyAfter('request',async()=>{});assert.equal(r.has('request'),false);
  r.destroyAll();assert.equal(r.size,0);
});

test('bounded event replay only returns events from the original stream',async()=>{
  const store=new BoundedInMemoryEventStore(3);
  const a=await store.storeEvent('A',{n:1});await store.storeEvent('B',{n:2});
  const last=await store.storeEvent('A',{n:3});const replay=[];
  assert.equal(await store.replayEventsAfter(a,{send:async(id,msg)=>replay.push([id,msg])}),'A');
  assert.deepEqual(replay,[[last,{n:3}]]);
  await store.storeEvent('A',{n:4});
  assert.equal(await store.replayEventsAfter(a,{send:async()=>assert.fail('evicted cursor must not replay')}),'');
});

test('clearing tool history keeps running work and completion statistics consistent',()=>{
  const tracker=new BridgeActivityTracker(10,()=> 'fixture-time');
  tracker.push({tool:'completed',status:'success'});
  const active=tracker.push({tool:'working',status:'running'});
  assert.equal(tracker.clear(),1);
  assert.equal(tracker.snapshot().stats.toolCalls,1);
  assert.equal(tracker.finish(active,'success',120),true);
  assert.equal(tracker.snapshot().stats.completedToolCalls,1);
  assert.equal(tracker.snapshot().stats.averageDurationMs,120);
});

test('semaphore queues, aborts waiters, and releases permits only once',async()=>{
  const s=new Semaphore(1);const release=await s.acquire();const abort=new AbortController();
  const pending=s.acquire(abort.signal);assert.equal(s.waiting,1);
  abort.abort(new Error('cancelled'));await assert.rejects(pending,/cancelled/);assert.equal(s.waiting,0);
  release();release();assert.equal(s.active,0);
  await assert.rejects(s.run(async()=>{throw new Error('work failed');}),/work failed/);assert.equal(s.active,0);
  const held=await s.acquire();const next=s.acquire();s.setLimit(2);const releaseNext=await next;
  assert.equal(s.active,2);held();releaseNext();assert.equal(s.active,0);
});

test('snapshot characterization: shrinking a busy semaphore currently admits a queued waiter too early',async()=>{
  const s=new Semaphore(2),a=await s.acquire(),b=await s.acquire();
  const queued=s.acquire();s.setLimit(1);a();const c=await queued;
  // Preserve and document this pre-existing behavior, NOT a desired safety contract.
  assert.equal(s.active,2);assert.equal(s.limit,1);b();c();
});

test('adaptive limit grows under queued healthy load and shrinks under strain',()=>{
  const c=new AdaptiveConcurrencyController({min:1,max:4,windowSize:2,slowCallMs:100});
  c.record({queued:1,durationMs:1,failed:false});assert.equal(c.record({queued:1,durationMs:1,failed:false}).reason,'grow');
  assert.equal(c.limit,2);c.record({queued:0,durationMs:150,failed:false});assert.equal(c.record({queued:0,durationMs:1,failed:false}).reason,'shrink');
  assert.equal(c.limit,1);
});

function target(ownerId,command='npm install'){
  return {id:'cmd-fixture',ownerId,command,cwd:'fixture',status:'running',startedAt:0,terminalReusable:true,interrupts:0,forced:0,
    requestInterrupt(now){this.interrupts++;this.cancelRequestedAt=now;return true;},
    forceClose(){this.forced++;this.status='killed';this.cancelForced=true;},done:Promise.resolve()};
}
test('command cancellation enforces session owner and host-confirmed high-risk force cancellation',async()=>{
  const c=new ManagedCommandCanceller({now:()=>100,waitForGrace:async()=>{}}),t=target('bridge:A');
  await assert.rejects(c.cancel(t,{ownerId:'bridge:B',graceMs:0,force:true,forceConfirmed:true}),/COMMAND_NOT_ACCESSIBLE/);
  assert.equal(t.interrupts,0);assert.equal(t.forced,0);
  await assert.rejects(c.cancel(t,{ownerId:'bridge:A',graceMs:0,force:true,forceConfirmed:true}),/FORCE_CONFIRMATION_REQUIRED/);
  assert.equal(t.forced,0);
  c.reserveForcePrompt(t,'bridge:A');
  await c.cancel(t,{ownerId:'bridge:A',graceMs:0,force:true,forceConfirmed:true});assert.equal(t.forced,1);
  assert.throws(()=>bridgeManagedCommandOwnerId('  '),/MCP_SESSION_UNAVAILABLE/);
});

test('command IDs use 24 bytes entropy and completed retention never removes running jobs',()=>{
  assert.equal(createManagedCommandId(()=>Buffer.alloc(24,0xab)),'cmd_'+'ab'.repeat(24));
  assert.throws(()=>createManagedCommandId(()=>Buffer.alloc(8)),/exactly 24 bytes/);
  assert.equal(normalizeManagedCommandId('command_id: cmd_'+'ab'.repeat(24)+'\nextra'),'cmd_'+'ab'.repeat(24));
  assert.deepEqual(managedCommandStateIdsToPrune([{id:'running',ownerId:'A',status:'running'},{id:'expired',ownerId:'A',status:'completed',endedAt:0}],3600000),['expired']);
  assert.equal(isManagedTerminalIdleExpired(0,7200000),true);
});

test('usage counter is local accounting, not a licence or billing service',()=>{
  const c=new BridgeUsageCounter();c.recordToolCall();c.recordToolCall();assert.equal(c.take(),2);assert.equal(c.take(),0);
  c.returnCount(2);c.returnCount(NaN);assert.equal(c.take(),2);
});
