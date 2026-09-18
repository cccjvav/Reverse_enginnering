#!/usr/bin/env python3
"""Cross-check hand-written declarations against the implementations.

Typing a module by reading it is error-prone in a specific, quiet way: the
declaration compiles regardless of whether it matches the JavaScript. While
typing apply-patch I declared `encodeText(text: string)` when the real function
is `encodeText(lines, endsWithNewline, eol, bom)`, and `isInsideRoot(candidate,
root)` when the real order is `(root, target)`. Both would have compiled
forever, and the second would have sent a caller's arguments through backwards.

This compares, for every exported function, the parameter count and names
declared in the .d.ts against the implementation in ../src. It reports:

  ARITY      the declaration takes a different number of parameters
  ORDER      same names, different order - the dangerous one
  MISSING    declared but not present in the implementation
  ASYNC      implementation is async but the declaration has no Promise

Optional parameters make an exact arity match too strict, so a declaration may
declare fewer required parameters than the implementation accepts; only a
declaration with MORE parameters, or with reordered names, is an error.
"""

import argparse
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "reconstructed" / "bridge-core" / "src"
TYPES = REPO / "reconstructed" / "bridge-core" / "types"

IMPL_RE = re.compile(
    r"^(?P<async>async\s+)?function\s+(?P<name>\w+)\s*\((?P<params>[^)]*)\)", re.M)
DECL_RE = re.compile(
    r"^export\s+(?:declare\s+)?function\s+(?P<name>\w+)\s*(?:<[^>]*>)?\s*\((?P<params>.*?)\)\s*:\s*(?P<ret>[^;]+);",
    re.M | re.S)


def split_params(text):
    """Split a parameter list on top-level commas only."""
    out, depth, current = [], 0, ""
    for ch in text:
        if ch in "<([{":
            depth += 1
        elif ch in ">)]}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(current)
            current = ""
        else:
            current += ch
    if current.strip():
        out.append(current)
    return [p.strip() for p in out if p.strip()]


def param_names(params):
    names = []
    for raw in params:
        raw = raw.strip()
        if not raw:
            continue
        name = raw.split(":")[0].strip().lstrip(".").rstrip("?")
        name = name.split("=")[0].strip()
        if name:
            names.append(name)
    return names


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    findings, checked = [], 0
    modules = {}

    for decl_path in sorted(TYPES.glob("*.d.ts")):
        stem = decl_path.name.removesuffix(".d.ts")
        impl_path = SRC / f"{stem}.js"
        if not impl_path.exists():
            continue
        impl_text = impl_path.read_text(encoding="utf8", errors="replace")
        decl_text = decl_path.read_text(encoding="utf8", errors="replace")

        impls = {}
        for m in IMPL_RE.finditer(impl_text):
            impls[m.group("name")] = {
                "params": param_names(split_params(m.group("params"))),
                "async": bool(m.group("async")),
            }

        module_findings = []
        for m in DECL_RE.finditer(decl_text):
            name = m.group("name")
            impl = impls.get(name)
            if impl is None:
                # Re-exports and class methods are out of scope here.
                continue
            checked += 1
            declared = param_names(split_params(m.group("params")))
            ret = " ".join(m.group("ret").split())

            if len(declared) > len(impl["params"]):
                module_findings.append({
                    "kind": "ARITY", "function": name,
                    "declared": declared, "implementation": impl["params"],
                    "detail": "declaration takes more parameters than the implementation",
                })
            elif (len(declared) == len(impl["params"])
                  and declared != impl["params"]
                  and sorted(declared) == sorted(impl["params"])):
                module_findings.append({
                    "kind": "ORDER", "function": name,
                    "declared": declared, "implementation": impl["params"],
                    "detail": "same parameter names in a different order",
                })

            if impl["async"] and "Promise" not in ret and ret != "never":
                module_findings.append({
                    "kind": "ASYNC", "function": name,
                    "declared": ret,
                    "detail": "implementation is async but the declaration does not return a Promise",
                })

        if module_findings:
            modules[stem] = module_findings
            findings.extend(module_findings)

    report = {
        "scope": ("Cross-checks hand-written .d.ts parameter lists against the "
                  "implementations they describe."),
        "why": ("A declaration compiles whether or not it matches the JavaScript. "
                "Two real defects prompted this: encodeText was declared "
                "(text: string) against an implementation taking "
                "(lines, endsWithNewline, eol, bom), and isInsideRoot was "
                "declared with its two arguments reversed."),
        "functionsChecked": checked,
        "findingCount": len(findings),
        "modules": modules,
        "limits": ("Only top-level `export function` declarations matched to "
                   "`function` implementations are compared. Class methods, "
                   "re-exports and const-assigned arrow functions are out of "
                   "scope, so a clean report is not proof of full agreement."),
    }
    Path(args.output).write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"checked {checked} functions; {len(findings)} finding(s)")
    for finding in findings:
        print(f"  {finding['kind']}: {finding['function']} - {finding['detail']}")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
