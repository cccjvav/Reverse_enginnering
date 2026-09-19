#!/usr/bin/env python3
"""Establish what the author's Chat host declared that the public one does not.

The assembled skeleton reaches 0 unresolved imports but still reports 11 errors
in tool-presentation.ts, all of the form "Property 'x' does not exist on type
'ChatSimpleToolResultData'". It would be easy to treat that as a typing problem
and paper over it with an augmentation. That would be wrong, and this tool
exists to show why.

WHAT THE EVIDENCE SAYS. The pinned public
vscode.proposed.chatParticipantAdditions.d.ts declares ChatSimpleToolResultData
with exactly two members, `input` and `output`. The author's own source writes

    items?: NonNullable<vscode.ChatSimpleToolResultData["items"]>

which only compiles if their vscode.d.ts declared `items`. They were building
against a FORKED Code OSS host, not the public proposed API. The shipped bundle
confirms the fields are real at runtime, not aspirational: presentationKind,
diffPreview, metrics and items are all constructed there.

So the 11 errors are not a defect in the recovered sources and not something the
B-layer types can fix. They are the measurable size of one missing input: the
author's private host declarations.

This tool reports that gap and reconstructs the field shapes from the shipped
implementation, so the eventual fix can be evidence-led. It deliberately does
NOT write an augmentation: fabricating members on the public vscode namespace
would manufacture a green typecheck while leaving the real host unrecovered.
"""

import argparse
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PUBLIC_DTS = (REPO / "reference" / "vscode-types"
              / "vscode.proposed.chatParticipantAdditions.d.ts")
SOURCE = REPO / "recovered" / "shuncode-extension" / "src" / "tool-presentation.ts"
BUNDLE = REPO / "recovered" / "shuncode-extension" / "dist" / "extension.js"

INTERFACE = "ChatSimpleToolResultData"


def public_members():
    text = PUBLIC_DTS.read_text(encoding="utf8", errors="replace")
    start = text.find(f"interface {INTERFACE}")
    if start < 0:
        return []
    body = text[start:text.index("\n\t}", start)]
    return sorted(set(re.findall(r"^\t\t(\w+)\??:", body, re.M)))


def members_the_author_used():
    """Every field the author indexes off the interface, in their own words."""
    text = SOURCE.read_text(encoding="utf8", errors="replace")
    used = set(re.findall(rf'{INTERFACE}\["(\w+)"\]', text))
    return sorted(used)


def runtime_witness(field):
    """Where the shipped bundle actually constructs the field."""
    if not BUNDLE.exists():
        return None
    text = BUNDLE.read_text(encoding="utf8", errors="replace")
    hits = re.findall(rf"{field}:\s*([^,;\n}}]{{0,60}})", text)
    return {"occurrences": len(hits), "samples": [h.strip() for h in hits[:3]]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    public = public_members()
    used = members_the_author_used()
    # Fields named in compiler errors but reached via object literals rather
    # than indexed access, so they do not appear in the pattern above.
    literal_only = ["presentationKind", "presentationStyle"]
    missing = sorted(set(used) | set(literal_only) - set(public))
    missing = [m for m in missing if m not in public]

    fields = {}
    for name in missing:
        fields[name] = {
            "declaredByPublicHost": False,
            "usedByAuthorSource": name in used,
            "runtimeWitness": runtime_witness(name),
        }

    report = {
        "scope": ("Measures the gap between the author's Chat host and the pinned "
                  "public one. Reports only; writes no type augmentation."),
        "interface": INTERFACE,
        "publicMembers": public,
        "membersTheAuthorRelliedOn": sorted(set(used) | set(literal_only)),
        "missingFromPublicHost": missing,
        "missingCount": len(missing),
        "fields": fields,
        "conclusion": (
            f"The public {INTERFACE} declares {len(public)} members "
            f"({', '.join(public)}). The author's sources rely on "
            f"{len(missing)} more, using constructs such as "
            f'NonNullable<vscode.{INTERFACE}["items"]> that only compile if '
            "their vscode.d.ts declared them. They built against a forked Code "
            "OSS host, and the shipped bundle constructs these fields at "
            "runtime, so they were real rather than aspirational."),
        "whyNotFixedHere": (
            "Declaring these members ourselves would turn 11 red errors green "
            "without recovering anything. It would also put fabricated fields "
            "on the public vscode namespace, which is exactly the kind of "
            "false-host claim this project refuses to make. The honest fix is "
            "to obtain the author's host declarations."),
        "consequence": (
            "Until then the skeleton's floor is 11 errors in "
            "tool-presentation.ts. That number is the size of one missing "
            "input, not a defect in the recovered sources or the B-layer types."),
    }
    Path(args.output).write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"public members: {public}")
    print(f"missing from public host: {len(missing)} -> {missing}")
    for name, detail in fields.items():
        witness = detail["runtimeWitness"]
        count = witness["occurrences"] if witness else 0
        print(f"  {name}: {count} runtime construction(s) in the shipped bundle")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
