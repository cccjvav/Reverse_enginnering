// Static UI lesson: parse and compare strings; never instantiate recovered code.
import { buildUiPatch, parseClass } from './patch_bridge_ui.mjs';
import { hash } from './patch_utils.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runUiLearningLab() {
  const hosts = [];
  for (const variant of ['workbench', 'sessions']) {
    const ui = await buildUiPatch(variant);
    const methods = parseClass(ui.code).body.body.filter(n => n.type === 'MethodDefinition');
    hosts.push({ variant, originalSha256: hash(ui.original), updatedSha256: hash(ui.code),
      preservedMethodCount: Object.keys(ui.preservedMethods).length,
      toolRenderingPreserved: Object.hasOwn(ui.preservedMethods, 'renderCustomTools'),
      tunnelTokenClearingPreserved: Object.hasOwn(ui.preservedMethods, 'clearNamedTunnelToken'),
      paymentMethodRemoved: !methods.some(n => n.key.name === 'createPayment') });
  }
  return { staticAnalysisOnly: true, recoveredClassExecuted: false, filesWritten: false,
    distinctHostInputs: hosts[0].originalSha256 !== hosts[1].originalSha256, hosts };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runUiLearningLab(), null, 2));
}
