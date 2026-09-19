# Step 3: the project skeleton

## The layout was recovered, not designed

The goal was never "find a directory structure that compiles". It was to restore
the one ShunCode was actually built in, because that is what lets the recovered
sources fit together without editing them.

The evidence is the shipped `extensions/shuncode/tsconfig.json` — **the author's
real build configuration**, which was packaged with the product. Its relative
paths pin the tree exactly:

```
<root>/
  src/                      41 bridge-core modules
  extensions/shuncode/
    src/                    34 recovered .ts
    tsconfig.json           the author's own, used verbatim
  vscode-main/src/vscode-dts/   Code OSS declarations
  node_modules/@types/
```

**The cross-check that proves the reading.** Two different spellings appear in
the sources: `../../src/x.ts` in the tsconfig, and `../../../src/x.js` in the
`.ts` files themselves. They differ by one level — but they start from
directories that also differ by one level, so both normalise to `<root>/src/x`.
Self-consistent. (I initially misread this as needing an extra nesting level,
and the arithmetic corrected me.)

## Why this is a stronger result than the earlier diagnostics

The previous type checks drove TypeScript through a **custom module resolver**
that rewrote `../../../src/x.js` onto declaration files by hand. That proves the
declarations are usable; it does not prove the structure is right, because the
resolver was papering over the layout.

`npm run diagnose:skeleton` runs the author's shipped tsconfig **as written**,
with no custom resolution, against a tree assembled at the paths it expects:

| | Result |
| --- | --- |
| Files compiled | 30 |
| **Unresolved modules** | **0** |
| `layoutResolves` | **true** |
| Errors | 14 |

Zero unresolved imports means every cross-layer reference found its target
through ordinary Node resolution. The layout is correct.

And the check has teeth: removing one B-layer module from the tree flips it to
`unresolved=1, layoutResolves=false`.

## The 14 remaining errors are not ours

| File | Count | Cause |
| --- | --- | --- |
| `tool-presentation.ts` | 11 | The pinned **public** `vscode.d.ts` has no custom Chat result fields (`items`, `metrics`, `diffPreview`, `presentationKind`). The author's private host had them. |
| `bridge-mcp-transport.ts` | 3 | MCP SDK transport options differ from the version the author built against. |

Two independent routes — the custom-resolver linkage and this unmodified
tsconfig — report **the same 14 errors in the same two files**. Neither is a
B-layer typing gap.

## What was never recovered

The author's tsconfig lists three files that did not ship, and the report keeps
them visible rather than quietly dropping them:

- `../../src/file-tool-registry.ts` and `../../src/ide-tool-definitions.ts` —
  two B-layer modules we hold only as compiled `.js`, reached via their `.d.ts`
- `test/workspace-hub-store.test.ts`

## What this does not claim

Typechecking is not building. This produces no bundle, runs no `npm install`,
and does not touch the Code OSS carrier. The host declarations are the pinned
**public** candidates, not the author's private host — which is exactly why
`tool-presentation.ts` still fails.
