#!/usr/bin/env python3
"""Assemble the A and B layers into the author's original project layout.

Step 3 of the corrected plan. The point is not to invent a structure that
happens to compile - it is to restore the one ShunCode was actually built in,
because that is what makes the recovered sources fit together without edits.

THE LAYOUT IS RECOVERED, NOT DESIGNED. The shipped
`extensions/shuncode/tsconfig.json` is the author's real build configuration and
its relative paths pin the tree exactly:

    <root>/
      src/                     41 bridge-core modules  (../../src from tsconfig,
                                                        ../../../src from src/*.ts)
      extensions/shuncode/
        src/                   34 recovered .ts
        tsconfig.json          the author's own, shipped verbatim
      vscode-main/             Code OSS checkout supplying vscode.d.ts
                               (../../vscode-main/src/vscode-dts/...)
      node_modules/            (../../node_modules/@types)

Both spellings resolve to the same place, which is the cross-check that the
reading is right: `../../src/x.ts` from `extensions/shuncode/` and
`../../../src/x.js` from `extensions/shuncode/src/` both normalise to
`<root>/src/x`.

What this does NOT do: it copies nothing into the protected trees, does not
build, and does not claim the result is the author's repository. It materialises
a workspace under .work/ and reports what is missing, so the gap between "we
have the pieces" and "the pieces compile together" is measured rather than
asserted.
"""

import argparse
import json
import posixpath
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
A_LAYER = REPO / "recovered" / "shuncode-extension"
B_LAYER = REPO / "reconstructed" / "bridge-core" / "src"
B_TYPES = REPO / "reconstructed" / "bridge-core" / "types"
VSCODE_TYPES = REPO / "reference" / "vscode-types"


def recovered_layout():
    """Derive the tree from the author's own tsconfig rather than guessing."""
    config = json.loads((A_LAYER / "tsconfig.json").read_text(encoding="utf8"))
    ext_dir = "extensions/shuncode"
    mapping = {}
    for entry in config["files"]:
        target = posixpath.normpath(posixpath.join(ext_dir, entry))
        mapping[entry] = target
    type_roots = [posixpath.normpath(posixpath.join(ext_dir, r))
                  for r in config["compilerOptions"].get("typeRoots", [])]
    return {
        "extensionDir": ext_dir,
        "coreDir": "src",
        "hostDir": "vscode-main/src/vscode-dts",
        "typeRoots": type_roots,
        "declaredFiles": mapping,
        "evidence": ("Paths taken from the shipped extensions/shuncode/tsconfig.json. "
                     "Cross-checked: ../../src/<m>.ts from the extension directory and "
                     "../../../src/<m>.js from its src/ both resolve to <root>/src/<m>."),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=".work/skeleton",
                        help="workspace to materialise (kept out of git)")
    parser.add_argument("--report", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--maintenance", action="store_true",
                        help=("overlay community/bridge-core/http-router.mjs, "
                              "which rejects ambiguous MCP headers"))
    args = parser.parse_args()

    layout = recovered_layout()
    work = REPO / args.output
    report = {
        "scope": ("Assembles the recovered A layer and rebuilt B layer into the "
                  "author's original project layout. Does not compile, install, "
                  "or execute anything."),
        "layoutProvenance": layout["evidence"],
        "layout": {k: v for k, v in layout.items() if k != "declaredFiles"},
    }

    if not args.dry_run:
        if work.exists():
            shutil.rmtree(work)
        (work / layout["coreDir"]).mkdir(parents=True)
        (work / layout["extensionDir"] / "src").mkdir(parents=True)
        (work / layout["hostDir"]).mkdir(parents=True)

    # B layer: the 41 modules, plus their hand-written declarations beside them
    # so TypeScript picks up <module>.d.ts for <module>.js automatically.
    core_modules, core_types = [], []
    for js in sorted(B_LAYER.glob("*.js")):
        core_modules.append(js.name)
        if not args.dry_run:
            shutil.copy2(js, work / layout["coreDir"] / js.name)
        declaration = B_TYPES / f"{js.stem}.d.ts"
        if declaration.exists():
            core_types.append(declaration.name)
            if not args.dry_run:
                shutil.copy2(declaration, work / layout["coreDir"] / declaration.name)

    # A layer: the recovered TypeScript, in the directory the author used.
    ext_sources = []
    for ts_file in sorted((A_LAYER / "src").glob("*")):
        if ts_file.suffix in {".ts", ".mts", ".cts"}:
            ext_sources.append(ts_file.name)
            if not args.dry_run:
                shutil.copy2(ts_file, work / layout["extensionDir"] / "src" / ts_file.name)

    # Host declarations. These are the pinned PUBLIC candidates, not the
    # author's private host - the distinction matters and is recorded.
    host_files = []
    for dts in sorted(VSCODE_TYPES.glob("*.d.ts")):
        host_files.append(dts.name)
        if not args.dry_run:
            shutil.copy2(dts, work / layout["hostDir"] / dts.name)

    # The author's tsconfig points typeRoots at <root>/node_modules/@types.
    # Link the repository's own so the layout is exercised as written rather
    # than by weakening the config.
    types_linked = False
    if not args.dry_run:
        for type_root in layout["typeRoots"]:
            target = work / type_root
            target.parent.mkdir(parents=True, exist_ok=True)
            source = REPO / "node_modules" / "@types"
            if source.exists() and not target.exists():
                target.symlink_to(source, target_is_directory=True)
                types_linked = True

    if not args.dry_run:
        shutil.copy2(A_LAYER / "tsconfig.json",
                     work / layout["extensionDir"] / "tsconfig.json")
        shutil.copy2(A_LAYER / "package.json",
                     work / layout["extensionDir"] / "package.json")

    # Optional maintenance overlay. The shipped router hands handlers a
    # `string | string[]` session id, because an emptiness check does not
    # exclude a repeated header; community/bridge-core/http-router.mjs answers
    # 400 for that case. Overlaying it is what lets the skeleton reach the same
    # 11-error floor the maintenance diagnostic reports.
    maintenance_applied = False
    if args.maintenance and not args.dry_run:
        base = (B_TYPES / "bridge-http-router.d.ts").read_text(encoding="utf8")
        # Narrow only the three session-id parameters. The community adapter
        # guarantees scalars by answering 400 first, so this is a faithful
        # description of behaviour under that overlay - not a cast that hides
        # the underlying issue. Everything else is left untouched.
        overlaid = (base
                    .replace("sessionId: string | string[] | undefined",
                             "sessionId: string | undefined")
                    .replace("sessionId: string | string[]", "sessionId: string")
                    .replace("protocolVersion?: string | string[] | undefined",
                             "protocolVersion?: string | undefined")
                    .replace("mcpMethod?: string | string[] | undefined",
                             "mcpMethod?: string | undefined")
                    .replace("mcpName?: string | string[] | undefined",
                             "mcpName?: string | undefined"))
        header = ("// MAINTENANCE OVERLAY, generated by tools/assemble_skeleton.py "
                  "--maintenance.\n"
                  "// Valid ONLY when community/bridge-core/http-router.mjs is in "
                  "front of the\n"
                  "// router: that adapter answers 400 'Ambiguous MCP protocol "
                  "header' for a\n"
                  "// repeated or non-scalar header, so handlers really do only "
                  "see scalars.\n"
                  "// Without the adapter the unmodified declaration is the "
                  "correct one, because\n"
                  "// the shipped router's emptiness check does not exclude "
                  "string[].\n\n")
        (work / layout["coreDir"] / "bridge-http-router.d.ts").write_text(
            header + overlaid, encoding="utf8")
        maintenance_applied = True

    # What the author's tsconfig asks for that we cannot supply.
    missing = []
    for declared, target in layout["declaredFiles"].items():
        candidate = work / target
        if args.dry_run:
            # Resolve against the source trees instead.
            if target.startswith("src/"):
                candidate = B_LAYER / Path(target).name
            elif target.startswith("vscode-main/"):
                candidate = VSCODE_TYPES / Path(target).name
            else:
                candidate = A_LAYER / Path(target).relative_to("extensions/shuncode")
        if not candidate.exists():
            missing.append({"declared": declared, "resolvesTo": target})

    report.update({
        "coreModules": len(core_modules),
        "coreDeclarations": len(core_types),
        "extensionSources": len(ext_sources),
        "hostDeclarations": len(host_files),
        "declaredByAuthorTsconfig": len(layout["declaredFiles"]),
        "missingFromAuthorTsconfig": missing,
        "missingCount": len(missing),
        "workspace": args.output,
        "typeRootsLinked": types_linked if not args.dry_run else None,
        "maintenanceOverlay": maintenance_applied,
        "hostCaveat": ("vscode-main here holds the pinned PUBLIC Code OSS 1.132.0 "
                       "declarations, not the author's private host. Chat-surface "
                       "fields their build had are absent, which is why "
                       "tool-presentation.ts still reports errors."),
        "doesNotClaim": ("Materialising the layout is not a build. Nothing here "
                         "runs npm install or tsc; see diagnose_skeleton for that."),
    })

    Path(REPO / args.report).write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"core={len(core_modules)}(+{len(core_types)} d.ts) "
          f"extension={len(ext_sources)} host={len(host_files)} "
          f"missing={len(missing)}")
    for item in missing:
        print(f"  missing: {item['declared']} -> {item['resolvesTo']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
