#!/usr/bin/env node
// Verify the reconstructed Chat host shapes by compiling the author's real code
// against them, and prove the check can fail.
//
// The reconstruction lives in docs/evidence/host-chat-shapes/reconstruction-probe.ts:
// a local interface carrying the five members the author's forked host declared,
// followed by their own code reproduced verbatim. If it typechecks, the shapes
// are consistent with everything they wrote.
//
// A probe that only ever passes proves nothing, so this also compiles a mutated
// copy - metrics.value switched from string to number - which MUST fail. If the
// mutation compiles, the harness is not checking and the pass is worthless.

import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './patch_utils.mjs';

const PROBE = 'docs/evidence/host-chat-shapes/reconstruction-probe.ts';

function compile(text) {
  const file = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.ES2022, true);
  const options = { strict: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts'] };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, ...rest) =>
    name === 'probe.ts' ? file : original(name, ...rest);
  const program = ts.createProgram(['probe.ts'], options, host);
  return ts.getPreEmitDiagnostics(program)
    .filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}

const source = fs.readFileSync(path.join(ROOT, PROBE), 'utf8');

// Control: metrics values are always stringified at the author's call sites, so
// declaring them as numbers must be rejected.
const mutated = source.replace('metrics?: Array<{ label: string; value: string }>',
  'metrics?: Array<{ label: string; value: number }>');
if (mutated === source) {
  console.error('verify:host-shapes FAILED - control mutation did not apply; the probe changed shape.');
  process.exit(1);
}
if (compile(mutated).length === 0) {
  console.error('verify:host-shapes FAILED - the mutated control compiled. The check is not checking.');
  process.exit(1);
}

const errors = compile(source);
if (errors.length) {
  for (const error of errors) console.error(`  ${error}`);
  console.error(`verify:host-shapes FAILED - the reconstruction does not satisfy the author's code.`);
  process.exit(1);
}

console.log("verify:host-shapes OK - the author's code compiles against the "
  + 'reconstructed shapes; the mutated control was correctly rejected.');
