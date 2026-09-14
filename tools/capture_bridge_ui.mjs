// Capture only classes containing ShunCode Bridge command IDs, not VS Code itself.
import { parse } from 'acorn';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const variant = process.argv[3] ?? 'workbench';
if (!['workbench','sessions'].includes(variant)) throw new Error('Unknown host');
const relative = variant === 'workbench' ? 'out/vs/workbench/workbench.desktop.main.js' : 'out/vs/sessions/sessions.desktop.main.js';
const file = path.join(process.argv[2], 'code$GetDestDir/resources/app',relative);
const bytes = await readFile(file);
const text = bytes.toString('utf8');
const targets = [...text.matchAll(/shuncode\.bridge\.(?:access\.getStatus|license\.[A-Za-z]+|payment\.[A-Za-z]+)/g)]
  .map(m => ({ command: m[0], offset: m.index }));
const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
const owners = new Map();
const declarations = [];
const classes = [];
const stack = [ast];
while (stack.length) {
  const node = stack.pop();
  if (!node || typeof node !== 'object') continue;
  if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && targets.some(t => t.offset >= node.start && t.offset < node.end)) declarations.push(node);
  if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') {
    classes.push(node);
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
// Command literals are often hoisted into an enum/object outside the UI class.
// Follow references to those binding names instead of assuming literals are in methods.
const bindings = [...new Set(declarations.map(n => n.id.name))];
const selected = new Map([...owners.values()].map(n => [n.start,n]));
for (const cls of classes) {
  const pending = [cls]; let hit = false;
  while (pending.length && !hit) {
    const n = pending.pop();
    if (n?.type === 'Identifier' && bindings.includes(n.name)) { hit = true; break; }
    for (const v of Object.values(n ?? {})) {
      if (Array.isArray(v)) { for (const c of v) if (c?.type) pending.push(c); }
      else if (v?.type) pending.push(v);
    }
  }
  if (hit) selected.set(cls.start,cls);
}
const suffix = variant === 'sessions' ? '-sessions' : '';
const out = 'recovered/bridge-ui'+suffix;
await mkdir(out, { recursive: true });
const unique = [...selected.values()].sort((a,b) => a.start-b.start);
const report = { origin: relative, sha256: createHash('sha256').update(bytes).digest('hex'),
  scope: 'Compiled custom UI class excerpts, not original TypeScript; offsets are UTF-16 JavaScript string positions.', constant_bindings: bindings, constants: [], classes: [], unmatched: targets.filter(t => !owners.has(t.offset)) };
let total = 0;
for (const [index, node] of declarations.entries()) {
  const name = `bridge-constants-${index + 1}.js.txt`;
  const snippet = text.slice(node.start,node.end);
  total += Buffer.byteLength(snippet);
  if (total > 3_000_000) throw new Error('Constants capture budget exceeded');
  await writeFile(path.join(out,name),snippet);
  report.constants.push({file:name,name:node.id.name,start:node.start,end:node.end,sha256:createHash('sha256').update(snippet).digest('hex')});
}
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
await writeFile('docs/evidence/bridge-ui'+suffix+'.json', JSON.stringify(report, null, 2) + '\n');
console.log(`Captured ${unique.length} custom UI classes (${total} bytes)`);
