#!/usr/bin/env python3
"""Recover how the author adapted Code OSS to Electron 44's clipboard rewrite.

Electron 44.0.0 deleted 13 clipboard methods and made the survivors async:

    42.x / 43.x : availableFormats clear has read readBookmark readBuffer
                  readFindText readHTML readImage readRTF readText write
                  writeBookmark writeBuffer writeFindText writeHTML writeImage
                  writeRTF writeText
    44.x        : clear has read readText write writeText      (all Promise-based)

Upstream 1.132.0 calls five of the deleted methods, so it cannot compile against
Electron 44 unmodified. The shipped ShunCode 0.7.4 *does* run on Electron 44.2.0,
which means the author already solved this. Their compiled `out/main.js` is
therefore primary evidence of the lost patch.

This probe extracts the installer, locates the clipboard region of main.js and
reports what is actually there, so the fix can be reconstructed from the
author's own solution rather than invented.

Scope: static text analysis of compiled output. Minified-away details and
inlined helpers may not be recoverable. It reports what it finds and says so
when it finds nothing; it never guesses.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REMOVED_IN_44 = [
    "availableFormats", "readBookmark", "readBuffer", "readFindText", "readHTML",
    "readImage", "readRTF", "writeBookmark", "writeBuffer", "writeFindText",
    "writeHTML", "writeImage", "writeRTF",
]
SURVIVING_IN_44 = ["clear", "has", "read", "readText", "write", "writeText"]

# The IPC channel names Code OSS uses for these operations survive minification
# because they are string literals crossing a process boundary.
CHANNEL_HINTS = [
    "readClipboardText", "writeClipboardText", "readClipboardFindText",
    "writeClipboardFindText", "readClipboardBuffer", "writeClipboardBuffer",
    "readImage", "triggerPaste", "hasClipboard",
]


def find_main_js(tree: Path):
    """Locate the carrier's compiled main.js inside an extracted install tree."""
    candidates = sorted(tree.rglob("out/main.js"), key=lambda p: -p.stat().st_size)
    return candidates[0] if candidates else None


def analyse(text: str):
    report = {"bytes": len(text)}

    # Which clipboard methods appear at all, as `.name(` call sites.
    def call_sites(name):
        return len(re.findall(r"(?<![\w$])" + re.escape(name) + r"\s*\(", text))

    report["removedApiCallSites"] = {n: call_sites(n) for n in REMOVED_IN_44}
    report["survivingApiCallSites"] = {n: call_sites(n) for n in SURVIVING_IN_44}
    report["usesAnyRemovedApi"] = any(v for v in report["removedApiCallSites"].values())

    report["channelHints"] = {n: call_sites(n) for n in CHANNEL_HINTS}

    # Pull a window around each clipboard service method so a human can read the
    # author's actual implementation.
    excerpts = []
    for name in ("readClipboardFindText", "writeClipboardFindText",
                 "readClipboardBuffer", "writeClipboardBuffer", "readImage"):
        for m in re.finditer(r"(?<![\w$])" + re.escape(name) + r"\s*\(", text):
            start = max(0, m.start() - 160)
            end = min(len(text), m.start() + 420)
            excerpts.append({
                "method": name,
                "offset": m.start(),
                "excerpt": text[start:end],
            })
            break  # first occurrence per method is enough to show the shape
    report["excerpts"] = excerpts

    # The shipped main.js turned out to be unminified, so the author's actual
    # implementation is readable verbatim. Capture the whole contiguous
    # clipboard region (and the clipboardForType helper it relies on) instead of
    # only keyhole windows, so the real source can be recovered rather than
    # guessed at.
    regions = []
    for start_name, end_name in (("async readClipboardText(", "async hasClipboard("),
                                 ("clipboardForType(", None)):
        i = text.find(start_name)
        if i < 0:
            continue
        i = max(0, i - 40)
        if end_name:
            j = text.find(end_name, i)
            j = len(text) if j < 0 else text.find("}", text.find("\n", j + 200)) + 1
        else:
            j = i + 700
        chunk = text[i:min(j, i + 12000)]
        regions.append({"anchor": start_name.strip(), "offset": i,
                        "chars": len(chunk), "text": chunk})
    report["authorImplementation"] = regions

    # Did the author keep a compatibility shim? Such code usually still mentions
    # the old names as strings or property keys even when the API is gone.
    report["oldNamesAsStrings"] = {
        n: len(re.findall(r"[\"']" + re.escape(n) + r"[\"']", text))
        for n in REMOVED_IN_44 if re.search(r"[\"']" + re.escape(n) + r"[\"']", text)
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tree", required=True,
                        help="Extracted installer tree (from installer_forensics).")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    tree = Path(args.tree)
    report = {
        "question": ("How did the author make Code OSS 1.132.0 compile and run on "
                     "Electron 44.2.0, whose clipboard API dropped 13 methods?"),
        "electronApiChange": {
            "removedIn44": REMOVED_IN_44,
            "survivingIn44": SURVIVING_IN_44,
            "note": "Surviving methods also became Promise-based in 44.",
        },
        "upstreamCallsRemovedApis": 5,
        "scope": ("Static analysis of compiled main.js. Inlined or renamed helpers "
                  "may be unrecoverable; absence of a finding is reported, not guessed."),
    }

    if not tree.is_dir():
        report["error"] = f"tree not found: {tree}"
        return finish(report, args.output, ok=False)

    main_js = find_main_js(tree)
    if not main_js:
        report["error"] = "no out/main.js found in the extracted tree"
        return finish(report, args.output, ok=False)

    report["mainJs"] = {"path": str(main_js.relative_to(tree)),
                        "bytes": main_js.stat().st_size}
    text = main_js.read_text(encoding="utf8", errors="replace")
    report["analysis"] = analyse(text)

    a = report["analysis"]
    if a["usesAnyRemovedApi"]:
        report["finding"] = (
            "The shipped main.js still references clipboard APIs that Electron 44 "
            "removed. Either those code paths are dead, or the carrier bundles a "
            "shim. Read the excerpts before concluding.")
    else:
        report["finding"] = (
            "The shipped main.js references none of the removed clipboard APIs, so "
            "the author removed or rewrote those call sites. The excerpts show what "
            "replaced them.")
    return finish(report, args.output, ok=True)


def finish(report, output, ok):
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf8")
    print(json.dumps({k: v for k, v in report.items() if k != "analysis"},
                     indent=2, ensure_ascii=False)[:2000])
    print(f"\nwrote {path}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
