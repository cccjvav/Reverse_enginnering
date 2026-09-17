// Static next-work audit. Does not install/activate software or grant permissions.
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {ROOT, hash} from './patch_utils.mjs';
import {verifySource, buildLinkedExtension} from './build_linked_extension.mjs';

function walk(node, visit) { visit(node); ts.forEachChild(node, child=>walk(child,visit)); }
function fields(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) throw new Error('Expected explicit context object; review changed wiring');
  if (node.properties.some(p=>ts.isSpreadAssignment(p))) throw new Error('Spread context requires manual authorization review');
  return node.properties.map(p=>p.name?.getText()).sort();
}
export async function auditAuthorizationWiring() {
  const originals=JSON.parse(await readFile(path.join(ROOT,'docs/evidence/custom-extension.json'),'utf8'));
  const core=JSON.parse(await readFile(path.join(ROOT,'reconstructed/bridge-core/provenance.json'),'utf8'));
  const names=['recovered/shuncode-extension/src/bridge-tool-dispatcher.ts','recovered/shuncode-extension/src/bridge-server.ts','reconstructed/bridge-core/src/file-tool-registry.js'];
  const observations=[],sources=[];
  for(const source of names) {
    const bytes=await readFile(path.join(ROOT,source));
    const expected=source.startsWith('recovered/') ? originals.copied.find(f=>source==='recovered/shuncode-extension/'+f.path)?.sha256 : core.modules.find(f=>source==='reconstructed/bridge-core/'+f.file)?.sha256;
    verifySource(bytes,expected,source);sources.push({source,sha256:hash(bytes)});
    const file=ts.createSourceFile(source,bytes.toString('utf8'),ts.ScriptTarget.Latest,true,source.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
    walk(file,node=>{
      const line=file.getLineAndCharacterOfPosition(node.getStart(file)).line+1;
      if(ts.isInterfaceDeclaration(node) && node.name.text==='ToolDispatcherDeps') observations.push({source,line,kind:'dependency-interface',fields:node.members.map(m=>m.name?.getText()).sort()});
      if(ts.isNewExpression(node) && node.expression.getText()==='BridgeToolDispatcher') observations.push({source,line,kind:'host-constructor',fields:fields(node.arguments?.[0])});
      if(ts.isCallExpression(node) && node.expression.getText()==='invokeFileTool') observations.push({source,line,kind:'file-tool-call',fields:fields(node.arguments[2])});
      if(source.endsWith('/file-tool-registry.js') && ts.isCallExpression(node) && ['readFiles','readImage','findFiles','searchFiles','applyPatch'].includes(node.expression.getText())) {
        observations.push({source,line,kind:'executor-context',executor:node.expression.getText(),fields:fields(node.arguments[1])});
      }
    });
  }
  for(const [kind,count] of [['dependency-interface',1],['host-constructor',1],['file-tool-call',1],['executor-context',5]]) {
    if(observations.filter(o=>o.kind===kind).length!==count) throw new Error('Unexpected authorization call graph shape: '+kind);
  }
  const {report}=await buildLinkedExtension({portableChat:true});
  return {scope:'Hash-verified original AST contexts plus freshly rebuilt portable input graph. Missing field observations are not a complete security audit or a policy implementation.',
    authorizationIntegrationVerified:false,variant:'portable-chat-fallback',bundleSha256:report.outputSha256,sources,observations,
    fileRegistryResolutions:report.sharedResolutions.filter(r=>r.requested==='../../../src/file-tool-registry.js'),
    authorizedDispatcherBundled:report.inputs.some(i=>i.source==='community/bridge-core/file-tool-dispatcher.mjs'),
    nextTask:'P1: bind host-owned, session-scoped permission policy through facade and dispatcher; preserve cancellation/roots and test real fixture file denial before build integration.'};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=await auditAuthorizationWiring();
  if(process.argv.includes('--write')) await writeFile(path.join(ROOT,'docs/evidence/authorization-wiring.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  // This is an audit completion code, NOT an authorization/release PASS.
}
