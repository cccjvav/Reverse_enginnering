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

## Done so far

`reconstructed/bridge-core/types/managed-command-cancellation.d.ts` — the
highest-`any` Tier A module (109). Verified two ways:

- the author's own construction site (`ide-tool-broker.ts:1712`, reproduced
  verbatim including its getters) typechecks against it with 0 errors
- a negative probe confirms the types actually constrain: unknown members and
  wrong assignments are rejected

Notably `ManagedCommandCancellationRequest.forceConfirmed` is documented as
never defaultable, because the implementation throws
`FORCE_CONFIRMATION_REQUIRED` without it — a safety property a guessed type
would have quietly dropped. A test pins that.
