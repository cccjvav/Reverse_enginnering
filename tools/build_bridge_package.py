#!/usr/bin/env python3
"""Build the Bridge source package handed to the web_agent project.

Kept as a tool rather than assembled by hand: .work/ is gitignored and does not
survive a sandbox reset, so the first hand-built package was lost. Everything
needed to rebuild it now lives in the repository.

Deliberately excludes the licence and payment code, which the author chose to
keep. bridge-access-controller.ts is left out because it imports
bridge-license-service and would not compile without it; bridge-server.ts was
checked and has no licence coupling, so Bridge still runs standalone.
"""

import argparse
import hashlib
import json
import re
import shutil
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CORE = REPO / "reconstructed" / "bridge-core" / "src"
TYPES = REPO / "reconstructed" / "bridge-core" / "types"
EXT = REPO / "recovered" / "shuncode-extension" / "src"
DOC = REPO / "community" / "bridge-package" / "README.md"

EXTENSION_LAYER = [
    "bridge-constants.ts", "bridge-mcp-modern.ts", "bridge-mcp-transport.ts",
    "bridge-server.ts", "bridge-tool-dispatcher.ts", "bridge-tunnel-lease.ts",
    "bridge-utils.ts", "extension-host-proxy.mts",
]
# Excluded on purpose; see the module docstring.
EXCLUDED = {"bridge-access-controller.ts", "bridge-license-service.ts",
            "bridge-license-config.ts"}

SECRET_RE = re.compile(
    r"sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|BEGIN (?:RSA |EC )?PRIVATE KEY")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=".work/downloads/shuncode-bridge-source.zip")
    parser.add_argument("--report", default="docs/evidence/bridge-package.json")
    args = parser.parse_args()

    staging = REPO / ".work" / "bridge-pkg"
    if staging.exists():
        shutil.rmtree(staging)
    for folder in ("bridge-core", "types", "bridge-extension-layer"):
        (staging / folder).mkdir(parents=True)

    for js in sorted(CORE.glob("*.js")):
        shutil.copy2(js, staging / "bridge-core" / js.name)
    for dts in sorted(TYPES.glob("*.d.ts")):
        shutil.copy2(dts, staging / "types" / dts.name)
    for name in EXTENSION_LAYER:
        assert name not in EXCLUDED, f"{name} is on the exclusion list"
        shutil.copy2(EXT / name, staging / "bridge-extension-layer" / name)
    shutil.copy2(DOC, staging / "README.md")

    # Refuse to ship a package that leaks a credential or drags in the licence
    # service through an import we forgot about.
    leaks, dangling = [], []
    for path in sorted(staging.rglob("*")):
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf8", errors="replace")
        if SECRET_RE.search(text):
            leaks.append(path.name)
        for excluded in EXCLUDED:
            stem = excluded.rsplit(".", 1)[0]
            if f'"./{stem}.js"' in text or f"'./{stem}.js'" in text:
                dangling.append(f"{path.name} -> {excluded}")
    if leaks:
        raise SystemExit(f"refusing to package, possible credentials in: {leaks}")
    if dangling:
        raise SystemExit(f"refusing to package, imports excluded modules: {dangling}")

    out = REPO / args.output
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(staging.rglob("*")):
            if path.is_file():
                archive.write(path, Path("handoff-pkg") / path.relative_to(staging))

    # The archive embeds file mtimes, so its sha256 changes between builds even
    # when the contents are identical. Hash the contents instead, so the report
    # carries a figure that actually means something.
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    content_digest = hashlib.sha256()
    for path in sorted(staging.rglob("*")):
        if path.is_file():
            content_digest.update(str(path.relative_to(staging)).encode())
            content_digest.update(path.read_bytes())
    content_digest = content_digest.hexdigest()
    report = {
        "scope": ("Build record for the Bridge source package handed to the "
                  "web_agent project. Records what was packaged and what was "
                  "deliberately left out; claims nothing about whether the code "
                  "runs in that project."),
        "archive": args.output,
        "archiveSha256": digest,
        "archiveSha256Note": ("Changes between builds: zip entries carry "
                              "mtimes. Compare contentSha256 instead."),
        "contentSha256": content_digest,
        "bytes": out.stat().st_size,
        "coreModules": len(list(CORE.glob("*.js"))),
        "typeDeclarations": len(list(TYPES.glob("*.d.ts"))),
        "extensionLayer": EXTENSION_LAYER,
        "excluded": sorted(EXCLUDED),
        "exclusionReason": ("Licence and payment code, kept by the author. "
                            "bridge-access-controller.ts imports "
                            "bridge-license-service and would not compile "
                            "without it; bridge-server.ts was verified to have "
                            "no licence coupling."),
        "secretScan": "clean",
        "danglingImportCheck": "clean",
    }
    (REPO / args.report).write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"built {args.output} ({out.stat().st_size} bytes)")
    print(f"  archive sha256 {digest}")
    print(f"  content sha256 {content_digest} (stable across rebuilds)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
