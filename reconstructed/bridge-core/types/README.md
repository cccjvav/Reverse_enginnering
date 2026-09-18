# Hand-written types for the rebuilt B-layer

`../src` holds 41 modules recovered at compile-output level. The original
TypeScript was never shipped, so these declarations are **reconstructed from
use**, not read back from the product. That distinction is load-bearing and each
file records it: see the `PROVENANCE` block at the top of every `.d.ts`.

Evidence tiers, and why a type here can be trusted:

- **FIRST-HAND** — the name or shape appears in the author's own recovered
  `.ts` files (`recovered/shuncode-extension/src`). Authoritative, including
  spellings and generic arity.
- **OBSERVED** — read off the shipped implementation in `../src`: object
  literals, value domains, guard conditions.
- **INFERRED** — deduced from how a value is consumed. Stated as such.

Where evidence runs out the declaration says so rather than inventing a shape;
a plausible wrong type is worse than `unknown`, because it stops the compiler
from asking.

Each file is verified two ways before landing:

1. the author's real call site typechecks against it, reproduced verbatim
2. a negative probe confirms the type actually rejects mistakes

`tools/diagnose_btypes.py` tracks the honest coverage number.
