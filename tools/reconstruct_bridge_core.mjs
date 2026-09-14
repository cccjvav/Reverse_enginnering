// Recover a dependency-closed subset of self-authored modules. Never run the bundle.
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, hash } from './patch_utils.mjs';

const ORIGINAL = 'recovered/shuncode-extension/dist/extension.js';
export const SEEDS = {
  'read-files': ['readFiles','formatReadFilesForModel'],
  'workspace-paths': ['canonicalizeWorkspaceRoots','literalFirstPathSpellings'],
  'tool-input-validation': ['validateToolInput'],
  'bridge-tool-name': ['resolveBridgeToolName'],
  'bridge-coordination-validation': ['parseBridgeTodos','parseBridgePlan','parseBridgeProgress'],
  'jsonrpc-request-id-registry': ['JsonRpcRequestIdRegistry','requestIdsOfRequest'],
  'bridge-session-registry': ['BridgeSessionRegistry'],
  'bridge-event-store': ['BoundedInMemoryEventStore'],
  'bridge-http-router': ['createBridgeHttpRoutes','handleBridgeHttpRequest','writeBridgeJsonError','writeBridgeJsonRpcError'],
  'mcp-protocol': ['classifyProtocolEra','describeProtocolSupport'],
  'build-info': ['getBuildInfo'],
  'bridge-activity-tracker': ['BridgeActivityTracker'],
  'bridge-usage-counter': ['BridgeUsageCounter'],
  'concurrency': ['Semaphore','mcpConcurrencyLimiter'],
  'adaptive-concurrency': ['AdaptiveConcurrencyController'],
  'managed-command-cancellation': ['ManagedCommandCanceller','NATIVE_MANAGED_COMMAND_OWNER_ID','bridgeManagedCommandOwnerId','forceCancellationRequiresConfirmation','managedCommandNotAccessibleError'],
  'managed-command-id': ['createManagedCommandId','normalizeManagedCommandId'],
  'managed-command-retention': ['managedCommandStateIdsToPrune'],
  'managed-terminal-lifecycle': ['managedTerminalIdleDelay','isManagedTerminalIdleExpired'],
  'file-tool-input-compat': ['normalizeFileToolInput','normalizeFileToolName','isFileToolCompatibilityAlias'],
  'ide-tool-definitions': ['IDE_TOOL_DEFINITIONS','IDE_TOOL_NAMES','BRIDGE_EXCLUDED_TOOL_NAMES','getIdeToolDefinition'],
  // Catalogue and input parsing only, NOT file-operation implementations or dispatcher.
  'file-tool-registry': ['FILE_TOOL_DEFINITIONS','FILE_TOOL_NAMES','isFileToolName','parseApplyPatchInput','parseReadFilesInput','parseReadImageInput','parseFindFilesInput','parseSearchFilesInput'],
};
const GLOBALS = new Set(['Object','Array','String','Number','Boolean','Math','Date','RegExp','JSON','Error','TypeError','RangeError','Set','Map','WeakMap','WeakSet','Promise','Symbol','Reflect','Infinity','NaN','undefined','BigInt','Uint8Array','Buffer','URL','URLSearchParams','AbortController','AbortSignal','DOMException','TextDecoder','setTimeout','clearTimeout','setInterval','clearInterval','queueMicrotask','console','process']);
export function scopeInfo(code) {
  const ast = parse(code,{ecmaVersion:'latest',sourceType:'module',ranges:true});
  const scope = analyze(ast,{ecmaVersion:2022,sourceType:'module',optimistic:false,ignoreEval:false});
  const moduleScope = scope.scopes.find(s=>s.type==='module');
  return {ast,names:moduleScope.variables.map(v=>v.name),free:[...new Set(scope.globalScope.through.map(r=>r.identifier.name))].sort()};
}
export function assertOmittableInitializer(node, owner) {
  const call=node.type==='ExpressionStatement'?node.expression:null;
  if(call?.type==='CallExpression' && call.callee.type==='Identifier' && call.callee.name==='init_define_SHUNCODE_BUILD_INFO' && call.arguments.length===0)return;
  throw new Error(`Unmodeled top-level statement in ${owner}`);
}
function bindingNames(node) {
  if (node.type==='FunctionDeclaration'||node.type==='ClassDeclaration') return node.id ? [node.id.name] : [];
  if(node.type==='VariableDeclaration') return node.declarations.map(d=>d.id.type==='Identifier'?d.id.name:null).filter(Boolean);
  return [];
}
function walk(ast) {
  const result=[],stack=[ast];
  while(stack.length){const n=stack.pop();if(!n?.type)continue;result.push(n);for(const v of Object.values(n)){if(Array.isArray(v)){for(const c of v)if(c?.type)stack.push(c);}else if(v?.type)stack.push(v);}}
  return result;
}
export async function reconstruct({write=true}={}) {
  const original=await readFile(path.join(ROOT,ORIGINAL),'utf8');
  const evidence=JSON.parse(await readFile(path.join(ROOT,'docs/evidence/custom-extension.json'),'utf8'));
  const expected=evidence.copied.find(f=>f.path==='dist/extension.js').sha256;
  if(hash(original)!==expected)throw new Error('Original extension bundle hash mismatch');
  const comments=[];
  const ast=parse(original,{ecmaVersion:'latest',sourceType:'script',ranges:true,onComment:comments});
  const markers=comments.filter(c=>!c.block && /^(src\/|extensions\/|node_modules\/|<define:)/.test(c.value.trim()) && original.slice(original.lastIndexOf('\n',c.start-1)+1,c.start).trim()==='').map(c=>({start:c.start,end:c.end,label:c.value.trim()}));
  const ownerAt=offset=>{let label='<prelude>';for(const m of markers){if(m.start>offset)break;label=m.label;}return label;};
  const entries=[], bindings=new Map();
  for(const node of ast.body){
    const names=bindingNames(node);if(!names.length)continue;
    const entry={node,names,owner:ownerAt(node.start),code:original.slice(node.start,node.end)};
    entries.push(entry);
    for(const name of names){if(bindings.has(name))throw new Error(`Ambiguous top-level binding ${name}`);bindings.set(name,entry);}
  }
  // These two SDK literals are evidence, not new protocol-version claims.
  for(const name of ['SUPPORTED_PROTOCOL_VERSIONS','LATEST_PROTOCOL_VERSION']){
    const e=bindings.get(name);if(!e?.owner.startsWith('node_modules/@modelcontextprotocol/'))throw new Error(`Unexpected SDK binding ${name}`);
    e.owner='snapshot-sdk-versions';
  }
  const injected=walk(ast).filter(n=>n.type==='AssignmentExpression' && n.left.type==='Identifier' && n.left.name==='define_SHUNCODE_BUILD_INFO_default' && n.right.type==='ObjectExpression');
  if(injected.length!==1)throw new Error('Expected one original build metadata assignment');
  const dataNode=injected[0].right;
  bindings.set('define_SHUNCODE_BUILD_INFO_default',{node:dataNode,names:['define_SHUNCODE_BUILD_INFO_default'],owner:'snapshot-build-metadata',code:`const define_SHUNCODE_BUILD_INFO_default = ${original.slice(dataNode.start,dataNode.end)};`,synthetic:true});
  const selected=new Set(), info=new Map();
  function include(entry){
    if(selected.has(entry))return;
    if(markers.some(m=>m.start>entry.node.start&&m.start<entry.node.end))throw new Error(`Source heading inside selected AST declaration: ${entry.names}`);
    selected.add(entry);
    if(!entry.owner.startsWith('src/') && !entry.owner.startsWith('snapshot-'))throw new Error(`Dependency escapes reviewed self-authored code: ${entry.names} in ${entry.owner}`);
    let code=entry.code;
    // Preserve emitted Node import namespace names, but remove the CJS bundler helper.
    const node=entry.node;
    if(node.type==='VariableDeclaration' && node.declarations.length===1){
      const d=node.declarations[0];let call=d.init;
      if(call?.type==='CallExpression' && call.callee.name==='__toESM')call=call.arguments[0];
      if(call?.type==='CallExpression' && call.callee.name==='require'){
        const spec=call.arguments[0]?.value;
        if(typeof spec!=='string'||!spec.startsWith('node:'))throw new Error('Only Node built-in imports are allowed');
        code=`import * as ${d.id.name} from ${JSON.stringify(spec)};`;
      }
    }
    const parsed=scopeInfo(code);
    if(parsed.free.includes('require')||parsed.free.includes('eval'))throw new Error(`Dynamic loader or eval in ${entry.owner}`);
    info.set(entry,{code,...parsed});
    for(const name of parsed.free){
      if(GLOBALS.has(name))continue;
      const dependency=bindings.get(name);
      if(!dependency)throw new Error(`Unresolved ${name} in ${entry.owner}`);
      include(dependency);
    }
  }
  for(const [module,names] of Object.entries(SEEDS))for(const name of names){
    const e=bindings.get(name);if(e?.owner!==`src/${module}.ts`)throw new Error(`Seed ${name} has unexpected owner ${e?.owner}`);include(e);
  }
  const groups=new Map();
  for(const e of selected){if(!groups.has(e.owner))groups.set(e.owner,[]);groups.get(e.owner).push(e);}
  // The reviewed labels omit exactly the injected build-info calls, not arbitrary
  // assignments or other side effects that might initialize their declarations.
  for(const node of ast.body){const owner=ownerAt(node.start);if(groups.has(owner)&&!bindingNames(node).length)assertOmittableInitializer(node,owner);}
  const filename=owner=>owner.startsWith('src/')?owner.slice(4).replace(/\.ts$/,'.js'):owner+'.js';
  const outputRoot=path.join(ROOT,'reconstructed/bridge-core/src');
  const report={scope:'Dependency-closed runnable JavaScript reconstructed from a reviewed subset of shipped declarations. NOT original TypeScript, complete source recovery, or an application rebuild.',origin:ORIGINAL,originSha256:expected,offsetUnits:'UTF-16 string offsets',modules:[],sourceLabelIndex:[]};
  // Index every shared label without copying or running the other modules.
  for(const label of [...new Set(markers.filter(m=>m.label.startsWith('src/')).map(m=>m.label))].sort()){
    const owned=entries.filter(e=>e.owner===label);
    report.sourceLabelIndex.push({label,headingOffsets:markers.filter(m=>m.label===label).map(m=>m.start),declarations:owned.flatMap(e=>e.names),reconstructedBindings:owned.filter(e=>selected.has(e)).flatMap(e=>e.names),externalReferences:scopeInfo(owned.map(e=>e.code).join('\n')).free.filter(n=>!GLOBALS.has(n)).map(name=>({name,owner:name==='require'?'Node/CJS loader':bindings.get(name)?.owner??'UNRESOLVED'}))});
  }
  const files=new Map();
  for(const [owner,group] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
    group.sort((a,b)=>a.node.start-b.node.start);
    const ownNames=new Set(group.flatMap(e=>e.names));
    const imports=new Map();
    for(const e of group)for(const name of info.get(e).free){
      if(GLOBALS.has(name)||ownNames.has(name))continue;
      const dependency=bindings.get(name);
      if(!selected.has(dependency))throw new Error('Dependency closure broken');
      const file=filename(dependency.owner);
      if(!imports.has(file))imports.set(file,new Set());imports.get(file).add(name);
    }
    // Export reconstructed declarations explicitly. This superset is not a claim
    // about the original author's public API; private helpers remain identifiable.
    const exports=[...ownNames].sort();
    const header=`// RECONSTRUCTED from ${owner}; see ../provenance.json.\n// Original function/class bodies retained; ESM wiring was reconstructed.\n`+(owner==='src/file-tool-registry.ts'?'// PARTIAL: catalogue + input parsing ONLY. This module has no file IO or dispatcher.\n':'')+(owner==='src/read-files.ts'?'// SECURITY LIMIT: path checks/open are not atomic; see ../FILE_READER.md.\n':'');
    const importText=[...imports].sort(([a],[b])=>a.localeCompare(b)).map(([file,names])=>`import { ${[...names].sort().join(', ')} } from './${file}';`).join('\n');
    const code=header+importText+'\n\n'+group.map(e=>info.get(e).code).join('\n\n')+'\n\nexport { '+exports.join(', ')+' };\n';
    const unresolved=scopeInfo(code).free.filter(n=>!GLOBALS.has(n));
    if(unresolved.length)throw new Error(`Unresolved final module ${owner}: ${unresolved}`);
    const file=filename(owner);
    if(!/^[a-z0-9][a-z0-9-]*\.js$/.test(file))throw new Error(`Unexpected output name ${file}`);
    files.set(file,code);
    const total=entries.filter(e=>e.owner===owner).length;
    report.modules.push({originLabel:owner,file:'src/'+file,sha256:hash(code),bytes:Buffer.byteLength(code),exports,
      dependencies:[...imports.keys()].sort(),
      coverage:owner.startsWith('snapshot-')?'snapshot metadata/third-party version literals':group.length===total?'all emitted top-level declarations for this label':'selected declaration subset; other functionality not reconstructed',
      declarations:group.map(e=>({names:e.names,start:e.node.start,end:e.node.end,originalSha256:hash(original.slice(e.node.start,e.node.end)),rewiredNodeImport:info.get(e).code!==e.code,snapshotMetadataAssignment:!!e.synthetic}))});
  }
  // Reject cycles rather than silently inheriting CJS/ESM initialization differences.
  const state=new Map();
  function visit(file){if(state.get(file)===1)throw new Error(`ESM initialization cycle: ${file}`);if(state.get(file)===2)return;state.set(file,1);for(const dep of report.modules.find(m=>m.file==='src/'+file).dependencies)visit(dep);state.set(file,2);}
  for(const file of files.keys())visit(file);
  report.moduleCount=files.size;report.declarationCount=selected.size;report.totalBytes=[...files.values()].reduce((n,s)=>n+Buffer.byteLength(s),0);
  report.transformations=['Dependency closure rooted at explicit reviewed exports','Removed per-module build-info initializer calls; extracted original metadata into an explicit dependency','Replaced static Node require/interop imports with Node ESM namespaces','Added ESM imports/exports; no original TS types reconstructed','Refused unresolved bindings, third-party executable module dependencies and cyclic initialization'];
  if(write){
    // Do not silently overwrite manual maintenance changes or leave stale modules.
    let prior;
    try{prior=JSON.parse(await readFile(path.join(ROOT,'reconstructed/bridge-core/provenance.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(prior)for(const m of prior.modules){
      if(!/^src\/[a-z0-9][a-z0-9-]*\.js$/.test(m.file))throw new Error('Invalid prior provenance path');
      if(hash(await readFile(path.join(ROOT,'reconstructed/bridge-core',m.file)))!==m.sha256)throw new Error(`Manual edits found in ${m.file}; preserve them in the maintenance layer before regenerating`);
    }
    let existing=[];try{existing=await readdir(outputRoot);}catch(e){if(e.code!=='ENOENT')throw e;}
    const stale=existing.filter(file=>!files.has(file));if(stale.length)throw new Error(`Untracked/stale output files: ${stale}`);
    if(!prior&&existing.length)throw new Error('Refusing to overwrite files without prior provenance');
    await mkdir(outputRoot,{recursive:true});
    for(const [file,code] of files)await writeFile(path.join(outputRoot,file),code);
    await writeFile(path.join(ROOT,'reconstructed/bridge-core/provenance.json'),JSON.stringify(report,null,2)+'\n');
  }
  return {report,files};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {report}=await reconstruct({write:!process.argv.includes('--check')});
  if(process.argv.includes('--check')){
    for(const m of report.modules){const bytes=await readFile(path.join(ROOT,'reconstructed/bridge-core',m.file));if(hash(bytes)!==m.sha256)throw new Error(`Reconstruction drift: ${m.file}`);}
    const stored=await readFile(path.join(ROOT,'reconstructed/bridge-core/provenance.json'),'utf8');
    if(stored!==JSON.stringify(report,null,2)+'\n')throw new Error('Provenance drift');
    const actual=(await readdir(path.join(ROOT,'reconstructed/bridge-core/src'))).sort();
    if(JSON.stringify(actual)!==JSON.stringify(report.modules.map(m=>m.file.slice(4)).sort()))throw new Error('Unexpected/stale module files');
  }
  console.log(`${report.moduleCount} modules, ${report.declarationCount} declarations, ${report.totalBytes} bytes; dependency closure verified.`);
}
