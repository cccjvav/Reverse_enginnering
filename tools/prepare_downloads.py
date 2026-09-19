#!/usr/bin/env python3
"""Rebuild everything the download page serves.

.work/ is gitignored and does not survive a sandbox reset, so the download
directory has been lost twice. Rather than reassemble it by hand each time,
this regenerates it from files that are in the repository.

It also extracts the paste-ready prompts: each source document wraps its prompt
in scissor markers, and the author wants the inner text on its own so it can go
straight to another assistant without the surrounding commentary.
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOWNLOADS = REPO / ".work" / "downloads"
HANDOFF = REPO / "docs" / "handoff"

# Documents copied verbatim.
DOCS = [
    "你现在该做什么.md",
    "WEB_AGENT_EXTENSION_REVIEW.md", "WEB_AGENT_HANDOVER.md", "STATUS_NOW.md",
    "PAYMENT_ARCHITECTURE_PROMPT.md", "CHAT_FIELDS_IMPACT.md",
    "ANSWERS_FOR_AUTHOR.md", "WHAT_THE_AUTHOR_MUST_SUPPLY.md",
]

# (source document, output filename) - the text between the scissor markers.
PROMPTS = [
    ("WEB_AGENT_EXTENSION_REVIEW.md", "web_agent提示词-修正版-纯净.txt"),
    ("PAYMENT_ARCHITECTURE_PROMPT.md", "支付架构提示词-纯净版.txt"),
]

START = "## ✂️ 从这里开始复制 ✂️"
END = "## ✂️ 复制到这里结束 ✂️"


def extract_prompt(text, source):
    if START not in text or END not in text:
        raise SystemExit(f"{source}: scissor markers missing; cannot extract prompt")
    body = text[text.index(START):text.index(END)]
    return body.split("\n", 1)[1].strip() + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-package", action="store_true",
                        help="do not rebuild the Bridge zip")
    args = parser.parse_args()

    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    written = []

    for name in DOCS:
        source = HANDOFF / name
        if not source.exists():
            raise SystemExit(f"missing source document: {source}")
        shutil.copy2(source, DOWNLOADS / name)
        written.append(name)

    package_readme = REPO / "community" / "bridge-package" / "README.md"
    if package_readme.exists():
        shutil.copy2(package_readme, DOWNLOADS / "BRIDGE_PACKAGE_README.md")
        written.append("BRIDGE_PACKAGE_README.md")

    for source_name, out_name in PROMPTS:
        text = (HANDOFF / source_name).read_text(encoding="utf8")
        (DOWNLOADS / out_name).write_text(extract_prompt(text, source_name),
                                          encoding="utf8")
        written.append(out_name)

    if not args.skip_package:
        subprocess.run([sys.executable, str(REPO / "tools" / "build_bridge_package.py")],
                       check=True, cwd=REPO)
        written.append("shuncode-bridge-source.zip")

    print(f"prepared {len(written)} file(s) in .work/downloads")
    for name in sorted(written):
        print(f"  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
