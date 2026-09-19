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
| `tool-presentation.ts` | 11 | The author built against a **forked** Code OSS host — see below. |
| `bridge-mcp-transport.ts` | 3 | **Not** SDK drift — a latent header bug, see below. Already fixed in `community/`. |

Two independent routes — the custom-resolver linkage and this unmodified
tsconfig — report **the same 14 errors in the same two files**. Neither is a
B-layer typing gap.

## The Chat host gap, measured

`npm run probe:host-chat` quantifies the 11 errors instead of guessing at them:

- the public `ChatSimpleToolResultData` declares exactly **two** members,
  `input` and `output`
- the author's sources rely on **five more**: `items`, `metrics`, `diffPreview`,
  `presentationKind`, `presentationStyle`

The decisive evidence is how they write it:

```ts
items?: NonNullable<vscode.ChatSimpleToolResultData["items"]>
```

That only compiles if **their** `vscode.d.ts` declared `items`. They were
building against a forked host, not the public proposed API. And the fields were
real, not aspirational — the shipped bundle constructs all five at runtime
(`items` 53×, `metrics` 10×, `diffPreview` 3×).

**The shapes are now reconstructed.** `npm run verify:host-shapes` proves it:
all five field shapes were read out of the author's own type annotations — they
annotated their locals against the host type, e.g.

```ts
const items: Array<{ label: string; description?: string;
                     resource?: vscode.Uri | vscode.Location }> = [];
let currentHunk: NonNullable<...["diffPreview"]>[number]["hunks"][number];
```

Those annotations had to match the real declaration to compile, so they are
first-hand evidence of it. The reconstruction is verified by compiling the
author's real code against it verbatim, and three tampering tests confirm the
check can fail.

One subtlety worth recording: a two-way `extends` check does **not** catch a
missing optional member — TypeScript treats `{ label }` and
`{ label; description? }` as mutually assignable. The first version of the probe
passed while `description` was deleted. Comparing key sets via `keyof` is what
actually catches it.

Graded confidence: `presentationStyle` is low — only one literal is ever used,
so the real domain may be wider. And the bundle contains a second copy of
`parseUnifiedDiffPreview` building `{ oldPath, newPath, hunks }` instead of
`{ path, hunks }`; that discrepancy is recorded, not resolved.

**Why this is still not "fixed".** Declaring those members ourselves would turn 11 red
errors green while recovering nothing, and would put fabricated fields on the
public `vscode` namespace. That is precisely the false-host claim this project
refuses to make, so a test now guards the pinned declarations against being
edited. The error floor stays at 11 until the author's host declarations are
actually obtained — the number measures a missing input, not a defect.

## The three transport errors were misdiagnosed

I had filed these as MCP SDK version drift. That was wrong, and checking beat
assuming: the shipped bundle, the rebuilt snapshot module and the installed SDK
all report `LATEST_PROTOCOL_VERSION = "2025-11-25"`. No drift at all.

The real cause is a **latent defect in the shipped product**. The router reads
four custom headers straight off `request.headers`, which Node types
`string | string[] | undefined` because HTTP permits a header to repeat. The
guard is only:

```js
if (!sessionId) { ...400... }
await handlers.handleGet(request, response, sessionId);
```

An emptiness check excludes `undefined`. It does **not** exclude `string[]`. The
author's handlers declare `sessionId: string`, so a client sending a duplicated
`Mcp-Session-Id` hands them an array. Typechecking the recovered sources honestly
is what exposed it.

**It was already fixed.** Before writing a patch I checked, and
`community/bridge-core/http-router.mjs` already answers 400 "Ambiguous MCP
protocol header" for exactly this case. So the skeleton has two modes:

| Mode | Errors | Meaning |
| --- | --- | --- |
| default | 14 | faithful to the shipped router, which really can pass `string[]` |
| `--maintenance` | **11** | with the community adapter's guarantee in front |

The narrowed declaration is only true when that adapter is present, so the
generated file says so in its own header rather than leaving a reader to assume
it holds unconditionally.

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
