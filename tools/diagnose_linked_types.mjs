// Diagnose the linked candidate against pinned public host types; never emit or run code.
import ts from 'typescript';
import { readFile, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, hash } from './patch_utils.mjs';
import { communityEntry, verifySource } from './build_linked_extension.mjs';

const portable = p => p.split(path.sep).join('/');
export async function diagnoseTypes({ contracts = false } = {}) {
  const original = JSON.parse(await readFile(path.join(ROOT, 'docs/evidence/custom-extension.json'), 'utf8'));
  const core = JSON.parse(await readFile(path.join(ROOT, 'reconstructed/bridge-core/provenance.json'), 'utf8'));
  const upstream = JSON.parse(await readFile(path.join(ROOT, 'reference/vscode-types/provenance.json'), 'utf8'));
  const expected = new Map();
  for (const file of original.copied) expected.set('recovered/shuncode-extension/' + file.path, file.sha256);
  for (const file of core.modules) expected.set('reconstructed/bridge-core/' + file.file, file.sha256);
  for (const file of upstream.files) expected.set('reference/vscode-types/' + file.file, file.sha256);
  const contractModules = contracts ? JSON.parse(await readFile(path.join(ROOT, 'reconstructed/type-contracts/provenance.json'), 'utf8')).modules : [];
  const contractMap = new Map();
  for (const item of contractModules) {
    if (expected.get(item.implementation) !== item.implementationSha256) throw new Error('Contract implementation provenance mismatch: ' + item.implementation);
    verifySource(await readFile(path.join(ROOT, item.implementation)), item.implementationSha256, item.implementation);
    for (const dependency of item.evidenceDependencies ?? []) {
      if (expected.get(dependency.source) !== dependency.sha256) throw new Error('Contract dependency provenance mismatch: ' + dependency.source);
      verifySource(await readFile(path.join(ROOT, dependency.source)), dependency.sha256, dependency.source);
    }
    const declaration = 'reconstructed/type-contracts/' + item.declaration;
    verifySource(await readFile(path.join(ROOT, declaration)), item.sha256, declaration);
    expected.set(declaration, item.sha256);
    contractMap.set(item.implementation, declaration);
  }
  const sourceFiles = original.copied.filter(f => f.path.startsWith('src/') && /\.[cm]?ts$/.test(f.path)).map(f => 'recovered/shuncode-extension/' + f.path);
  const hostFiles = upstream.files.filter(f => f.file.endsWith('.d.ts')).map(f => 'reference/vscode-types/' + f.file);
  const options = { noEmit: true, strict: true, skipLibCheck: true, allowJs: true, checkJs: false,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    esModuleInterop: true, types: ['node'], typeRoots: [path.join(ROOT, 'node_modules/@types')] };
  const host = ts.createCompilerHost(options), originalRead = host.readFile.bind(host);
  host.readFile = file => {
    const source = portable(path.relative(ROOT, file));
    if (!expected.has(source)) return originalRead(file);
    const bytes = fs.readFileSync(file); verifySource(bytes, expected.get(source), source);
    let text = bytes.toString('utf8');
    if (source === 'recovered/shuncode-extension/src/extension.ts') return communityEntry(text);
    for (const name of ['bridge-license-service', 'bridge-access-controller']) {
      if (source === 'recovered/shuncode-extension/src/' + name + '.ts') return fs.readFileSync(path.join(ROOT, 'community/extension/src/' + name + '.ts'), 'utf8');
    }
    return text;
  };
  host.resolveModuleNames = (names, containingFile) => names.map(name => {
    if (name.startsWith('../../../src/') && portable(path.relative(ROOT, containingFile)).startsWith('recovered/shuncode-extension/src/')) {
      const source = 'reconstructed/bridge-core/src/' + path.posix.basename(name);
      if (name !== '../../../src/' + path.posix.basename(name) || !expected.has(source)) return undefined;
      const declaration = contractMap.get(source);
      return { resolvedFileName: path.join(ROOT, declaration ?? source), extension: declaration ? ts.Extension.Dts : ts.Extension.Js, isExternalLibraryImport: false };
    }
    return ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
  });
  const program = ts.createProgram([...sourceFiles, ...hostFiles].map(f => path.join(ROOT, f)), options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(d => {
    const start = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    return { code: d.code, category: ts.DiagnosticCategory[d.category], source: d.file ? portable(path.relative(ROOT, d.file.fileName)) : null,
      line: start ? start.line + 1 : null, column: start ? start.character + 1 : null,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n').replaceAll(portable(ROOT), '<repo>').replaceAll(ROOT, '<repo>') };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  const counts = {};
  for (const d of diagnostics) counts['TS' + d.code] = (counts['TS' + d.code] ?? 0) + 1;
  const errors = diagnostics.filter(d => d.category === 'Error').length;
  return { scope: 'Diagnostic candidate linking preserved TS to inferred JS and public Code OSS types. Not original type recovery or application acceptance.',
    typescriptVersion: ts.version, candidateHostCommit: upstream.commit, sourceFiles: sourceFiles.length, hostDeclarationFiles: hostFiles.length,
    strict: true, noEmit: true, allowJs: true, checkJs: false, skipLibCheck: true,
    errorCount: errors, diagnosticCount: diagnostics.length, counts,
    candidateTypecheckPassed: errors === 0, originalTypesRecovered: false, originalHostIdentityConfirmed: false,
    ...(contracts ? { contractMode: 'candidate-declarations', contractModules, runtimeImplementationCheckedByTypeScript: false } : {}),
    diagnostics, lockfileSha256: hash(await readFile(path.join(ROOT, 'package-lock.json'))) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contracts = process.argv.includes('--contracts');
  const report = await diagnoseTypes({ contracts });
  await writeFile(path.join(ROOT, contracts ? 'docs/evidence/contract-type-diagnostics.json' : 'docs/evidence/linked-type-diagnostics.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ errorCount: report.errorCount, counts: report.counts, candidateTypecheckPassed: report.candidateTypecheckPassed }, null, 2));
  process.exitCode = report.candidateTypecheckPassed ? 0 : 1;
}
