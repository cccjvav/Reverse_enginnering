// Teaching-only simulation. Does not start Bridge, run the original bundle,
// modify an installation, or contact a payment/model/tunnel provider.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { scriptModule } from './build_community.mjs';
import { ROOT, hash, applyEdits, allNodes, only } from './patch_utils.mjs';
export async function runLearningLab(){
  const rejectSideEffect=()=>{throw new Error('Teaching exercise forbids network and timers');};
  const load=async(file,name)=>{
    const source=await readFile(path.join(ROOT,'community/extension/src',file),'utf8');
    // Only our two reviewed maintenance modules are evaluated. Function is not
    // a security sandbox; never substitute unknown downloaded scripts here.
    return new Function('fetch','setTimeout','setInterval',`${scriptModule(source)}; return ${name};`)(rejectSideEffect,rejectSideEffect,rejectSideEffect);
  };
  const Service=await load('bridge-license-service.ts','BridgeLicenseService');
  const Controller=await load('bridge-access-controller.ts','BridgeAccessController');
  const forbiddenStorage=new Proxy({}, {get(){throw new Error('Teaching exercise forbids identity storage');}});
  const service=new Service(forbiddenStorage,forbiddenStorage);
  await service.initialize();const status=await service.getStatus();
  assert.equal(status.available,true);assert.equal(status.signedIn,false);
  await service.requireFeature('bridge');
  await assert.rejects(service.requireFeature('not-a-real-capability'),/Unknown community capability/);
  await assert.rejects(service.createPayment('example-plan','example-type'),/COMMUNITY_PAYMENTS_DISABLED/);
  await assert.rejects(service.redeem('EXAMPLE-NOT-A-REAL-CODE'),/COMMUNITY_PAYMENTS_DISABLED/);
  let starts=0,stops=0;
  const stub={async start(){starts++;return {state:'running'};},async stop(){stops++;return {state:'stopped'};}};
  const controller=new Controller(service,stub);
  await controller.start();await controller.signOut();assert.equal(stops,0);
  await controller.stop();assert.equal(stops,1);
  const edited=applyEdits('abcdefghij',[{start:1,end:3,text:'X'},{start:6,end:9,text:'Y'}]);
  assert.equal(edited,'aXdefYj');
  assert.throws(()=>applyEdits('abcdef',[{start:1,end:4,text:'X'},{start:2,end:5,text:'Y'}]),/Overlapping/);
  const nodes=allNodes(parse('const price = 1;',{ecmaVersion:'latest'}));
  const declaration=only(nodes,n=>n.type==='VariableDeclarator'&&n.id.name==='price','price declaration');
  return {simulationOnly:true,realBridgeStarted:false,edition:status.edition,signedIn:status.signedIn,legacyLicensed:status.licensed,paymentRejected:true,redemptionRejected:true,unknownCapabilityRejected:true,stubStarts:starts,stubStops:stops,edited,locatedVariable:declaration.id.name,sha256OfAbc:hash('abc')};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await runLearningLab(),null,2));
