import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function applyEdits(text, edits) {
  let boundary = text.length;
  for (const edit of [...edits].sort((a,b) => b.start-a.start)) {
    if (edit.start < 0 || edit.end > boundary || edit.start > edit.end) throw new Error('Overlapping/invalid patch spans');
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    boundary = edit.start;
  }
  return text;
}
export function allNodes(ast) {
  const nodes = [], stack = [ast];
  while (stack.length) {
    const n = stack.pop(); if (!n?.type) continue; nodes.push(n);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) { for (const c of v) if (c?.type) stack.push(c); }
      else if (v?.type) stack.push(v);
    }
  }
  return nodes;
}
export function only(nodes, predicate, label) {
  const matches = nodes.filter(predicate);
  if (matches.length !== 1) throw new Error(`${label}: expected exactly one match, got ${matches.length}`);
  return matches[0];
}
