import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT, hash} from './patch_utils.mjs';
export const PORTABLE_PRESENTATION_SOURCE = 'community/extension/src/portable-tool-presentation.ts';
export async function portablePresentationInputs() {
  const manifest=JSON.parse(await readFile(path.join(ROOT,'community/extension/portable-presentation.provenance.json'),'utf8'));
  if(manifest.source !== PORTABLE_PRESENTATION_SOURCE) throw new Error('Unexpected portable presentation source');
  if(hash(await readFile(path.join(ROOT,manifest.source))) !== manifest.sha256) throw new Error('Portable presentation integrity mismatch');
  const original=JSON.parse(await readFile(path.join(ROOT,'docs/evidence/custom-extension.json'),'utf8'));
  for(const dependency of manifest.dependencies) {
    if(!['src/tool-presentation.ts','src/chat-history.mts'].includes(dependency.path)) throw new Error('Unexpected portable dependency');
    if(original.copied.find(f=>f.path===dependency.path)?.sha256 !== dependency.sha256 || hash(await readFile(path.join(ROOT,'recovered/shuncode-extension',dependency.path))) !== dependency.sha256) throw new Error('Portable dependency integrity mismatch');
  }
  if(new Set(manifest.dependencies.map(d=>d.path)).size!==2) throw new Error('Missing portable dependency');
  return manifest;
}
export function portablePresentationSource(text) {
  if(text.split('vscode.ChatSimpleToolResultData').length!==12 || text.split('    data: {').length!==2) throw new Error('Unexpected presentation boundaries');
  const end='      metrics: options.isComplete ? presentation.metrics : undefined,\n    },\n  };\n}';
  if(text.split(end).length!==2) throw new Error('Unexpected presentation result boundary');
  text=text.replaceAll('vscode.ChatSimpleToolResultData','ShunCodeToolResultData');
  text=text.replace('  data: ShunCodeToolResultData;', '  data: vscode.ChatSimpleToolResultData;');
  text=text.replace('    data: {','    data: toPortableToolResultData({');
  text=text.replace(end,'      metrics: options.isComplete ? presentation.metrics : undefined,\n    }, technicalInput, rawOutput, options.isComplete),\n  };\n}');
  return 'import { toPortableToolResultData, type ShunCodeToolResultData } from "@shuncode/portable-presentation";\n'+text;
}
