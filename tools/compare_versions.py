#!/usr/bin/env python3
"""Compare a newly extracted ShunCode against the recovered 0.7.4 baseline.

The author shipped 0.8.1 and asked what changed and whether the new code can be
recovered too. This answers the first half mechanically so the second half is
targeted: there is no point re-reading 34 files when only a handful moved.

WHAT IT COMPARES. The recovered 0.7.4 extension tree
(recovered/shuncode-extension, hash-verified against the shipped originals)
against the same tree extracted from the new installer. Every file is hashed,
so "changed" means the bytes differ, not that a timestamp moved.

It additionally reads package.json semantically, because that is where new
features announce themselves: commands, settings, chat participants, activation
events and the proposed-API list.

WHAT IT DOES NOT DO. It does not copy anything into the protected trees, does
not judge whether a change is an improvement, and cannot see into the bundled
dist/extension.js beyond its size and hash - a changed bundle tells you
something changed, not what. Source-level answers come from the .ts files.
"""

import argparse
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASELINE = REPO / "recovered" / "shuncode-extension"

# Directories that are vendored third-party trees in both versions; diffing
# them would bury the author's own changes in noise.
SKIP_DIRS = {"node_modules", "runtime/git", "vendor"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def tree_index(root):
    """Map of relative path -> (sha256, size) for every file under root."""
    index = {}
    if not root.exists():
        return index
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if any(rel.startswith(skip) for skip in SKIP_DIRS):
            continue
        data = path.read_bytes()
        index[rel] = (digest(data), len(data))
    return index


def manifest_diff(old, new):
    """Semantic comparison of the two package.json files."""
    def contributes(manifest, key):
        return (manifest.get("contributes") or {}).get(key) or []

    def names(entries, field):
        out = []
        for entry in entries:
            if isinstance(entry, dict) and field in entry:
                out.append(entry[field])
        return sorted(out)

    def settings(manifest):
        config = contributes(manifest, "configuration")
        if isinstance(config, dict):
            config = [config]
        keys = []
        for block in config:
            keys.extend((block.get("properties") or {}).keys())
        return sorted(keys)

    report = {
        "versionBefore": old.get("version"),
        "versionAfter": new.get("version"),
        "engineBefore": (old.get("engines") or {}).get("vscode"),
        "engineAfter": (new.get("engines") or {}).get("vscode"),
    }

    for label, getter in (
        ("commands", lambda m: names(contributes(m, "commands"), "command")),
        ("chatParticipants", lambda m: names(contributes(m, "chatParticipants"), "id")),
        ("views", lambda m: sorted(
            view.get("id", "")
            for group in (contributes(m, "views") or {}).values()
            for view in (group if isinstance(group, list) else []))),
        ("settings", settings),
        ("activationEvents", lambda m: sorted(m.get("activationEvents") or [])),
        ("enabledApiProposals", lambda m: sorted(m.get("enabledApiProposals") or [])),
        ("dependencies", lambda m: sorted((m.get("dependencies") or {}).keys())),
    ):
        before, after = set(getter(old)), set(getter(new))
        added, removed = sorted(after - before), sorted(before - after)
        if added or removed:
            report[label] = {"added": added, "removed": removed}

    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--new-tree", type=Path, required=True,
                        help="extension tree extracted from the new installer")
    parser.add_argument("--baseline", type=Path, default=BASELINE)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    before = tree_index(args.baseline)
    after = tree_index(args.new_tree)

    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    changed = sorted(
        path for path in set(before) & set(after)
        if before[path][0] != after[path][0])
    unchanged = sorted(
        path for path in set(before) & set(after)
        if before[path][0] == after[path][0])

    def is_source(path):
        return path.startswith("src/") and path.rsplit(".", 1)[-1] in {"ts", "mts", "cts"}

    manifest = None
    if "package.json" in before and "package.json" in after:
        try:
            manifest = manifest_diff(
                json.loads((args.baseline / "package.json").read_text(encoding="utf8")),
                json.loads((args.new_tree / "package.json").read_text(encoding="utf8")))
        except (OSError, json.JSONDecodeError) as error:
            manifest = {"error": str(error)}

    report = {
        "scope": ("File-level and manifest-level comparison of a newly extracted "
                  "ShunCode against the recovered 0.7.4 baseline. Identifies what "
                  "changed; does not judge the changes or decompile bundles."),
        "baseline": str(args.baseline.relative_to(REPO)) if args.baseline.is_relative_to(REPO) else str(args.baseline),
        "baselineFiles": len(before),
        "newFiles": len(after),
        "addedCount": len(added),
        "removedCount": len(removed),
        "changedCount": len(changed),
        "unchangedCount": len(unchanged),
        "added": added,
        "removed": removed,
        "changed": changed,
        # The author's own TypeScript is where new behaviour is readable, so
        # call it out separately from assets and bundles.
        "newSourceFiles": [p for p in added if is_source(p)],
        "changedSourceFiles": [p for p in changed if is_source(p)],
        "manifest": manifest,
        "sizeDeltas": {
            path: {"before": before[path][1], "after": after[path][1],
                   "delta": after[path][1] - before[path][1]}
            for path in changed
        },
        "doesNotClaim": (
            "A changed dist/extension.js means the bundle differs, not what "
            "differs - bundles are build output. Source-level answers come from "
            "the .ts files listed above. Nothing here is copied into the "
            "protected recovered/ tree."),
    }

    Path(args.output).write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf8")

    print(f"baseline {len(before)} files -> new {len(after)} files")
    print(f"  added {len(added)}  removed {len(removed)}  "
          f"changed {len(changed)}  unchanged {len(unchanged)}")
    if report["newSourceFiles"]:
        print("  new source files:")
        for path in report["newSourceFiles"]:
            print(f"    + {path}")
    if report["changedSourceFiles"]:
        print("  changed source files:")
        for path in report["changedSourceFiles"]:
            print(f"    ~ {path}")
    if manifest and "error" not in manifest:
        print(f"  version {manifest['versionBefore']} -> {manifest['versionAfter']}")
        for key, value in manifest.items():
            if isinstance(value, dict) and (value.get("added") or value.get("removed")):
                print(f"  {key}: +{len(value['added'])} -{len(value['removed'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
