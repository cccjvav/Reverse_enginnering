// Typecheck the assembled skeleton using the author's OWN tsconfig.
//
// The previous diagnostics drove TypeScript through a custom module resolver
// that rewrote `../../../src/x.js` onto declaration files by hand. That proves
// the declarations are usable, but it does not prove the project structure is
// right - the resolver was papering over the layout.
//
// This runs the shipped extensions/shuncode/tsconfig.json as written, against a
// tree assembled at the paths that config expects. If it resolves, the layout
// recovered from those relative paths is correct; if it does not, the layout is
// wrong and no amount of declaration polish would fix it.
//
// Two deliberate accommodations, both reported rather than hidden:
//
//   * The author's config lists ../../src/file-tool-registry.ts and
//     ide-tool-definitions.ts. Those two B-layer modules were only recovered as
//     compiled .js, so they are dropped from `files` and reached through their
//     .d.ts instead. That is a real gap in what was recovered, not a fix.
//   * test/workspace-hub-store.test.ts did not ship, so it is dropped too.

import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './patch_utils.mjs';

const portable = p => p.split(path.sep).join('/');

export function diagnoseSkeleton(workspace = '.work/skeleton') {
  const root = path.join(ROOT, workspace);
  const extDir = path.join(root, 'extensions/shuncode');
  const configPath = path.join(extDir, 'tsconfig.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`No assembled skeleton at ${workspace}; run assemble_skeleton.py first.`);
  }

  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, '\n'));

  // Drop only what genuinely was not recovered, and record it.
  const dropped = [];
  const files = raw.config.files.filter(entry => {
    const resolved = path.resolve(extDir, entry);
    if (fs.existsSync(resolved)) return true;
    dropped.push(entry);
    return false;
  });

  const parsed = ts.parseJsonConfigFileContent(
    { ...raw.config, files }, ts.sys, extDir, undefined, configPath);
  if (parsed.errors.length) {
    const fatal = parsed.errors.filter(d => d.category === ts.DiagnosticCategory.Error);
    if (fatal.length) {
      throw new Error(fatal.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    }
  }

  // allowJs so the .js B-layer modules resolve; their .d.ts sit beside them and
  // take precedence, which is exactly how the author's tree would have behaved
  // before those modules were compiled.
  const options = { ...parsed.options, allowJs: true, checkJs: false, noEmit: true };
  const program = ts.createProgram(parsed.fileNames, options);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(d => {
    const start = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    return {
      code: d.code,
      category: ts.DiagnosticCategory[d.category],
      source: d.file ? portable(path.relative(root, d.file.fileName)) : null,
      line: start ? start.line + 1 : null,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n')
        .replaceAll(portable(root), '<skeleton>').replaceAll(root, '<skeleton>'),
    };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));

  const errors = diagnostics.filter(d => d.category === 'Error');
  const counts = {};
  const bySource = {};
  for (const d of errors) {
    counts['TS' + d.code] = (counts['TS' + d.code] ?? 0) + 1;
    bySource[d.source] = (bySource[d.source] ?? 0) + 1;
  }

  // TS2307 means a module could not be found at all - the signal that the
  // layout itself is wrong, as distinct from ordinary type mismatches.
  const unresolved = errors.filter(d => d.code === 2307);

  return {
    scope: ("The assembled skeleton typechecked through the author's own shipped "
      + 'tsconfig.json, with no custom module resolver. Diagnostic only.'),
    workspace,
    configUsed: 'extensions/shuncode/tsconfig.json (shipped verbatim)',
    droppedFromFiles: dropped,
    droppedReason: ('Declared by the author but never recovered: two B-layer '
      + 'modules exist only as compiled .js (reached via their .d.ts instead), '
      + 'and the test file did not ship.'),
    typescriptVersion: ts.version,
    filesCompiled: parsed.fileNames.length,
    errorCount: errors.length,
    counts,
    errorsBySource: bySource,
    unresolvedModuleCount: unresolved.length,
    layoutResolves: unresolved.length === 0,
    layoutVerdict: unresolved.length === 0
      ? ('Every cross-layer import resolved with no custom resolver, so the '
        + "directory layout read out of the author's tsconfig is correct.")
      : 'Some imports did not resolve; the recovered layout is wrong somewhere.',
    doesNotClaim: ('Typechecking is not building. This produces no bundle, runs '
      + 'no npm install, and does not touch the Code OSS carrier.'),
    errors,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = diagnoseSkeleton();
  fs.writeFileSync(path.join(ROOT, 'docs/evidence/skeleton-typecheck.json'),
    JSON.stringify(report, null, 2) + '\n');
  console.log(`files=${report.filesCompiled} errors=${report.errorCount} `
    + `unresolved=${report.unresolvedModuleCount} layoutResolves=${report.layoutResolves}`);
  for (const [source, count] of Object.entries(report.errorsBySource)) {
    console.log(`  ${count} ${source}`);
  }
}
