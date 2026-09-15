// Static runtime import audit. TS erasure is NOT a typecheck or an extension build.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { parse } from 'acorn';
import { ROOT, hash } from './patch_utils.mjs';

export async function auditRuntimeImports() {
  const provenance = JSON.parse(await readFile(path.join(ROOT, 'reconstructed/bridge-core/provenance.json'), 'utf8'));
  const original = JSON.parse(await readFile(path.join(ROOT, 'docs/evidence/custom-extension.json'), 'utf8'));
  const dir = path.join(ROOT, 'recovered/shuncode-extension/src');
  const imports = [];
  let typescriptFiles = 0;
  for (const file of (await readdir(dir)).filter(n => n.endsWith('.ts')).sort()) {
    const bytes = await readFile(path.join(dir, file));
    const expected = original.copied.find(e => e.path === 'src/' + file);
    if (!expected || expected.sha256 !== hash(bytes)) throw new Error(`Original source changed: ${file}`);
    typescriptFiles++;
    const js = transformSync(bytes.toString('utf8'), { loader: 'ts', format: 'esm' }).code;
    for (const node of parse(js, { ecmaVersion: 'latest', sourceType: 'module' }).body) {
      if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('../../../src/')) continue;
      const target = 'src/' + path.basename(node.source.value);
      const module = provenance.modules.find(m => m.file === target);
      for (const specifier of node.specifiers) {
        const name = specifier.type === 'ImportSpecifier' ? specifier.imported.name : null;
        const providers = name ? provenance.modules.filter(m => m.exports.includes(name)).map(m => m.file) : [];
        imports.push({ source: 'src/' + file, target, name,
          status: name && module?.exports.includes(name) ? 'direct-export-present' : providers.length === 1 ? 'reexport-adapter-needed' : 'unresolved-runtime-export', providers });
      }
    }
  }
  return { scope: 'Static shared runtime import names after TypeScript erasure; no rewriting, execution, original type recovery or full extension build.',
    originalTypescriptImportsRewired: false, originalTypecheckPassed: false,
    typescriptFiles, imports, summary: { importSpecifiers: imports.length,
      direct: imports.filter(i => i.status === 'direct-export-present').length,
      reexportAdaptersNeeded: imports.filter(i => i.status === 'reexport-adapter-needed').length,
      unresolved: imports.filter(i => i.status === 'unresolved-runtime-export').length } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditRuntimeImports();
  const text = JSON.stringify(report, null, 2) + '\n';
  const destination = path.join(ROOT, 'docs/evidence/extension-runtime-imports.json');
  if (process.argv.includes('--check')) {
    if (await readFile(destination, 'utf8') !== text) throw new Error('Runtime import audit drift');
  } else await writeFile(destination, text);
  console.log(JSON.stringify(report.summary, null, 2));
}
