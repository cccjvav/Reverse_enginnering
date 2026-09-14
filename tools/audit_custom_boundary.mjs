// Evidence-based separation inventory, not an authorship or upstream diff proof.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { ROOT, hash } from './patch_utils.mjs';
const OUTPUT='docs/evidence/custom-code-boundary.json';
const json=async p=>JSON.parse(await readFile(path.join(ROOT,p),'utf8'));
export function classifyLabel(label){
  if(label.startsWith('node_modules/'))return 'bundled-third-party';
  if(label.startsWith('extensions/shuncode/'))return 'custom-extension-path';
  if(label.startsWith('src/'))return 'shared-custom-candidate';
  return 'unclassified';
}
export async function auditBoundary(){
  const evidence=await json('docs/evidence/custom-extension.json');
  const completeness=await json('docs/evidence/source-completeness.json');
  const rebuilt=await json('reconstructed/bridge-core/provenance.json');
  const files=[],bundles=[];
  for(const entry of evidence.copied){
    if(path.posix.isAbsolute(entry.path)||entry.path.split('/').includes('..'))throw new Error('Unsafe evidence path');
    const bytes=await readFile(path.join(ROOT,'recovered/shuncode-extension',entry.path));
    if(hash(bytes)!==entry.sha256)throw new Error(`Original hash mismatch: ${entry.path}`);
    files.push({path:entry.path,bytes:bytes.length,sha256:entry.sha256,role:/\.(?:ts|mts)$/.test(entry.path)?'shipped-typescript-source':/\.(?:js|cjs|mjs)$/.test(entry.path)?'compiled-may-contain-third-party':'extension-resource-or-metadata'});
    if(!/\.(?:js|cjs|mjs)$/.test(entry.path))continue;
    const code=bytes.toString('utf8'),comments=[];
    parse(code,{ecmaVersion:'latest',sourceType:'module',onComment:comments});
    const labels=[...new Set(comments.filter(c=>!c.block && /^(?:src\/|extensions\/|node_modules\/)/.test(c.value.trim()) && code.slice(code.lastIndexOf('\n',c.start-1)+1,c.start).trim()==='').map(c=>c.value.trim()))].sort();
    if(labels.length)bundles.push({file:entry.path,sha256:entry.sha256,labels:labels.map(label=>({label,classification:classifyLabel(label)}))});
  }
  const ui=[];
  for(const folder of ['bridge-ui','bridge-ui-sessions']){
    const capture=await json(`docs/evidence/${folder}.json`);
    for(const item of [...capture.constants,...capture.classes]){
      if(hash(await readFile(path.join(ROOT,'recovered',folder,item.file)))!==item.sha256)throw new Error(`UI evidence mismatch: ${item.file}`);
    }
    ui.push({folder:`recovered/${folder}`,host:capture.origin,hostSha256:capture.sha256,classification:'located-custom-feature-in-mixed-host',classFiles:capture.classes.map(c=>c.file),standaloneSourceModule:false,wholeHostComparedToUpstream:false});
  }
  const targets=[...new Set(completeness.unresolved_relative_imports.map(i=>i.normalized_target))].sort().map(target=>{
    const label=target.replace(/^\.\.\/\.\.\//,'').replace(/\.js$/,'.ts').replace(/\.mjs$/,'.mts');
    const module=rebuilt.modules.find(m=>m.originLabel===label);
    return {target,matchingLabel:label,reconstruction:module?{file:`reconstructed/bridge-core/${module.file}`,coverage:module.coverage}:null,originalTypescriptImportResolved:false};
  });
  return {scope:'Paths, package placement and real AST comments support feature separation, not exclusive authorship or complete Code OSS modification discovery.',files,bundles,ui,missingOriginalTargets:targets,
    summary:{originalFiles:files.length,shippedTypescriptFiles:files.filter(f=>f.role==='shipped-typescript-source').length,sharedLabelsAcrossBundles:new Set(bundles.flatMap(b=>b.labels.filter(l=>l.classification==='shared-custom-candidate').map(l=>l.label))).size,originalMissingTargets:targets.length,targetsWithSomeReconstructedJs:targets.filter(t=>t.reconstruction).length,reconstructedModules:rebuilt.moduleCount},
    separation:{originalExtension:'recovered/shuncode-extension',compiledCustomUi:ui.map(u=>u.folder),reconstructedShared:'reconstructed/bridge-core',communityMaintenance:'community',codeOssFullSourceRecovered:false,exactUpstreamBaselineConfirmed:false,completeCustomPatchset:false},
    warnings:['Compiled extension bundles include third-party dependencies: do not claim the whole bundle as exclusively self-authored.','src/ labels are candidates corroborated by feature/import evidence, not copyright determinations.','Two located UI classes do not prove all carrier modifications have been found.','Separate JS modules do not resolve the original TypeScript imports or recover erased types.']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await auditBoundary(),text=JSON.stringify(report,null,2)+'\n';
  if(process.argv.includes('--check')){if(await readFile(path.join(ROOT,OUTPUT),'utf8')!==text)throw new Error('Boundary inventory drift');}
  else await writeFile(path.join(ROOT,OUTPUT),text);
  console.log(JSON.stringify(report.summary,null,2));
}
