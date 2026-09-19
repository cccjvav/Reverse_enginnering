#!/usr/bin/env python3
"""Check the documentation against the evidence files it cites.

Written after being asked whether every document had really been reviewed. It
had not: the first pass covered docs/handoff only, while the two most-read
documents in the repository - the root README.md and docs/RECOVERY_STATUS.md -
were still describing a state from two days earlier and pointing at the wrong
branch. A reader starting at the front door would have been misinformed.

Reviewing 57 markdown files by eye does not scale and does not stay true, so
this automates the parts that can be checked mechanically:

  COUNTS    numbers quoted in prose that contradict docs/evidence/*.json
  COMMANDS  `npm run X` references where X is not in package.json
  LINKS     relative markdown links pointing at files that do not exist
  BRANCH    the current session branch named as something else

It deliberately does NOT try to judge prose. Stale narrative still needs a human
- what it guarantees is that the numbers, commands and links stay honest.
"""

import argparse
import json
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SKIP_DIRS = {"node_modules", ".git", ".work", "dist", "out"}
CURRENT_BRANCH = "arena/01a0afd4-reverse-enginnering-of-shun"


def markdown_files():
    for path in sorted(REPO.rglob("*.md")):
        if any(part in SKIP_DIRS for part in path.relative_to(REPO).parts):
            continue
        yield path


def load(name):
    path = REPO / "docs" / "evidence" / name
    return json.loads(path.read_text(encoding="utf8")) if path.exists() else None


def check_counts(text, path, findings):
    """Numbers that must agree with the evidence, with their source of truth."""
    btype = load("btype-baseline.json")
    skeleton = load("skeleton-typecheck.json")
    arity = load("btype-arity.json")

    rules = []
    if btype:
        total = btype["declarationsTotal"]
        typed = btype["fullyTypedDeclarations"]
        # Any "N/N declarations" claim must match the measured pair.
        for match in re.finditer(r"(\d{3})\s*/\s*(\d{3})\s*(?:个)?\s*(?:导出)?声明", text):
            if (int(match.group(1)), int(match.group(2))) != (typed, total):
                rules.append(f"claims {match.group(0)!r} but btype-baseline says {typed}/{total}")
    if arity:
        for match in re.finditer(r"(\d+)\s*(?:个)?\s*函数(?:签名)?(?:与实现)?比对", text):
            if int(match.group(1)) != arity["functionsChecked"]:
                rules.append(f"claims {match.group(0)!r} but arity report checked {arity['functionsChecked']}")
    if skeleton and "skeleton" in path.name.lower():
        # A non-zero unresolved count is fine when the document is describing
        # the deliberate tamper test that proves the check can fail; only flag
        # it when presented as the current result.
        for match in re.finditer(r"unresolved\D{0,12}([1-9])", text, re.I):
            window = text[max(0, match.start() - 220):match.start()]
            if not re.search(r"remov|delet|tamper|flips|篡改|删掉", window, re.I):
                rules.append("presents a non-zero unresolved count as current, "
                             "but the report says 0")

    for rule in rules:
        findings.append({"kind": "COUNTS", "file": str(path.relative_to(REPO)), "detail": rule})


# Scripts that belong to the UPSTREAM Code OSS carrier, not this repository.
# Documents legitimately discuss `npm run compile` when describing the carrier
# build, so flagging those as broken references would be wrong.
UPSTREAM_SCRIPTS = {"compile", "build", "watch", "gulp"}


def check_commands(text, path, scripts, findings):
    for match in re.finditer(r"npm run ([a-z0-9:_-]+)", text):
        name = match.group(1)
        if name in UPSTREAM_SCRIPTS:
            continue
        if name not in scripts:
            findings.append({"kind": "COMMANDS", "file": str(path.relative_to(REPO)),
                             "detail": f"references `npm run {name}`, which package.json does not define"})


def check_links(text, path, findings):
    for match in re.finditer(r"\[[^\]]*\]\(([^)#]+?)(?:#[^)]*)?\)", text):
        target = match.group(1).strip()
        if target.startswith(("http://", "https://", "mailto:")):
            continue
        resolved = (path.parent / target).resolve()
        if not resolved.exists():
            findings.append({"kind": "LINKS", "file": str(path.relative_to(REPO)),
                             "detail": f"link to {target!r} does not resolve"})


def check_branch(text, path, findings):
    """An old branch is fine as history; it is a problem when called current."""
    for match in re.finditer(r"(当前[^\n]{0,12}分支[^\n]{0,40})", text):
        sentence = match.group(1)
        # Naming the old branch alongside the current one is history, not a
        # stale claim - only flag it when the current branch is absent.
        if "01a09d2c" in sentence and "01a0afd4" not in sentence:
            findings.append({"kind": "BRANCH", "file": str(path.relative_to(REPO)),
                             "detail": f"names an old branch as current: {sentence[:70]!r}"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    scripts = set(json.loads((REPO / "package.json").read_text(encoding="utf8"))["scripts"])
    findings, reviewed = [], 0

    for path in markdown_files():
        text = path.read_text(encoding="utf8", errors="replace")
        reviewed += 1
        check_counts(text, path, findings)
        check_commands(text, path, scripts, findings)
        check_links(text, path, findings)
        check_branch(text, path, findings)

    report = {
        "scope": ("Mechanical consistency check of every markdown file against "
                  "the evidence it cites. Does not judge prose."),
        "why": ("A manual review missed the root README and RECOVERY_STATUS, "
                "both of which described a two-day-old state at the front door "
                "of the repository. Eyeballing 57 files does not stay true."),
        "filesReviewed": reviewed,
        "findingCount": len(findings),
        "findings": findings,
        "limits": ("Checks numbers, npm commands, relative links and stale "
                   "branch claims. Narrative that is merely out of date still "
                   "needs a human reader."),
    }
    (REPO / args.output).write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"reviewed {reviewed} markdown files; {len(findings)} finding(s)")
    for finding in findings:
        print(f"  {finding['kind']}: {finding['file']} - {finding['detail']}")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
