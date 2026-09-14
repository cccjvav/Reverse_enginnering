// RECONSTRUCTED from src/canonical-diff.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


var DEFAULT_CONTEXT_LINES = 3;

var MAX_MYERS_EDIT_DISTANCE = 1e4;

function decodeLines(bytes) {
  if (!bytes || bytes.byteLength === 0) return { lines: [], ends_with_newline: false };
  const buffer = Buffer.from(bytes);
  const hasBom = buffer.length >= 3 && buffer[0] === 239 && buffer[1] === 187 && buffer[2] === 191;
  const payload = hasBom ? buffer.subarray(3) : buffer;
  const normalized = payload.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const endsWithNewline = normalized.endsWith("\n");
  const body = endsWithNewline ? normalized.slice(0, -1) : normalized;
  return {
    lines: body.length === 0 ? [] : body.split("\n"),
    ends_with_newline: endsWithNewline
  };
}

function fallbackReplace(oldLines, newLines) {
  return [
    ...oldLines.map((line) => ({ kind: "delete", line })),
    ...newLines.map((line) => ({ kind: "insert", line }))
  ];
}

function backtrackMyers(trace, oldLines, newLines) {
  let x = oldLines.length;
  let y = newLines.length;
  const edits = [];
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    const left = v.get(k - 1) ?? Number.NEGATIVE_INFINITY;
    const right = v.get(k + 1) ?? Number.NEGATIVE_INFINITY;
    const previousK = k === -d || k !== d && left < right ? k + 1 : k - 1;
    const previousX = v.get(previousK) ?? 0;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      edits.push({ kind: "equal", line: oldLines[x] });
    }
    if (d === 0) break;
    if (x === previousX) {
      y -= 1;
      edits.push({ kind: "insert", line: newLines[y] });
    } else {
      x -= 1;
      edits.push({ kind: "delete", line: oldLines[x] });
    }
  }
  edits.reverse();
  return edits;
}

function myersDiff(oldLines, newLines) {
  if (oldLines.length === 0) return newLines.map((line) => ({ kind: "insert", line }));
  if (newLines.length === 0) return oldLines.map((line) => ({ kind: "delete", line }));
  const max = oldLines.length + newLines.length;
  const maxDistance = Math.min(max, MAX_MYERS_EDIT_DISTANCE);
  const v = /* @__PURE__ */ new Map();
  v.set(1, 0);
  const trace = [];
  for (let d = 0; d <= maxDistance; d += 1) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      const left = v.get(k - 1) ?? Number.NEGATIVE_INFINITY;
      const right = v.get(k + 1) ?? Number.NEGATIVE_INFINITY;
      let x = k === -d || k !== d && left < right ? right : left + 1;
      if (!Number.isFinite(x) || x < 0) x = 0;
      let y = x - k;
      while (x < oldLines.length && y < newLines.length && oldLines[x] === newLines[y]) {
        x += 1;
        y += 1;
      }
      v.set(k, x);
      if (x >= oldLines.length && y >= newLines.length) return backtrackMyers(trace, oldLines, newLines);
    }
  }
  return fallbackReplace(oldLines, newLines);
}

function diffLines(oldLines, newLines) {
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) {
    suffix += 1;
  }
  const prefixEdits = oldLines.slice(0, prefix).map((line) => ({ kind: "equal", line }));
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);
  const middleEdits = myersDiff(oldMiddle, newMiddle);
  const suffixEdits = suffix > 0 ? oldLines.slice(oldLines.length - suffix).map((line) => ({ kind: "equal", line })) : [];
  return [...prefixEdits, ...middleEdits, ...suffixEdits];
}

function annotateEdits(edits) {
  let oldLine = 1;
  let newLine = 1;
  return edits.map((edit) => {
    const annotated = { ...edit, old_line: oldLine, new_line: newLine };
    if (edit.kind !== "insert") oldLine += 1;
    if (edit.kind !== "delete") newLine += 1;
    return annotated;
  });
}

function formatRange(start, count) {
  return `${start},${count}`;
}

function renderHunks(edits, contextLines = DEFAULT_CONTEXT_LINES) {
  const changeIndices = edits.map((edit, index) => edit.kind === "equal" ? -1 : index).filter((index) => index >= 0);
  if (changeIndices.length === 0) return [];
  const groups = [];
  for (const changeIndex of changeIndices) {
    const start = Math.max(0, changeIndex - contextLines);
    const end = Math.min(edits.length, changeIndex + contextLines + 1);
    const previous = groups.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else groups.push({ start, end });
  }
  const annotated = annotateEdits(edits);
  const output = [];
  for (const group of groups) {
    const slice = annotated.slice(group.start, group.end);
    const oldCount = slice.filter((edit) => edit.kind !== "insert").length;
    const newCount = slice.filter((edit) => edit.kind !== "delete").length;
    const first = slice[0];
    const oldStart = oldCount === 0 ? first.old_line - 1 : first.old_line;
    const newStart = newCount === 0 ? first.new_line - 1 : first.new_line;
    output.push(`@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@`);
    for (const edit of slice) {
      const marker = edit.kind === "equal" ? " " : edit.kind === "delete" ? "-" : "+";
      output.push(`${marker}${edit.line}`);
    }
  }
  return output;
}

function renderFileDiff(file) {
  const oldPath = file.old_path ?? file.new_path ?? "unknown";
  const newPath = file.new_path ?? file.old_path ?? "unknown";
  const oldDecoded = decodeLines(file.old_bytes);
  const newDecoded = decodeLines(file.new_bytes);
  const edits = diffLines(oldDecoded.lines, newDecoded.lines);
  const hunks = renderHunks(edits);
  const output = [];
  if (file.action === "move") {
    output.push(`rename from ${oldPath}`, `rename to ${newPath}`);
  }
  output.push(
    `--- ${file.action === "add" ? "/dev/null" : `a/${oldPath}`}`,
    `+++ ${file.action === "delete" ? "/dev/null" : `b/${newPath}`}`
  );
  output.push(...hunks);
  return output;
}

function createCanonicalUnifiedDiff(files) {
  return files.flatMap((file, index) => [
    ...index > 0 ? [""] : [],
    ...renderFileDiff(file)
  ]).join("\n");
}

export { DEFAULT_CONTEXT_LINES, MAX_MYERS_EDIT_DISTANCE, annotateEdits, backtrackMyers, createCanonicalUnifiedDiff, decodeLines, diffLines, fallbackReplace, formatRange, myersDiff, renderFileDiff, renderHunks };
