#!/usr/bin/env python3
"""Package the ShunCode 0.8.1 external-MCP and Skills sources for web_agent.

The other project's assistant cannot read this repository, so the plan it is
given has to travel with the code it refers to. This collects exactly the
files cited in docs/handoff/WEB_AGENT_MCP_SKILLS_PLAN.md.

Two kinds of file go in, and they are NOT equivalent:

  recovered/shuncode-0.8.1/src/*       the author's original TypeScript,
                                       shipped in the installer, types intact.
  reconstructed/carrier-0.8.1/src/*    compiler output sliced out of
                                       dist/extension.js. Readable logic, but
                                       types and most comments are erased and
                                       imports are not rewired.

Every reconstructed file already carries that warning in its header; the
manifest repeats it per entry so nobody has to trust a header they skipped.

A secret scan runs over everything: these are another person's shipped
sources and must not carry a credential into a second repository.
"""

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path

# Zip entries normally carry each file's mtime, so two builds of identical
# content produce different archive bytes. Pin every entry to a fixed
# timestamp and mode so the archive itself is byte-reproducible.
FIXED_DATE = (1980, 1, 1, 0, 0, 0)


def _add(archive, arcname, data):
    info = zipfile.ZipInfo(str(arcname), date_time=FIXED_DATE)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    archive.writestr(info, data)



REPO = Path(__file__).resolve().parent.parent

# Original TypeScript from the installer.
ORIGINAL = [
    "external-mcp-connection.ts",     # transport negotiation and fallback
    "external-mcp-stdio-env.ts",      # managed child environment
    "external-mcp-secret-fields.ts",  # reserved headers, field limits
    "external-mcp-diagnose.ts",       # staged, credential-free probe
    "external-mcp-network.ts",        # settings fingerprint, extra CA
    "external-mcp-status.ts",         # status vocabulary
    "external-mcp-oauth-flow.ts",     # outbound DCR + PKCE + refresh
    "external-mcp-oauth.ts",          # outbound OAuth surface
    "external-mcp-preview-token.ts",  # confirmation token that is not an input hash
    "external-mcp-native-refs.ts",    # pass config by reference, with a TTL
    "external-mcp-registry.ts",       # connection lifecycle
    "external-mcp-catalog.ts",        # config store, migration, validation
    "proxy-bypass.mts",               # no_proxy and PAC matching
    "skill-list-tool.ts",             # list_skills shape and outputSchema
]

# Compiler output recovered from the bundle.
RECONSTRUCTED = [
    "external-mcp-network-errors.js",  # the nine-category error taxonomy
    "external-mcp-oauth-config.js",
    "external-mcp-import.js",          # id/url validation, timeouts
    "custom-tool-skill.js",            # skill reason codes and fix hints
]

SECRET_RE = re.compile(
    r"(-----BEGIN [A-Z ]*PRIVATE KEY-----)"
    r"|(sk-[A-Za-z0-9]{20,})"
    r"|(ghp_[A-Za-z0-9]{20,})"
    r"|(xox[baprs]-[A-Za-z0-9-]{10,})"
    r"|(AKIA[0-9A-Z]{16})")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=".work/downloads/shuncode-0.8.1-mcp-skills.zip")
    parser.add_argument("--report", default="docs/evidence/mcp-skills-package.json")
    args = parser.parse_args()

    entries = []
    for name in ORIGINAL:
        entries.append((REPO / "recovered" / "shuncode-0.8.1" / "src" / name,
                        f"original-typescript/{name}", "original"))
    for name in RECONSTRUCTED:
        entries.append((REPO / "reconstructed" / "carrier-0.8.1" / "src" / name,
                        f"recovered-from-bundle/{name}", "compiler-output"))

    missing = [str(path) for path, _, _ in entries if not path.exists()]
    if missing:
        raise SystemExit("missing source files:\n  " + "\n  ".join(missing))

    manifest = []
    for path, arcname, kind in entries:
        text = path.read_text(encoding="utf8", errors="replace")
        found = SECRET_RE.search(text)
        if found:
            raise SystemExit(f"refusing to package {path}: looks like a secret "
                             f"at offset {found.start()}")
        manifest.append({
            "path": arcname,
            "kind": kind,
            "lines": text.count("\n"),
            "sha256": hashlib.sha256(text.encode("utf8")).hexdigest(),
            "caveat": ("Author's original TypeScript, types intact."
                       if kind == "original" else
                       "Compiler output from dist/extension.js: types and most "
                       "comments are erased, imports are not rewired. Read it, "
                       "do not run it."),
        })

    readme = (
        "ShunCode 0.8.1 - external MCP and Skills reference sources\n"
        "=========================================================\n\n"
        "These are reference material for the plan in WEB_AGENT_MCP_SKILLS_PLAN.md.\n"
        "They are NOT a drop-in library: ShunCode is a VS Code fork and these files\n"
        "import from a carrier the web_agent project does not have.\n\n"
        "original-typescript/\n"
        "    The author's own TypeScript, shipped verbatim inside the installer.\n"
        "    Type annotations and comments are intact. This is the better reference.\n\n"
        "recovered-from-bundle/\n"
        "    Sliced out of the shipped dist/extension.js. The logic is the author's\n"
        "    and the names are real, but TypeScript types and most comments were\n"
        "    erased by the compiler, and imports are not rewired. Read for behaviour,\n"
        "    never execute as-is.\n\n"
        "Copy ideas and constants, not files.\n")

    output = REPO / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        _add(archive, "README.txt", readme)
        for path, arcname, _ in entries:
            _add(archive, arcname, path.read_bytes())

    content_sha = hashlib.sha256(
        "".join(sorted(entry["sha256"] for entry in manifest)).encode("ascii")
    ).hexdigest()

    report = {
        "scope": ("Reference sources for the web_agent external-MCP/Skills plan. "
                  "Mixed provenance: original TypeScript plus compiler output "
                  "recovered from the shipped bundle."),
        "output": args.output,
        "fileCount": len(manifest),
        "originalCount": sum(1 for e in manifest if e["kind"] == "original"),
        "compilerOutputCount": sum(1 for e in manifest if e["kind"] == "compiler-output"),
        "totalLines": sum(e["lines"] for e in manifest),
        # The zip's own hash changes every build because of stored mtimes;
        # this one is stable and is what should be quoted.
        "contentSha256": content_sha,
        "secretScan": "Heuristic private-key/token patterns only; not a security audit.",
        "files": manifest,
    }
    (REPO / args.report).write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf8")

    print(f"packaged {len(manifest)} files "
          f"({report['originalCount']} original TypeScript, "
          f"{report['compilerOutputCount']} recovered from bundle), "
          f"{report['totalLines']} lines")
    print(f"  {args.output}")
    print(f"  contentSha256 {content_sha}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
