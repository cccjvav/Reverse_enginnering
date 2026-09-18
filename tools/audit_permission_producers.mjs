// Audits a single, load-bearing question that the roadmap had answered only
// in passing: in the SHIPPED product, does anything ever *supply* a
// checkPermission callback to the file tools?
//
// Distinguishing consumers from producers matters because the two readings
// lead to opposite plans:
//   * "the hook exists" -> P1 is re-wiring something that regressed.
//   * "the hook is never supplied" -> P1 is authoring a control that never
//     shipped, and the real protection in 0.7.4 is workspace-root containment.
//
// Scope: static regex/text analysis of shipped bundles and the reconstructed
// modules. It does NOT execute anything and cannot prove absence in code that
// is generated at runtime. It is deliberately narrow so the result is checkable.

import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [
  'recovered/shuncode-extension/dist/extension.js',
  'recovered/shuncode-extension/runtime/mcp-server.js',
  'recovered/shuncode-extension/runtime/agent-host.js',
  'reconstructed/bridge-core/src/apply-patch.js',
  'reconstructed/bridge-core/src/find-files.js',
  'reconstructed/bridge-core/src/read-files.js',
  'reconstructed/bridge-core/src/read-image.js',
  'reconstructed/bridge-core/src/search-files.js',
  'reconstructed/bridge-core/src/file-tool-registry.js',
];

// A producer puts the callback INTO an object/argument list.
const PRODUCER_PATTERNS = [
  {id: 'objectProperty', re: /checkPermission\s*:/g},
  {id: 'shorthandProperty', re: /[{,]\s*checkPermission\s*[,}]/g},
];
// A consumer only reads it.
const CONSUMER_PATTERNS = [
  {id: 'guardedCall', re: /context\.checkPermission\s*&&/g},
  {id: 'parameter', re: /\(\s*[^)]*\bcheckPermission\s*\)/g},
];

async function analyze(rel) {
  let text;
  try {
    text = await readFile(path.join(repoRoot, rel), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const total = (text.match(/checkPermission/g) ?? []).length;
  if (total === 0) return null;
  const count = patterns => Object.fromEntries(
    patterns.map(({id, re}) => [id, (text.match(re) ?? []).length]));
  const producers = count(PRODUCER_PATTERNS);
  const consumers = count(CONSUMER_PATTERNS);
  const producerTotal = Object.values(producers).reduce((a, b) => a + b, 0);
  return {
    file: rel, occurrences: total, producers, consumers, producerTotal,
    everSupplied: producerTotal > 0,
  };
}

const files = (await Promise.all(TARGETS.map(analyze))).filter(Boolean);
const producerTotal = files.reduce((sum, f) => sum + f.producerTotal, 0);

const report = {
  question: 'Does any shipped or reconstructed caller ever SUPPLY checkPermission to the file tools?',
  method: 'Static text analysis separating producers (assign the callback) from consumers (read it).',
  scope: 'Shipped bundles and reconstructed modules only. Not an execution trace; cannot prove absence in dynamically generated code.',
  files,
  producerTotalAcrossAllFiles: producerTotal,
  finding: producerTotal === 0
    ? 'No producer anywhere. Every call site is guarded by `context.checkPermission && ...`, so in the shipped 0.7.4 the per-file permission hook was inert: the guard short-circuits and all paths are allowed.'
    : 'At least one producer exists; the hook was live somewhere and the roadmap wording should be revisited.',
  consequenceForRoadmap: producerTotal === 0
    ? [
      'P1 is NOT restoring a regressed feature. It is authoring a control that never shipped, so there is no original behaviour to match and no user-visible regression to fix.',
      'The real file protection in 0.7.4 is workspace-root containment (canonicalizeWorkspaceRoots + realpath + containment checks), not per-file approval.',
      'Therefore the authorization-integration gate cannot be satisfied by "reconnecting" anything; it requires designing and accepting a new control, which is a product decision, not a recovery task.',
    ]
    : ['Re-examine: the roadmap assumption may hold.'],
  whatThisDoesNotClaim: [
    'It does not claim the author intended the hook to be dead; the parameter may have been staged for later use.',
    'It does not claim 0.7.4 was insecure: root containment still constrains reachable paths.',
    'It does not audit shell/terminal tools, which bypass file-tool checks entirely.',
  ],
};

console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--check') && producerTotal !== 0) {
  console.error('Expected zero producers; the shipped evidence changed.');
  process.exit(1);
}
