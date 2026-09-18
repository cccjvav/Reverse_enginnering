#!/usr/bin/env python3
"""Collect the surviving type evidence for the 41 rebuilt B-layer modules.

Step 2 of the recovery is to make `reconstructed/bridge-core/src` editable, which
means giving it TypeScript types. The original `.ts` for those modules was never
shipped (`inventory.maps_total == 0`, and none of the 41 stems appear among the
28 recovered sources), so the types cannot simply be read back the way the
Electron 44 clipboard adaptation could.

What *did* survive is worth separating from what did not, because typing 392
exports by guesswork would produce confident-looking fiction. Three tiers:

  A. FIRST-HAND  - the author's own recovered `.ts` files import these modules
                   and annotate the results. Every name in an `import type {...}`
                   is a type the author actually wrote, spelled their way.
  B. STRUCTURAL  - JSON Schemas embedded in the shipped code. These are runtime
                   values, so they survived compilation intact and describe
                   tool inputs exactly.
  C. INFERRED    - whatever `tsc --declaration` can work out from the JavaScript.
                   Useful, but it collapses to `any` wherever it cannot tell.

This tool only reports. It writes no types, so it cannot quietly invent one.
"""

import argparse
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BSRC = REPO / "reconstructed" / "bridge-core" / "src"
ASRC = REPO / "recovered" / "shuncode-extension"

IMPORT_RE = re.compile(
    r"import\s+(type\s+)?\{([^}]*)\}\s*from\s*['\"]([^'\"]+)['\"]", re.S)


def module_stems():
    return {p.stem for p in BSRC.glob("*.js")}


def exported_names(text):
    """Names a module exports, however the export is spelled."""
    names = set()
    for block in re.findall(r"^export\s*\{([^}]*)\}", text, re.M):
        for part in block.split(","):
            part = part.strip().split(" as ")[-1].strip()
            if part:
                names.add(part)
    names |= set(re.findall(r"^export\s+(?:async\s+)?function\s+(\w+)", text, re.M))
    names |= set(re.findall(r"^export\s+(?:const|class|var|let)\s+(\w+)", text, re.M))
    return names


def harvest_first_hand(stems):
    """Type names the author wrote, taken from their own annotated sources."""
    value_imports, type_imports = {}, {}
    for path in sorted(ASRC.rglob("*.ts")):
        text = path.read_text(errors="replace")
        for whole_type, names, spec in IMPORT_RE.findall(text):
            stem = spec.split("/")[-1].removesuffix(".js").removesuffix(".mjs")
            if stem not in stems:
                continue
            for raw in names.split(","):
                raw = raw.strip()
                if not raw:
                    continue
                is_type = bool(whole_type) or raw.startswith("type ")
                name = raw.removeprefix("type ").split(" as ")[0].strip()
                if not name:
                    continue
                bucket = type_imports if is_type else value_imports
                entry = bucket.setdefault(stem, {})
                usages = entry.setdefault(name, [])
                # Record how the author annotated it: the use sites carry the
                # generic arity and whether it is an array, which a bare name
                # would lose.
                for m in re.finditer(r"[^\w](" + re.escape(name) + r"\s*(?:<[^;\n]*?>)?(?:\[\])?)", text):
                    snippet = m.group(1).strip()
                    if snippet not in usages:
                        usages.append(snippet)
                usages[:] = usages[:4]
                if path.name not in entry.setdefault("__files__", []):
                    entry["__files__"].append(path.name)
    return value_imports, type_imports


def harvest_schemas(stems):
    """JSON Schemas are runtime data, so they outlived type erasure."""
    found = {}
    for path in sorted(BSRC.glob("*.js")):
        text = path.read_text(errors="replace")
        blocks = re.findall(r"inputSchema:\s*\{", text)
        props = re.findall(r"^\s*(\w+):\s*\{\s*type:\s*['\"](\w+)['\"]", text, re.M)
        if blocks or props:
            found[path.stem] = {
                "inputSchemaBlocks": len(blocks),
                "typedProperties": len(props),
                "sampleProperties": [f"{n}: {t}" for n, t in props[:8]],
            }
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    stems = module_stems()
    modules = {}
    total_exports = 0
    for path in sorted(BSRC.glob("*.js")):
        names = exported_names(path.read_text(errors="replace"))
        total_exports += len(names)
        modules[path.stem] = {"exports": sorted(names), "exportCount": len(names)}

    values, types = harvest_first_hand(stems)
    schemas = harvest_schemas(stems)

    named = set(values) | set(types)
    covered_symbols = sum(
        len([k for k in v if k != "__files__"]) for v in values.values())
    covered_types = sum(
        len([k for k in v if k != "__files__"]) for v in types.values())

    report = {
        "scope": ("Evidence inventory for typing the 41 rebuilt B-layer modules. "
                  "Reports only; writes no type definitions."),
        "whyNotSimplyRecovered": (
            "Unlike the Electron 44 clipboard adaptation, the original .ts for "
            "these modules was never shipped: the installer contains no source "
            "maps (inventory.maps_total == 0) and none of the 41 module stems "
            "appear among the 28 recovered .ts files. Types are erased at "
            "compile time, so they must be reconstructed from use, not read "
            "back."),
        "moduleCount": len(modules),
        "totalExports": total_exports,
        "tierA_firstHand": {
            "meaning": ("Names the author themselves wrote in recovered .ts "
                        "files. Spelling and generic arity are authoritative."),
            "modulesReferenced": len(named),
            "valueSymbols": covered_symbols,
            "typeSymbols": covered_types,
            "typeImports": types,
            "valueImports": values,
        },
        "tierB_structural": {
            "meaning": ("JSON Schemas embedded as runtime values; they survived "
                        "compilation and pin down tool input shapes exactly."),
            "modules": schemas,
        },
        "tierC_inferred": {
            "meaning": ("Whatever tsc --declaration derives from the JS. "
                        "Measured separately by diagnose_btypes; it degrades to "
                        "`any` wherever inference fails."),
        },
        "modules": modules,
        "unreferencedByAuthorSources": sorted(stems - named),
        "doesNotClaim": (
            "Tier A covers only the surface the extension imports. Everything "
            "else is reconstruction from behaviour, and must be labelled as "
            "such rather than presented as the author's original types."),
    }
    Path(args.output).write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"modules={len(modules)} exports={total_exports} "
          f"tierA_modules={len(named)} tierA_types={covered_types} "
          f"tierB_modules={len(schemas)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
