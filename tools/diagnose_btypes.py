#!/usr/bin/env python3
"""Measure how well typed the rebuilt B-layer modules actually are.

Running `tsc --declaration` over `reconstructed/bridge-core/src` always
succeeds, which is misleading: it emits a `.d.ts` for all 41 modules even when
almost every parameter lands as `any`. "41 of 41 modules have declarations" is
therefore a worthless progress number.

This measures the number that matters instead - how many exported symbols carry
a *useful* type - so progress on step 2 can be judged rather than asserted. An
`any` is counted as not-yet-typed even though it compiles.
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BSRC = REPO / "reconstructed" / "bridge-core" / "src"
HAND = REPO / "reconstructed" / "bridge-core" / "types"

TSCONFIG = {
    "compilerOptions": {
        "target": "ES2022",
        "module": "ESNext",
        "moduleResolution": "bundler",
        "allowJs": True,
        "checkJs": False,
        "declaration": True,
        "emitDeclarationOnly": True,
        "skipLibCheck": True,
        "strict": False,
        "types": ["node"],
    },
}

# An `any` anywhere in a declaration means that declaration is not carrying real
# information, whether it is a parameter, a return, or a property.
ANY_RE = re.compile(r"\bany\b")
# Comments mention the word "any" in ordinary prose ("converting any throw",
# "worse than `any`"). Counting those would understate hand-written coverage,
# so strip comments before measuring.
COMMENT_RE = re.compile(r"/\*.*?\*/|//[^\n]*", re.S)


def without_comments(text):
    return COMMENT_RE.sub("", text)
DECL_RE = re.compile(
    r"^export\s+(?:declare\s+)?(?:function|const|class|type|interface|var|let|namespace)\s+(\w+)",
    re.M)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--tsc", default=str(REPO / "node_modules/.bin/tsc"))
    args = parser.parse_args()

    report = {
        "scope": ("Quality of the generated B-layer declarations, not merely "
                  "their existence."),
        "method": ("tsc --declaration over reconstructed/bridge-core/src, then "
                   "count exported declarations that contain no `any`."),
    }

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        cfg = dict(TSCONFIG)
        cfg["compilerOptions"] = dict(TSCONFIG["compilerOptions"])
        cfg["compilerOptions"]["outDir"] = str(work / "out")
        cfg["include"] = [str(BSRC / "*.js")]
        cfg_path = work / "tsconfig.json"
        cfg_path.write_text(json.dumps(cfg), encoding="utf8")
        # tsc resolves @types/node relative to the config, so point it at the
        # repository's own node_modules rather than a temp directory.
        link = work / "node_modules"
        try:
            link.symlink_to(REPO / "node_modules")
        except OSError:
            pass

        proc = subprocess.run([args.tsc, "-p", str(cfg_path)],
                              capture_output=True, text=True)
        out = proc.stdout + proc.stderr
        report["tscExitCode"] = proc.returncode
        report["tscErrorCount"] = len(re.findall(r"error TS", out))
        if report["tscErrorCount"]:
            report["tscErrors"] = out.splitlines()[:20]

        modules = {}
        total_decl = total_clean = total_any = 0
        for dts in sorted((work / "out").rglob("*.d.ts")):
            text = without_comments(dts.read_text(encoding="utf8", errors="replace"))
            decls = DECL_RE.findall(text)
            # Split per declaration so a single `any` does not condemn the file.
            chunks = re.split(r"(?=^export\s)", text, flags=re.M)
            clean = sum(1 for c in chunks
                        if c.strip().startswith("export") and not ANY_RE.search(c))
            anys = len(ANY_RE.findall(text))
            modules[dts.name.removesuffix(".d.ts")] = {
                "declarations": len(decls),
                "fullyTyped": clean,
                "anyOccurrences": anys,
            }
            total_decl += len(decls)
            total_clean += clean
            total_any += anys

    # Hand-written declarations override inference for their module. Count them
    # as the real answer, otherwise the metric can never move no matter how much
    # typing gets done.
    handwritten = {}
    for path in sorted(HAND.glob("*.d.ts")):
        text = without_comments(path.read_text(encoding="utf8", errors="replace"))
        chunks = re.split(r"(?=^export\s)", text, flags=re.M)
        decls = [c for c in chunks if c.strip().startswith("export")]
        clean = sum(1 for c in decls if not ANY_RE.search(c))
        handwritten[path.name.removesuffix(".d.ts")] = {
            "declarations": len(decls),
            "fullyTyped": clean,
            "anyOccurrences": len(ANY_RE.findall(text)),
            "handWritten": True,
        }
    for name, stats in handwritten.items():
        inferred = modules.get(name)
        if inferred:
            total_decl -= inferred["declarations"]
            total_clean -= inferred["fullyTyped"]
            total_any -= inferred["anyOccurrences"]
        total_decl += stats["declarations"]
        total_clean += stats["fullyTyped"]
        total_any += stats["anyOccurrences"]
        modules[name] = stats
    report["handWrittenModules"] = sorted(handwritten)

    report["moduleCount"] = len(modules)
    report["declarationsTotal"] = total_decl
    report["fullyTypedDeclarations"] = total_clean
    report["anyOccurrences"] = total_any
    pct = round(100.0 * total_clean / total_decl, 1) if total_decl else 0.0
    report["fullyTypedPercent"] = pct
    report["modules"] = modules
    report["worstModules"] = sorted(
        ({"module": k, **v} for k, v in modules.items()),
        key=lambda m: -m["anyOccurrences"])[:10]
    remaining = total_decl - total_clean
    if remaining:
        report["interpretation"] = (
            f"{total_clean} of {total_decl} exported declarations ({pct}%) carry "
            f"a type with no `any`. The remaining {remaining} compile but "
            f"describe nothing, so those modules are readable, not yet editable "
            f"with confidence.")
    else:
        report["interpretation"] = (
            f"All {total_decl} exported declarations carry a type with no `any`. "
            f"That measures specificity, not correctness: see "
            f"docs/evidence/btype-evidence.json for which modules rest on "
            f"first-hand evidence and which are reconstruction from behaviour.")
    report["doesNotClaim"] = (
        "A declaration without `any` is not proof the type is correct, only "
        "that inference produced something specific. Correctness still depends "
        "on the evidence tiers in docs/evidence/btype-evidence.json.")

    Path(args.output).write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(report["interpretation"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
