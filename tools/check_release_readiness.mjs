// Conservative engineering status audit. Never launches a product, installer, GUI or server.
import {readFile, writeFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT, hash} from './patch_utils.mjs';
import {diagnoseTypes} from './diagnose_linked_types.mjs';
import {buildLinkedExtension} from './build_linked_extension.mjs';

export async function checkReleaseReadiness() {
  const diagnostics = await diagnoseTypes({portableChat:true});
  const {report: bundle} = await buildLinkedExtension({portableChat:true});
  const observed = [];
  for (const name of [
    'recovered/shuncode-extension/runtime/agent-host.js',
    'recovered/shuncode-extension/runtime/mcp-server.js',
    'recovered/shuncode-extension/runtime/git/bin/bash.exe',
    'recovered/shuncode-extension/runtime/bin/rg.exe'
  ]) {
    try {
      const bytes = await readFile(path.join(ROOT,name));
      observed.push({source:name, exists:true, bytes:bytes.length, sha256:hash(bytes), candidateRuntimeVerified:false});
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      observed.push({source:name, exists:false, candidateRuntimeVerified:false});
    }
  }
  const installerPath = path.join(ROOT,'ShunCode-0.7.4-win32-x64-Setup.exe');
  const info = await stat(installerPath);
  const installerIsLfsPointer = info.size < 1024 && (await readFile(installerPath,'utf8')).startsWith('version https://git-lfs.github.com/spec/v1');
  const gates = [
    {id:'source-linkage', status:'PASS', detail:'In-memory experimental CJS rebuilt and statically parsed; not a product package.', sha256:bundle.outputSha256},
    {id:'candidate-types', status:diagnostics.candidateTypecheckPassed ? 'PASS' : 'FAIL', errors:diagnostics.errorCount, detail:'Strict candidate consumer check; JS implementations not fully checked.'},
    {id:'carrier-identity', status:'BLOCKED', detail:'Shipped product.json self-reports 1.132.0 / commit 09533f92, which does not exist upstream, so the carrier is an author-built fork of the 1.132.0 line with Electron raised to 44.2.0 (no upstream 1.132-1.138 tag ships 44.2.0). That is a known customisation, not an unidentified base. Still BLOCKED: no build reproduces it and public candidate types are not original host proof.'},
    {id:'host-chat-api', status:'BLOCKED', detail:'Public input/output fallback is source-linked and typechecked; original custom Chat cards and actual host rendering are not restored/verified.'},
    {id:'native-runtime', status:'BLOCKED', detail:'Recovered legacy JS exists, but complete candidate assets and Electron ABI execution are unverified.'},
    {id:'authorization-integration', status:'BLOCKED', detail:'Measures a NEW control, not a restored one: audit_permission_producers.mjs finds zero producers of checkPermission in the shipped bundles, so per-file approval never ran in 0.7.4 (file safety there came from workspace-root containment). The maintenance policy is fail-closed and tested but no host UI constructs it and it is absent from the shipped bundle. Whether to add such approval is a product decision.'},
    {id:'http-integration', status:'BLOCKED', detail:'HTTP adapter is source-linked in the experimental variant. Actual extension/desktop lifecycle acceptance is still missing.'},
    {id:'real-activation-gui-mcp', status:'BLOCKED', detail:'No complete candidate desktop activation, GUI, real client or tunnel acceptance has been performed.'},
    {id:'source-built-installer', status:'BLOCKED', detail:'No new full installer or install/upgrade/uninstall acceptance. Original EXE/overlay do not satisfy this gate.'}
  ];
  return {scope:'Current repository engineering release gates; no external account/network/desktop execution. Blocked gates require implementation and evidence, not editing this report.',
    overall:gates.every(g=>g.status==='PASS') ? 'READY' : 'NOT_READY',
    experimentalVariant: 'portable-chat-fallback', httpSourceIntegrated: bundle.sourceIntegrated,
    candidateContractModules:diagnostics.contractModules.length,
    originalTypesRecovered:false, originalHostIdentityConfirmed:false,
    originalInstaller:{source:'ShunCode-0.7.4-win32-x64-Setup.exe',bytes:info.size,isLfsPointer:installerIsLfsPointer,isNewSourceBuild:false},
    observedRuntimeAssets:observed,gates};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await checkReleaseReadiness();
  if (process.argv.includes('--write')) await writeFile(path.join(ROOT,'docs/evidence/release-readiness.json'), JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  process.exitCode = report.overall === 'READY' ? 0 : 2;
}
