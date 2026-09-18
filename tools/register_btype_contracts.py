#!/usr/bin/env python3
"""Register the hand-written B-layer declarations as type contracts.

Two sets of declarations for the same modules existed side by side: an earlier
`reconstructed/type-contracts/` covering 14 modules, and the 37 written during
step 2 under `reconstructed/bridge-core/types/`. Only the first set was wired
into `tools/diagnose_linked_types.mjs`, so the newer work was not actually being
exercised by anything that links the extension against the rebuilt core.

This writes a SECOND index covering the step-2 declarations, which are a strict
superset: the same 14 modules plus 23 more. It deliberately does not overwrite
the original - those files are imported by path in the existing tests, which
also assert a contract count of 14, so replacing the index broke them.

Comparing the two sets was the valuable part. The older declarations were right
about several things the newer ones had wrong, and those corrections are folded
into the step-2 files:

  * PerOwnerCancellationRateLimiter takes six positional arguments, not an
    options bag
  * ManagedCommandCanceller accepts an injectable waitForGrace plus six limits
  * bridgeManagedCommandOwnerId accepts `string | undefined` and throws
  * the HTTP handlers receive raw Node header values, `string | string[]`

Both indexes use the same shape, so the existing integrity checking works for
either.
"""

import argparse
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TYPES = REPO / "reconstructed" / "bridge-core" / "types"
SRC = REPO / "reconstructed" / "bridge-core" / "src"
# A SEPARATE index. The original reconstructed/type-contracts/provenance.json is
# load-bearing: tests import those .d.ts files by path and assert a module count
# of 14, and overwriting it broke four of them. The step-2 declarations are
# registered alongside instead, so both sets can be measured independently.
PROVENANCE = REPO / "reconstructed" / "bridge-core" / "types" / "provenance.json"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true",
                        help="verify the index is current without rewriting it")
    args = parser.parse_args()

    modules = []
    for decl in sorted(TYPES.glob("*.d.ts")):
        stem = decl.name.removesuffix(".d.ts")
        impl = SRC / f"{stem}.js"
        if not impl.exists():
            continue
        modules.append({
            # Relative to the repository root: these live outside
            # reconstructed/type-contracts/, unlike the original batch.
            "declaration": decl.name,
            "sha256": sha256(decl),
            "implementation": f"reconstructed/bridge-core/src/{stem}.js",
            "implementationSha256": sha256(impl),
        })

    report = {
        "scope": ("Candidate type declarations for the rebuilt bridge-core "
                  "modules, hand-written during step 2 and hash-pinned to the "
                  "implementations they describe. Reconstruction from use, not "
                  "recovered original types: see the PROVENANCE block in each "
                  "declaration for which parts rest on first-hand evidence."),
        "declarationRoot": "reconstructed/bridge-core/types",
        "relationshipToOriginalContracts": (
            "Superset of reconstructed/type-contracts (14 modules): same "
            "coverage plus 23 more. Kept separate because the original files "
            "are imported by path in tests/bridge-core-type-contracts.test.mjs "
            "and tests/bridge-core-http-linkage.test.mjs."),

        "verification": ("npm run verify:btypes typechecks every declaration "
                         "under strict mode; npm run check:btypes cross-checks "
                         "parameter lists against the implementations."),
        "modules": modules,
    }
    serialised = json.dumps(report, indent=2, ensure_ascii=False) + "\n"

    if args.check:
        current = PROVENANCE.read_text(encoding="utf8") if PROVENANCE.exists() else ""
        if current != serialised:
            print("contract index is stale; run tools/register_btype_contracts.py")
            return 1
        print(f"contract index current: {len(modules)} modules")
        return 0

    PROVENANCE.write_text(serialised, encoding="utf8")
    print(f"registered {len(modules)} declarations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
