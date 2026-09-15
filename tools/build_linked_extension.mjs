// Experimental source linkage only. Never loads the emitted extension or installs it.
import { build } from 'esbuild';
import { parse } from 'acorn';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, hash } from './patch_utils.mjs';

const ORIGINAL_ROOT = 'recovered/shuncode-extension';
const CORE_ROOT = 'reconstructed/bridge-core';
const OUTPUT = '.work/linked-extension';
export const EXTERNAL_PACKAGES = ['vscode', '@modelcontextprotocol/server', '@modelcontextprotocol/node', 'https-proxy-agent'];
const builtins = new Set(builtinModules.flatMap(n => [n, 'node:' + n]));
const portable = p => p.split(path.sep).join('/');
export function verifySource(bytes, expected, source) {
  if (!expected || hash(bytes) !== expected) throw new Error(`Source integrity mismatch: ${source}`);
}
export function communityEntry(text) {
  text = text.replaceAll('\r\n', '\n');
  const start = text.indexOf('  const authorizeBridgeStart = async () => {');
  const end = text.indexOf('\n  const bridge = new BridgeManager', start);
  if (start < 0 || end < 0 || text.indexOf('  const authorizeBridgeStart = async () => {', start + 1) >= 0) throw new Error('Unexpected community entry boundaries');
  text = text.slice(0, start) + '  const authorizeBridgeStart = async () => {\n    await bridgeLicense.requireFeature("bridge");\n  };' + text.slice(end);
  const retired = '      await vscode.workspace.getConfiguration("shuncode.bridge").update("persistentMode", false, vscode.ConfigurationTarget.Global);\n';
  if (text.split(retired).length !== 2) throw new Error('Unexpected legacy sign-out source');
  return text.replace(retired, '');
}
export async function buildLinkedExtension({ write = false } = {}) {
  const original = JSON.parse(await readFile(path.join(ROOT, 'docs/evidence/custom-extension.json'), 'utf8'));
  const core = JSON.parse(await readFile(path.join(ROOT, CORE_ROOT, 'provenance.json'), 'utf8'));
  const expected = new Map(original.copied.map(e => [ORIGINAL_ROOT + '/' + e.path, e.sha256]));
  for (const module of core.modules) expected.set(CORE_ROOT + '/' + module.file, module.sha256);
  const sourceRecords = new Map(), resolutions = [], externals = new Set();
  const plugin = {
    name: 'reviewed-source-linkage',
    setup(builder) {
      builder.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/src\// }, args => {
        const importer = portable(path.relative(ROOT, args.importer));
        if (!importer.startsWith(ORIGINAL_ROOT + '/src/')) throw new Error('Unexpected shared importer');
        const name = path.posix.basename(args.path);
        if (args.path !== '../../../src/' + name || !/^[a-z0-9-]+\.[cm]?js$/.test(name)) throw new Error('Unexpected shared target');
        const target = CORE_ROOT + '/src/' + name;
        if (!expected.has(target)) throw new Error(`Unrecovered shared target: ${args.path}`);
        resolutions.push({ importer, requested: args.path, linkedTo: target });
        return { path: path.join(ROOT, target) };
      });
      builder.onResolve({ filter: /^[^./]|^\// }, args => {
        if (path.isAbsolute(args.path)) return;
        if (portable(path.relative(ROOT, args.importer)).startsWith('node_modules/')) return;
        if (builtins.has(args.path)) { externals.add(args.path); return { path: args.path, external: true }; }
        if (!EXTERNAL_PACKAGES.includes(args.path)) throw new Error(`Unreviewed external dependency: ${args.path}`);
        if (args.path === 'vscode') { externals.add(args.path); return { path: args.path, external: true }; }
        return; // Resolve the three exact root-lockfile packages normally and bundle them.
      });
      builder.onLoad({ filter: /\.[cm]?[jt]s$/ }, async args => {
        const source = portable(path.relative(ROOT, args.path));
        if (source.startsWith('node_modules/')) return;
        if (!expected.has(source)) throw new Error(`Unreviewed source input: ${source}`);
        const originalBytes = await readFile(args.path);
        verifySource(originalBytes, expected.get(source), source);
        let text = originalBytes.toString('utf8'), replacementSource = null;
        if (source === ORIGINAL_ROOT + '/src/extension.ts') text = communityEntry(text);
        for (const name of ['bridge-license-service', 'bridge-access-controller']) {
          if (source === ORIGINAL_ROOT + '/src/' + name + '.ts') {
            replacementSource = 'community/extension/src/' + name + '.ts';
            text = await readFile(path.join(ROOT, replacementSource), 'utf8');
          }
        }
        if (source === CORE_ROOT + '/src/snapshot-packaged-ripgrep.js') {
          // The CJS output lives in dist/, so retain the installed layout rather
          // than embedding the recovery repository's absolute path or import.meta.
          text = 'const rgPath = require("node:path").join(__dirname, "..", "runtime", "bin", "rg.exe");\nexport { rgPath };\n';
        }
        sourceRecords.set(source, { source, originalSha256: hash(originalBytes), loadedSha256: hash(text), replacementSource,
          transformation: replacementSource ? 'community-policy-replacement' : source.endsWith('/src/extension.ts') ? 'community-entry-rewrite' : source.endsWith('/snapshot-packaged-ripgrep.js') ? 'explicit-CJS-installed-asset-layout' : 'none' });
        return { contents: text, loader: /\.[cm]?ts$/.test(source) ? 'ts' : 'js', resolveDir: path.dirname(args.path) };
      });
    }
  };
  const result = await build({ absWorkingDir: ROOT, entryPoints: [ORIGINAL_ROOT + '/src/extension.ts'],
    outfile: OUTPUT + '/dist/extension.cjs', bundle: true, write: false, platform: 'node', format: 'cjs',
    target: 'node22', metafile: true, sourcemap: false, logLevel: 'silent', plugins: [plugin] });
  if (result.warnings.length) throw new Error('Linkage warnings require review: ' + result.warnings.map(w => w.text).join('; '));
  if (result.outputFiles.length !== 1) throw new Error('Unexpected linkage output count');
  const bytes = result.outputFiles[0].contents, code = Buffer.from(bytes).toString('utf8');
  parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
  for (const forbidden of ['SHUNCODE_BRIDGE_LICENSE_SMOKE_BYPASS', 'PAYMENT_POLL_INTERVAL_MS', 'LICENSE_REVALIDATION_INTERVAL_MS', '/v1/payments']) {
    if (code.includes(forbidden)) throw new Error(`Retired commercial implementation remains: ${forbidden}`);
  }
  for (const output of Object.values(result.metafile.outputs)) for (const item of output.imports) {
    if (item.external) {
      if (item.path !== 'vscode' && !builtins.has(item.path)) throw new Error(`Unbundled npm dependency: ${item.path}`);
      externals.add(item.path);
    }
  }
  const dependencyInputs = [];
  for (const input of Object.keys(result.metafile.inputs).sort()) {
    const name = portable(input);
    if (name.startsWith('node_modules/')) dependencyInputs.push({ source: name, sha256: hash(await readFile(path.join(ROOT, name))) });
  }
  const dependencyVersions = {};
  for (const name of [...EXTERNAL_PACKAGES.filter(n => n !== 'vscode'), 'supports-color']) {
    const pkg = JSON.parse(await readFile(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8'));
    dependencyVersions[name] = { version: pkg.version, license: pkg.license };
  }
  const inputs = [...sourceRecords.values()].sort((a, b) => a.source.localeCompare(b.source, 'en'));
  if (inputs.some(i => i.source.includes('/dist/'))) throw new Error('Linked output must not embed the original compiled extension');
  const report = { scope: 'Experimental CJS linkage from preserved TS/MTS and reconstructed JS, using community policy. NOT a typecheck, self-contained extension package, activation test or installer.',
    output: OUTPUT + '/dist/extension.cjs', outputSha256: hash(bytes), outputBytes: bytes.length,
    inputs, sharedResolutions: resolutions.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')),
    externalImports: [...externals].sort(),
    dependencyInputs, dependencyVersions, lockfileSha256: hash(await readFile(path.join(ROOT, 'package-lock.json'))),
    declaredNpmDependenciesBundled: true, originalDependencyVersionIdentityProven: false, fullTypecheckPassed: false, extensionLoaded: false,
    guiTested: false, installerBuilt: false, originalSourcesModified: false,
    unresolvedRuntimeRequirements: ['Matching VS Code host and proposed APIs', 'Runtime compatibility of the pinned candidate SDK packages',
      'Dynamic Electron net and node-pty module resolution', 'Agent host runtime entry and child process assets',
      'PortableGit Bash, tunnel executables and ripgrep in the installed layout', 'Host authorization and file-access race mitigations'],
    summary: { inputs: inputs.length, sharedResolutions: resolutions.length, communityPolicyReplacements: inputs.filter(i => i.replacementSource).length } };
  if (write) {
    await mkdir(path.join(ROOT, OUTPUT, 'dist'), { recursive: true });
    await writeFile(path.join(ROOT, report.output), bytes);
    await writeFile(path.join(ROOT, OUTPUT, 'linkage.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return { code, report };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { report } = await buildLinkedExtension({ write: !process.argv.includes('--check') });
  const evidence = path.join(ROOT, 'docs/evidence/linked-extension.json');
  const text = JSON.stringify(report, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (await readFile(evidence, 'utf8') !== text) throw new Error('Linkage evidence drift');
  } else await writeFile(evidence, text);
  console.log(JSON.stringify({ ...report.summary, outputBytes: report.outputBytes, fullTypecheckPassed: false, extensionLoaded: false }, null, 2));
}
