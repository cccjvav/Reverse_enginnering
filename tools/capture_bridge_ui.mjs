// Capture only classes containing ShunCode Bridge command IDs, not VS Code itself.
import { parse } from 'acorn';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const file = path.join(process.argv[2], 'code$GetDestDir/resources/app/out/vs/workbench/workbench.desktop.main.js');
const bytes = await readFile(file);
const text = bytes.toString('utf8');
const targets = [...text.matchAll(/shuncode\.bridge\.(?:access\.getStatus|license\.[A-Za-z]+|payment\.[A-Za-z]+)/g)]
  .map(m => ({ command: m[0], offset: m.index }));
const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
const owners = new Map();
const stack = [ast];
while (stack.length) {
  const node = stack.pop();
  if (!node || typeof node !== 'object') continue;
  if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') {
    for (const target of targets) {
      if (target.offset >= node.start && target.offset < node.end) {
        const prev = owners.get(target.offset);
        if (!prev || node.end - node.start < prev.end - prev.start) owners.set(target.offset, node);
      }
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) if (child?.type) stack.push(child); }
    else if (value?.type) stack.push(value);
  }
}
const out = 'recovered/bridge-ui';
await mkdir(out, { recursive: true });
const unique = [...new Map([...owners.values()].map(n => [n.start, n])).values()].sort((a,b) => a.start-b.start);
const report = { origin: 'out/vs/workbench/workbench.desktop.main.js', sha256: createHash('sha256').update(bytes).digest('hex'),
  scope: 'Compiled custom UI class excerpts, not original TypeScript; offsets are UTF-16 JavaScript string positions.', classes: [], unmatched: targets.filter(t => !owners.has(t.offset)) };
let total = 0;
for (const [index, node] of unique.entries()) {
  const snippet = text.slice(node.start, node.end);
  total += Buffer.byteLength(snippet);
  if (total > 3_000_000) throw new Error('UI capture exceeds budget; refine selectors');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bghp_[a-zA-Z0-9]{36}\b/.test(snippet)) throw new Error('Possible credential in UI; review before publication');
  const name = `bridge-ui-${index + 1}.js.txt`;
  await writeFile(path.join(out, name), snippet);
  report.classes.push({ file: name, start: node.start, end: node.end, size: Buffer.byteLength(snippet),
    sha256: createHash('sha256').update(snippet).digest('hex'),
    methods: node.body.body.filter(m => m.type === 'MethodDefinition').map(m => m.key.name ?? m.key.value),
    commands: [...new Set(targets.filter(t => owners.get(t.offset)?.start === node.start).map(t => t.command))] });
}
await writeFile('docs/evidence/bridge-ui.json', JSON.stringify(report, null, 2) + '\n');
console.log(`Captured ${unique.length} custom UI classes (${total} bytes)`);
