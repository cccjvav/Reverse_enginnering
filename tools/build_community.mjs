// Version-locked, reproducible overlay. Never evaluates the recovered extension.
import { parse } from 'acorn';
import { transformSync } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT, hash, applyEdits, allNodes, only } from './patch_utils.mjs';
export { ROOT, hash, applyEdits, allNodes, only } from './patch_utils.mjs';

export function scriptModule(ts) {
  const js = transformSync(ts, { loader: 'ts', target: 'es2022', format: 'esm', legalComments: 'inline' }).code;
  const ast = parse(js, { ecmaVersion: 'latest', sourceType: 'module' });
  return applyEdits(js, ast.body.filter(n => n.type === 'ExportNamedDeclaration').map(n => {
    if (n.declaration) throw new Error('Unexpected export shape');
    return { start:n.start, end:n.end, text:'' };
  }));
}
function sections(text, marker) {
  const tags = [...text.matchAll(/^\/\/ (?:extensions\/|src\/|node_modules\/|<define:)[^\n]+\n/gm)];
  return tags.filter(t => t[0] === `// ${marker}\n`).map(t => {
    const next = tags.find(n => n.index > t.index);
    return {start:t.index, end:next?.index ?? text.length};
  });
}
const protectedModules = [
  'extensions/shuncode/src/bridge-server.ts',
  'extensions/shuncode/src/bridge-mcp-transport.ts',
  'extensions/shuncode/src/bridge-tool-dispatcher.ts',
  'extensions/shuncode/src/ide-tool-broker.ts',
  'extensions/shuncode/src/codex-auth.ts',
  'src/bridge-http-router.ts', 'src/workspace-paths.ts', 'src/tool-input-validation.ts',
];
export function protectedHashes(text) {
  return Object.fromEntries(protectedModules.map(marker => {
    const found = sections(text, marker);
    if (!found.length) throw new Error(`Missing security/provider module: ${marker}`);
    return [marker, found.map(s => hash(text.slice(s.start, s.end)))];
  }));
}
export function patchExtension(original, service, controller) {
  const nodes = allNodes(parse(original, { ecmaVersion:'latest', sourceType:'script' }));
  const edits = [];
  const controllerSection = only(sections(original, 'extensions/shuncode/src/bridge-access-controller.ts'), () => true, 'controller section');
  edits.push({...controllerSection, text:`// Community lifecycle (reconstructed replacement)\n${scriptModule(controller)}\n`});
  const serviceSection = only(sections(original, 'extensions/shuncode/src/bridge-license-service.ts'), s => original.slice(s.start,s.end).includes('var BridgeLicenseService = class'), 'commercial service section');
  edits.push({...serviceSection, text:`// Community availability (not a signed commercial licence)\n${scriptModule(service)}\n`});
  const configSection = only(sections(original, 'extensions/shuncode/src/bridge-license-config.ts'), () => true, 'commercial config');
  edits.push({...configSection,text:'// Commercial trust configuration retired in community edition.\n'});
  const gate = only(nodes, n => n.type === 'VariableDeclarator' && n.id.name === 'authorizeBridgeStart', 'start callback');
  edits.push({start:gate.init.start,end:gate.init.end,text:'async () => { await bridgeLicense.requireFeature("bridge"); }'});
  const signOut = only(nodes, n => n.type === 'CallExpression' && n.arguments[0]?.value === 'shuncode.bridge.license.signOut', 'legacy sign-out');
  const fn = signOut.arguments[1];
  edits.push({start:fn.body.start,end:fn.body.end,text:'{ await bridgeLicenseReady; return bridgeAccess.signOut(); }'});
  const result = applyEdits(original,edits);
  parse(result,{ecmaVersion:'latest',sourceType:'script'});
  const before = protectedHashes(original), after = protectedHashes(result);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Security or provider module changed');
  for (const forbidden of ['shuncode-bridge-license.', '/v1/payments', 'PAYMENT_POLL_INTERVAL_MS', 'LICENSE_REVALIDATION_INTERVAL_MS', 'SHUNCODE_BRIDGE_LICENSE_SMOKE_BYPASS']) {
    if (result.includes(forbidden)) throw new Error(`Retired commercial path remains: ${forbidden}`);
  }
  return { code:result, protectedModules:before };
}
export function communityManifest(original) {
  const p = structuredClone(original);
  p.displayName = 'ShunCode Community';
  p.description = 'Recovered ShunCode custom tools and UI. Bridge is free; model and tunnel provider accounts remain separate.';
  p.shuncodeEdition = 'community';
  const retired = command => typeof command === 'string' && /^shuncode\.bridge\.(license|payment)\./.test(command);
  p.contributes.commands = p.contributes.commands.filter(c => !retired(c.command));
  for (const [key, items] of Object.entries(p.contributes.menus ?? {})) {
    if (Array.isArray(items)) p.contributes.menus[key] = items.filter(i => !retired(i.command));
  }
  return p;
}
function patchEntrySource(text) {
  const a = text.indexOf('  const authorizeBridgeStart = async () => {');
  const b = text.indexOf('\n  const bridge = new BridgeManager', a);
  if (a < 0 || b < 0) throw new Error('Unexpected original source entry');
  text = text.slice(0,a) + '  const authorizeBridgeStart = async () => {\n    await bridgeLicense.requireFeature("bridge");\n  };' + text.slice(b);
  const legacy = '      await vscode.workspace.getConfiguration("shuncode.bridge").update("persistentMode", false, vscode.ConfigurationTarget.Global);\n';
  if (text.split(legacy).length !== 2) throw new Error('Unexpected sign-out source');
  return text.replace(legacy,'');
}
export async function build(output = path.join(ROOT,'.work/community-overlay')) {
  const originals = JSON.parse(await readFile(path.join(ROOT,'docs/evidence/custom-extension.json'),'utf8'));
  const origin = path.join(ROOT,'recovered/shuncode-extension');
  const readOriginal = async relative => {
    const entry = only(originals.copied,e => e.path === relative,relative);
    const bytes = await readFile(path.join(origin,relative));
    if (hash(bytes) !== entry.sha256) throw new Error(`Original evidence changed: ${relative}`);
    return bytes;
  };
  const service = await readFile(path.join(ROOT,'community/extension/src/bridge-license-service.ts'),'utf8');
  const controller = await readFile(path.join(ROOT,'community/extension/src/bridge-access-controller.ts'),'utf8');
  const bundle = await readOriginal('dist/extension.js');
  const patched = patchExtension(bundle.toString('utf8'),service,controller);
  const manifest = communityManifest(JSON.parse(await readOriginal('package.json')));
  const outputs = {
    'dist/extension.js': patched.code,
    'package.json': JSON.stringify(manifest,null,2)+'\n',
    'src/bridge-license-service.ts': service,
    'src/bridge-access-controller.ts': controller,
    'src/bridge-license-config.ts': '// Commercial configuration retired. See the preserved original under recovered/.\nexport {};\n',
    'src/extension.ts': patchEntrySource((await readOriginal('src/extension.ts')).toString('utf8').replaceAll('\r\n','\n')),
  };
  const files = [];
  for (const [relative, contents] of Object.entries(outputs)) {
    const destination = path.join(output,'resources/app/extensions/shuncode',relative);
    await mkdir(path.dirname(destination),{recursive:true});
    await writeFile(destination,contents);
    files.push({path:`resources/app/extensions/shuncode/${relative}`, originalSha256:hash(await readOriginal(relative)), sha256:hash(contents), size:Buffer.byteLength(contents)});
  }
  const { buildUiPatch } = await import('./patch_bridge_ui.mjs');
  await mkdir(path.join(output,'ui'),{recursive:true});
  const uiPatches = [], preservedUiMethods = {};
  for (const variant of ['workbench','sessions']) {
    const ui = await buildUiPatch(variant);
    const relative = variant === 'workbench' ? 'out/vs/workbench/workbench.desktop.main.js' : 'out/vs/sessions/sessions.desktop.main.js';
    const entry = only(originals.core_code_index,e => e.path === relative,relative);
    const find = `ui/bridge.${variant}.original.txt`, replacement = `ui/bridge.${variant}.community.txt`;
    await writeFile(path.join(output,find),ui.original);
    await writeFile(path.join(output,replacement),ui.code);
    preservedUiMethods[variant] = ui.preservedMethods;
    uiPatches.push({path:'resources/app/'+relative,originalSha256:entry.sha256,
      find,findSha256:hash(ui.original),replace:replacement,replaceSha256:hash(ui.code)});
  }
  const report = { edition:'community', baseVersion:'0.7.4', scope:'Version-locked extension overlay, not a complete source rebuild or tested Windows installer.',
    protectedModules:patched.protectedModules,preservedUiMethods,files,uiPatches };
  await writeFile(path.join(output,'overlay-manifest.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await build();
  console.log(`Built ${report.files.length} community overlay files; security/provider modules byte-identical.`);
}
