import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ROOT, hash} from '../tools/patch_utils.mjs';

// Actual legacy JS stdio probe, NOT new-source runtime, Electron, GUI or model acceptance.
// Only fixed metadata requests are allowed. Empty home; no inherited secrets or model settings.
test('original Agent host starts and answers metadata over stdio with network and child execution blocked', async t=>{
  const file='runtime/agent-host.js';
  const evidence=JSON.parse(await readFile(path.join(ROOT,'docs/evidence/custom-extension.json'),'utf8'));
  const source=path.join(ROOT,'recovered/shuncode-extension',file);
  assert.equal(hash(await readFile(source)),evidence.copied.find(x=>x.path===file).sha256);
  const root=await mkdtemp(path.join(os.tmpdir(),'shuncode-agent-metadata-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const guard=path.join(root,'guard.cjs');
  await writeFile(guard, `
const blocked = () => { throw new Error('SMOKE_NETWORK_OR_CHILD_EXECUTION_BLOCKED'); };
for (const name of ['node:http','node:https']) { const mod=require(name); mod.request=blocked; mod.get=blocked; }
const net=require('node:net'); net.connect=blocked; net.createConnection=blocked; net.Socket.prototype.connect=blocked; net.Server.prototype.listen=blocked;
require('node:tls').connect=blocked;
require('node:dgram').createSocket=blocked;
const cp=require('node:child_process');
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) cp[name]=blocked;
globalThis.fetch=blocked;
require('node:module').syncBuiltinESMExports();
`);
  const env={HOME:root,USERPROFILE:root,APPDATA:root,LOCALAPPDATA:root,TEMP:root,TMP:root,TZ:'UTC'};
  for(const key of ['SystemRoot','WINDIR','SystemDrive']) if(process.env[key]) env[key]=process.env[key];
  const child=spawn(process.execPath,['--require',guard,source],{cwd:root,env,stdio:['pipe','pipe','pipe'],windowsHide:true});
  const responses=new Map(); let stdout='',stderr='';
  const outcome=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Agent metadata probe timed out'));},15000);
    const fail=error=>{clearTimeout(timer);child.kill();reject(error);};
    child.on('error',fail); child.stdin.on('error',fail);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>65536)fail(new Error('Excessive stderr'));});
    child.stdout.on('data',chunk=>{
      stdout+=chunk;
      if(stdout.length>65536){fail(new Error('Excessive stdout'));return;}
      let newline;
      while((newline=stdout.indexOf('\n'))>=0){
        const line=stdout.slice(0,newline);stdout=stdout.slice(newline+1);
        try{const value=JSON.parse(line);responses.set(value.id,value);}catch(error){fail(error);return;}
      }
      if(responses.size===5)child.stdin.end();
    });
    child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});
    for(const [id,method,params] of [[1,'runtime/hello',{}],[2,'runtime/ping',{}],[3,'tools/list',{}],[4,'agent/cancel',{runId:'nonexistent-fixture'}],[5,'fixture/unknown',{}]]) {
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    }
  });
  assert.equal(outcome.code,0,stderr);
  assert.equal(responses.size,5,stderr);
  assert.match(stderr,/ready protocol=8/);
  assert.equal(responses.get(1).result.name,'shuncode-agent-host');
  assert.equal(responses.get(1).result.protocolVersion,8);
  assert.equal(responses.get(2).result.ok,true);
  assert.deepEqual(responses.get(3).result.tools,responses.get(1).result.tools);
  assert.ok(responses.get(3).result.tools.includes('read_files'));
  assert.deepEqual(responses.get(4).result,{canceled:false,reason:'not_running'});
  assert.equal(responses.get(5).error.code,-32601);
  const out=path.join(ROOT,'.work');await mkdir(out,{recursive:true});
  await writeFile(path.join(out,'agent-metadata-smoke.json'),JSON.stringify({scope:'Legacy original JS metadata only; empty HOME and JS guard. Not an OS sandbox, model run, new source build, extension/Electron or native asset test.',
    source:'recovered/shuncode-extension/'+file,sha256:hash(await readFile(source)),node:process.version,platform:process.platform,
    protocolVersion:8,requests:['runtime/hello','runtime/ping','tools/list','agent/cancel (not running)','unknown method'],passed:true},null,2)+'\n');
});
