# Step 2: making the rebuilt B-layer editable

## The situation, stated accurately

`reconstructed/bridge-core/src` holds 41 modules recovered at compile-output
level: **392 exported symbols**, no types. They can be read, but not edited with
any confidence, because nothing tells you what a parameter is.

**This is not the clipboard situation.** That adaptation was *recovered* — the
shipped `out/main.js` is unminified, so the author's code could be transcribed.
Here the original `.ts` is genuinely gone:

- the installer ships **no source maps** (`inventory.maps_total == 0`)
- none of the 41 module stems appear among the 28 recovered `.ts` files
- types are erased at compile time, so no amount of reading the JS returns them

So these types must be **reconstructed from use**, and labelled that way.

## Why "41 of 41 modules have .d.ts" would be a fake metric

Running `tsc --declaration` over the tree succeeds immediately and emits all 41
declaration files. It looks finished. It is not: **995 occurrences of `any`**.

The honest baseline, measured by `tools/diagnose_btypes.py`:

| Metric | Value |
| --- | --- |
| Exported declarations | 354 |
| Carrying a real type (no `any`) | **116 (32.8%)** |
| `any` occurrences | 995 |

Worst offenders: `apply-patch` (118 `any`), `search-files` (114),
`managed-command-cancellation` (109), `file-tool-registry` (94), `find-files` (94).

## Evidence tiers

`tools/harvest_btype_evidence.py` inventories what survived, keeping fact and
inference apart:

- **Tier A — first-hand.** The author's 34 recovered `.ts` files import these
  modules and annotate the results: **24 of 41 modules**, 51 value symbols and
  **9 type names the author actually wrote**, including the generic arity
  (`BridgeActivitySnapshot<BridgeActivityPresentation>`). Authoritative.
- **Tier B — structural.** JSON Schemas embedded as runtime values in 3 modules.
  They survived compilation and pin input shapes exactly.
- **Tier C — inferred.** What `tsc` derives from the JS. Collapses to `any`
  wherever it cannot tell.

17 modules are referenced by no author source at all; those are reconstruction
from behaviour alone and are marked as such.

## Approach

Work highest-evidence first, and make each declaration carry its own
justification so a later reader can audit it:

1. Modules with Tier A type names (authoritative spellings and shapes).
2. Modules with Tier B schemas (exact input contracts).
3. Behaviour-only modules last, explicitly flagged as reconstruction.

A wrong-but-plausible type is worse than `any`, because it stops the compiler
from asking the question. Where evidence runs out, the type says so.

## Cross-checking declarations against the code

A declaration compiles whether or not it matches the JavaScript it describes, so
`npm run check:btypes` compares every exported function's parameter list against
its implementation. It has caught six real defects so far, including
`isInsideRoot` declared with its two arguments **reversed** — which would have
sent callers' arguments through backwards while compiling perfectly — and three
separate invented parameters (`asObjectRow(label)`, `validateGlob(label)`,
`stagePlans(signal)`).

112 functions now cross-check clean. The tool reports its own limits: class
methods, re-exports and const-assigned arrows are out of scope, so a clean run
is not proof of full agreement.

## A mistake worth recording

While typing `custom-tool-admin` I gave `CustomToolToggleResult` a `path` field.
It was plausible — the function does write a file — and it was simply **not
there**: the return literal is `{ name, enabled }`. Caught by reading the actual
`return` statement instead of reasoning about what the function ought to expose.

That is precisely the failure mode this plan warns about, so it is recorded
rather than quietly corrected. The negative probe now asserts the field does not
exist.

## Done so far

Coverage has moved **32.8% → 83.7%** (116/354 → 323/386 declarations), measured
by `tools/diagnose_btypes.py` rather than asserted. Twelve modules typed, each measuring 0 `any` — this now covers **every Tier A
module whose types the author's own sources name**:

| Module | Was | Now |
| --- | --- | --- |
| `managed-command-cancellation` | 109 `any` | 19/19 typed |
| `file-tool-registry` | 94 `any` | 29/29 typed |
| `custom-tool-skill` | 53 `any` | 28/28 typed |
| `custom-tools` | 14 `any` | 13/13 typed |
| `custom-tool-contract` | — | 13/13 typed |
| `bridge-activity-tracker` | — | 6/6 typed |
| `custom-tool-sandbox` | — | 4/4 typed |
| `concurrency` | 20 `any` | 4/4 typed |
| `bridge-session-registry` | 17 `any` | 2/2 typed |
| `custom-tool-skill-import` | 27 `any` | 20/20 typed |
| `bridge-coordination-validation` | 17 `any` | 9/9 typed |
| `bridge-http-router` | 16 `any` | 9/9 typed |
| `file-tool-input-compat` | 27 `any` | 15/15 typed |
| `tool-input-validation` | 16 `any` | 8/8 typed |
| `custom-tool-admin` | 10 `any` | 6/6 typed |
| `bridge-event-store` | 10 `any` | 3/3 typed |
| `jsonrpc-request-id-registry` | 9 `any` | 8/8 typed |
| `adaptive-concurrency` | 9 `any` | 6/6 typed |

Three findings worth keeping, none of which the JavaScript alone would give up:

- **`BridgeActivitySnapshot` is generic** in its presentation payload. Only the
  author's use site (`bridge-tool-dispatcher.ts:126`) reveals the arity; a
  non-generic reconstruction would have been confidently wrong.
- **`workspaceRoots` may be a thunk.** `invokeFileTool` resolves it lazily so a
  root-resolution failure is enveloped as a tool error rather than thrown, and
  the author depends on it ("Lazy on purpose").
- **`FileToolResult.content` is optional**, evidenced by the author's
  `result.content ?? [...]` fallback — a mandatory field makes that dead code.
- **`SkillLoadDiagnosis` is a discriminated union** on `loaded`, and its failure
  branch keeps `name` optional because the author hand-builds a `duplicate-name`
  failure that still carries the clashing name (`bridge-server.ts:310`).
- **`BridgeSessionRegistry` is generic** in the session type, and its destroy
  reason is deliberately a widened `string`: the module emits four values, but
  the author passes `"bridge-shutdown"` and `"initialize-error"` from the
  extension, so a closed union would reject their own code.
- **`Semaphore.setLimit` never revokes held permits**, so `active` can exceed
  `limit` until in-flight work drains — documented on the type, because a caller
  assuming otherwise would be wrong.
- **`SkillRunnerResult` is a discriminated union** on `generated`: the shipped
  code returns two differently-shaped literals, and `runnerRel` exists only on
  the generated branch. A single interface with an optional field would have
  flattened that and let callers read a field that isn't there.
- **`normalizeFileToolInput` returns `unknown`, not a record.** The author's own
  cast (`as Record<string, unknown>`, `bridge-tool-dispatcher.ts:301`) is the
  proof: non-objects pass straight through, so the tidier-looking return type
  would contradict their code.
- **`validateToolInput` enforces only a subset of JSON Schema.** `$ref`,
  `oneOf`, `allOf`, `anyOf`, `pattern` and `format` are accepted silently. The
  type says so, because a caller assuming full validation would be trusting a
  check that never runs.
- **`findCustomTool` returns `| undefined`** — the author's own wrapper declares
  that return type (`bridge-tool-dispatcher.ts:219`), and disabled tools are
  invisible to it, so a caller cannot accidentally execute one.

Each declaration is verified two ways:

- the author's own construction site (`ide-tool-broker.ts:1712`, reproduced
  verbatim including its getters) typechecks against it with 0 errors
- a negative probe confirms the types actually constrain: unknown members and
  wrong assignments are rejected

Notably `ManagedCommandCancellationRequest.forceConfirmed` is documented as
never defaultable, because the implementation throws
`FORCE_CONFIRMATION_REQUIRED` without it — a safety property a guessed type
would have quietly dropped. A test pins that.
