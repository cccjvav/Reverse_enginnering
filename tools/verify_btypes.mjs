#!/usr/bin/env node
// Verify the hand-written B-layer declarations two ways, and refuse to report
// success unless the check actually ran.
//
// This exists because of a real near-miss: the sandbox was re-provisioned,
// node_modules vanished, and a tsc probe "passed" with zero errors purely
// because tsc was never executed. A verification that cannot fail is worse than
// none, so this script asserts its own preconditions first.

import { existsSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(repo, 'node_modules', '.bin', 'tsc');
const typesDir = join(repo, 'reconstructed', 'bridge-core', 'types');

function fail(message) {
	console.error(`verify:btypes FAILED - ${message}`);
	process.exit(1);
}

// Precondition 1: the compiler must exist. Skipping silently is what caused the
// near-miss this script guards against.
if (!existsSync(tsc)) {
	fail('tsc not found. Run npm install; do not treat a missing compiler as a pass.');
}

const declarations = readdirSync(typesDir).filter(f => f.endsWith('.d.ts'));
if (declarations.length === 0) {
	fail('no hand-written declarations found to verify.');
}

const work = mkdtempSync(join(tmpdir(), 'btypes-'));
try {
	// Positive: type-check the declaration files themselves. Importing them with
	// `import type * as` is not enough - that resolves the module without
	// checking its body, so a declaration referencing a nonexistent type still
	// passes. Listing them as `files` makes tsc check their contents.
	writeFileSync(join(work, 'positive.ts'),
		`export const declarationCount = ${declarations.length};\n`);

	// Negative: a control that MUST fail. If this compiles, the harness is not
	// actually type-checking, and every other result is meaningless.
	writeFileSync(join(work, 'negative.ts'),
		'const mustFail: number = "not a number";\nexport { mustFail };\n');

	const base = {
		target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
		strict: true, noEmit: true, types: ['node'],
		// skipLibCheck must stay OFF here. It suppresses checking of .d.ts
		// bodies, which is exactly what we are verifying: with it on, a
		// declaration referencing a nonexistent type compiles clean.
		skipLibCheck: false,
		// The temp dir has no node_modules of its own, so point type resolution
		// back at the repository rather than letting @types/node go missing.
		typeRoots: [join(repo, 'node_modules', '@types')],
	};
	writeFileSync(join(work, 'tsconfig.positive.json'),
		JSON.stringify({
			compilerOptions: base,
			files: ['positive.ts', ...declarations.map(f => join(typesDir, f))],
		}));
	writeFileSync(join(work, 'tsconfig.negative.json'),
		JSON.stringify({ compilerOptions: base, files: ['negative.ts'] }));

	const run = cfg => spawnSync(tsc, ['-p', join(work, cfg)],
		{ cwd: repo, encoding: 'utf8' });

	const negative = run('tsconfig.negative.json');
	if (negative.status === 0) {
		fail('the deliberately broken control compiled. The check is not running.');
	}

	const positive = run('tsconfig.positive.json');
	const output = `${positive.stdout ?? ''}${positive.stderr ?? ''}`;
	if (positive.status !== 0) {
		console.error(output.trim());
		fail(`${declarations.length} declaration file(s) did not typecheck.`);
	}

	console.log(`verify:btypes OK - ${declarations.length} declaration files ` +
		'typecheck under strict mode; broken control correctly rejected.');
} finally {
	rmSync(work, { recursive: true, force: true });
}
