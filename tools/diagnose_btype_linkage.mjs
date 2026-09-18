// Link the recovered extension sources against the step-2 B-layer declarations
// and report what still does not typecheck.
//
// Why this exists. tools/diagnose_linked_types.mjs --contracts measures the
// extension against the ORIGINAL 14 declarations in reconstructed/type-contracts.
// The 37 written during step 2 were not wired into anything, so nothing proved
// they hold up when the real extension sources are compiled against them - and
// a declaration that only typechecks on its own is a much weaker claim than one
// that also satisfies its callers.
//
// Running this found five genuine defects that the standalone checks could not:
//
//   BridgeActivityTracker      declared an options bag; takes (limit, now)
//   BridgeActivitySnapshot     declared activities readonly; the author assigns
//                              it to a mutable field
//   CustomToolStructuredContent  needed an index signature, since the author
//                              passes it as Record<string, unknown>
//   bridgeManagedCommandOwnerId  declared (string); accepts string | undefined
//                              and throws on blank
//   BridgeEventSender          declared message as unknown; it must be the
//                              SDK's JSONRPCMessage, because callback
//                              parameters are checked contravariantly and a
//                              looser type makes the SDK options unassignable
//
// It does NOT replace the existing diagnostic. It is a second opinion over a
// wider set of declarations, kept separate so neither can mask the other.

import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, hash } from './patch_utils.mjs';
import { verifySource } from './build_linked_extension.mjs';

const portable = p => p.split(path.sep).join('/');
const TYPES_DIR = 'reconstructed/bridge-core/types';

export async function diagnoseBtypeLinkage() {
  const original = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/evidence/custom-extension.json'), 'utf8'));
  const core = JSON.parse(fs.readFileSync(path.join(ROOT, 'reconstructed/bridge-core/provenance.json'), 'utf8'));
  const upstream = JSON.parse(fs.readFileSync(path.join(ROOT, 'reference/vscode-types/provenance.json'), 'utf8'));
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, TYPES_DIR, 'provenance.json'), 'utf8'));

  // Same integrity discipline as the existing diagnostic: every input is
  // hash-pinned, so a silently edited source cannot change the verdict.
  const expected = new Map();
  for (const file of original.copied) expected.set('recovered/shuncode-extension/' + file.path, file.sha256);
  for (const file of core.modules) expected.set('reconstructed/bridge-core/' + file.file, file.sha256);
  for (const file of upstream.files) expected.set('reference/vscode-types/' + file.file, file.sha256);

  const declarationFor = new Map();
  for (const item of index.modules) {
    if (expected.get(item.implementation) !== item.implementationSha256) {
      throw new Error('Implementation provenance mismatch: ' + item.implementation);
    }
    const declaration = `${TYPES_DIR}/${item.declaration}`;
    verifySource(fs.readFileSync(path.join(ROOT, declaration)), item.sha256, declaration);
    expected.set(declaration, item.sha256);
    declarationFor.set(item.implementation, declaration);
  }

  const sourceFiles = original.copied
    .filter(f => f.path.startsWith('src/') && /\.[cm]?ts$/.test(f.path))
    .map(f => 'recovered/shuncode-extension/' + f.path);
  const hostFiles = upstream.files
    .filter(f => f.file.endsWith('.d.ts'))
    .map(f => 'reference/vscode-types/' + f.file);

  const options = {
    noEmit: true, strict: true, skipLibCheck: true, allowJs: true, checkJs: false,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, esModuleInterop: true,
    types: ['node'], typeRoots: [path.join(ROOT, 'node_modules/@types')],
  };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host);
  host.readFile = file => {
    const source = portable(path.relative(ROOT, file));
    if (!expected.has(source)) return originalRead(file);
    const bytes = fs.readFileSync(file);
    verifySource(bytes, expected.get(source), source);
    return bytes.toString('utf8');
  };
  host.resolveModuleNames = (names, containingFile) => names.map(name => {
    const from = portable(path.relative(ROOT, containingFile));
    if (name.startsWith('../../../src/') && from.startsWith('recovered/shuncode-extension/src/')) {
      const base = path.posix.basename(name);
      const implementation = 'reconstructed/bridge-core/src/' + base;
      const declaration = declarationFor.get(implementation);
      if (declaration) {
        return { resolvedFileName: path.join(ROOT, declaration), extension: ts.Extension.Dts, isExternalLibraryImport: false };
      }
      // Fall back to the raw JS so an untyped module is still resolvable; that
      // keeps this honest about which modules the declarations actually cover.
      if (expected.has(implementation)) {
        return { resolvedFileName: path.join(ROOT, implementation), extension: ts.Extension.Js, isExternalLibraryImport: false };
      }
      return undefined;
    }
    return ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
  });

  const program = ts.createProgram([...sourceFiles, ...hostFiles].map(f => path.join(ROOT, f)), options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(d => {
    const start = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    return {
      code: d.code,
      category: ts.DiagnosticCategory[d.category],
      source: d.file ? portable(path.relative(ROOT, d.file.fileName)) : null,
      line: start ? start.line + 1 : null,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n').replaceAll(portable(ROOT), '<repo>').replaceAll(ROOT, '<repo>'),
    };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));

  const errors = diagnostics.filter(d => d.category === 'Error');
  const counts = {};
  for (const d of errors) counts['TS' + d.code] = (counts['TS' + d.code] ?? 0) + 1;

  // Which files the remaining errors come from decides whether the B-layer
  // declarations are implicated at all.
  const bySource = {};
  for (const d of errors) bySource[d.source] = (bySource[d.source] ?? 0) + 1;

  return {
    scope: ('Recovered extension sources linked against the step-2 B-layer '
      + 'declarations. Diagnostic only: nothing is emitted or executed.'),
    declarationCount: index.modules.length,
    typescriptVersion: ts.version,
    sourceFiles: sourceFiles.length,
    hostDeclarationFiles: hostFiles.length,
    errorCount: errors.length,
    counts,
    errorsBySource: bySource,
    interpretation: ('Errors in tool-presentation.ts and bridge-mcp-transport.ts '
      + 'are host- and SDK-surface gaps that predate this work: the pinned public '
      + 'vscode.d.ts has no custom Chat result fields, and the MCP SDK transport '
      + 'options differ from the shipped ones. They are not caused by the B-layer '
      + 'declarations.'),
    doesNotClaim: ('A clean link is not proof the declarations are correct, only '
      + 'that they satisfy their callers. It also does not build or run anything.'),
    errors,
    lockfileSha256: hash(fs.readFileSync(path.join(ROOT, 'package-lock.json'))),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await diagnoseBtypeLinkage();
  const out = path.join(ROOT, 'docs/evidence/btype-linkage.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`errorCount=${report.errorCount} across ${Object.keys(report.errorsBySource).length} file(s)`);
  for (const [source, count] of Object.entries(report.errorsBySource)) {
    console.log(`  ${count} ${source}`);
  }
}
