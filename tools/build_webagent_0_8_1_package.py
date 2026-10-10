#!/usr/bin/env python3
"""Package the ShunCode 0.8.1 sources web_agent can actually use.

Companion to docs/handoff/WEB_AGENT_0.8.1_整合方案.md. That plan is given to
the other project's assistant, which cannot read this repository, so every
file the plan cites has to travel with it.

Scope is deliberately narrower than "everything new in 0.8.1":

  included  tunnel reachability, proxy support, startup failure codes,
            skill import, terminal contract, stateless request identity
  excluded  payment and licensing (the user asked for these to be left out),
            and the external-MCP set already shipped in the earlier
            shuncode-0.8.1-mcp-skills.zip

Two kinds of file go in, and they are NOT equivalent:

  recovered/shuncode-0.8.1/src/*     the author's original TypeScript,
                                     shipped in the installer, types intact.
  reconstructed/carrier-0.8.1/src/*  compiler output sliced out of
                                     dist/extension.js. Readable logic, but
                                     types and most comments are erased and
                                     imports are not rewired.

A secret scan runs over everything: these are another person's shipped
sources and must not carry a credential into a second repository.
"""

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Zip entries normally carry each file's mtime, so two builds of identical
# content produce different archive bytes. Pin every entry to a fixed
# timestamp and mode so the archive itself is byte-reproducible.
FIXED_DATE = (1980, 1, 1, 0, 0, 0)


def _add(archive, arcname, data):
    info = zipfile.ZipInfo(str(arcname), date_time=FIXED_DATE)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    archive.writestr(info, data)


# (filename, why web_agent would read it)
ORIGINAL = [
    # P0/P1 - tunnel reachability. web_agent runs the same two providers.
    ("bridge-quick-tunnel.ts",
     "P0. The --config and --protocol fixes. web_agent's cloudflared.js:228 "
     "has neither. Pure functions, no I/O, no vscode."),
    ("cloudflare-edge-relay.ts",
     "P1. Local CONNECT relay so cloudflared can reach the edge through an "
     "HTTP proxy, which cloudflared itself cannot do."),
    ("proxy-bypass.mts",
     "P1. NO_PROXY matching, including host:port and macOS abbreviated "
     "networks such as 169.254/16."),
    ("extension-host-proxy.mts",
     "P1. CANDIDATE_LOCAL_PROXY_PORTS: 14 local proxy clients with probing "
     "and a working-proxy cache. web_agent has no proxy support at all."),
    ("bridge-start-failure.ts",
     "P1. ~24 stable startup failure codes as a contract between host and "
     "UI. Pure module, unit-testable."),
    ("bridge-tunnel-lease.ts",
     "Reference. Cross-process lease over an abstract socket / named pipe, "
     "plus reclaiming a stale tunnel owner."),
    ("bridge-route-token.ts",
     "Reference. Route identity is published only after durable storage "
     "succeeds; initialize/reset are serialized."),
    ("bridge-route-token-storage.ts",
     "Reference. The lease retry loop around the route token."),
    # P2 - skills. web_agent has reading only, no import path.
    ("skill-center.ts",
     "P2. The import pipeline's orchestration and its three rules: import "
     "is a transaction, the previous directory is never modified, nothing "
     "in the package is executed."),
    ("skill-list-tool.ts",
     "P2. Read-only skill discovery shape for remote clients."),
    # P2/P3 - terminal and stateless identity.
    ("managed-bash-protocol.ts",
     "P2. Windows ConPTY + bundled PortableGit bash startup, including the "
     "stty -icanon fix for MSYS reporting a false EOF."),
    ("bridge-mcp-modern.ts",
     "P3. The stateless 2026 request path: identity from credential/client/"
     "workspace instead of an MCP session."),
    # Items 1-13: external MCP and Skills. Previously shipped in the separate
    # shuncode-0.8.1-mcp-skills.zip, folded in here so there is one package.
    ("external-mcp-oauth-flow.ts",
     "Item 1. Outbound DCR + PKCE(S256) + refresh. web_agent accepts only a "
     "static bearer token, so OAuth-gated servers are unreachable."),
    ("external-mcp-oauth.ts", "Item 1. Outbound OAuth surface."),
    ("external-mcp-stdio-env.ts",
     "Item 2. Managed child environment. web_agent's BASE_ENV has 11 entries; "
     "13 more are needed for npx/uvx/pip/git servers. Do NOT copy COMSPEC."),
    ("external-mcp-connection.ts",
     "Item 3. Transport negotiation; downgrade ONLY on 400/404/405/406/415, "
     "never on auth/rate-limit/server/network errors."),
    ("external-mcp-network.ts",
     "Item 4. Extra CA certificates and the settings fingerprint that forces "
     "a reconnect when proxy/CA settings change."),
    ("external-mcp-diagnose.ts",
     "Item 6. Staged route/dns/tcp/tls/http probe that carries no credential."),
    ("external-mcp-status.ts",
     "Item 7. Eight-state vocabulary; needs-auth and proxy-error are the two "
     "web_agent is missing."),
    ("external-mcp-secret-fields.ts",
     "Items 10-11. Reserved headers and field limits (40 fields / 4096 B)."),
    ("external-mcp-preview-token.ts",
     "Item 12. Confirmation token from a random HMAC key, NOT a hash of the "
     "input (the input contains credentials)."),
    ("external-mcp-native-refs.ts",
     "Item 13. Pass config by reference with a 5 min TTL, max 10 entries."),
    ("external-mcp-registry.ts", "Item 3/7. Connection lifecycle."),
    ("external-mcp-catalog.ts", "Reference. Config store, migration, validation."),
    # Small, directly reusable.
    ("model-endpoint-url.mts",
     "Small win. OpenAI-compatible base URL normalisation: repeated /v1, "
     "pasted /chat/completions, and the api.deepseek.com exception."),
]

RECONSTRUCTED = [
    ("bridge-ngrok-failure.js",
     "P1. ERR_NGROK_334 / 'endpoint is already online'; retryable vs not. "
     "web_agent uses ngrok too."),
    ("bridge-agent-instructions.js",
     "P2. The shell contract text given to the model. web_agent runs "
     "PowerShell on Windows, so rewrite rather than copy verbatim."),
    ("bridge-task-store.js",
     "P2. Task/todo store: 32 tasks, 8 history, 8 terminal entries, 24h TTL."),
    ("bridge-task-owner.js",
     "P3. Owner identity digest and the modern:/task-modern: prefixes."),
    ("external-mcp-network-errors.js",
     "Item 5. The nine-category network error taxonomy, keyed on error CODE "
     "sets rather than message regexes."),
    ("external-mcp-oauth-config.js", "Item 1. OAuth config shape."),
    ("external-mcp-import.js", "Reference. Id/url validation and timeouts."),
    ("custom-tool-skill.js",
     "Item 8. Skill failure reason codes and fix hints."),
    ("ide-tool-output.js",
     "P2. Structured output tags for run_command / get_command_output / "
     "cancel_command / send_command_input."),
    # Skill import subsystem - all compiler output, read for behaviour only.
    ("skill-import-journal.js", "P2. Journalled commit: crash-safe rollback/resume."),
    ("skill-archive.js", "P2. Worker-thread archive extraction."),
    ("skill-archive-limits.js", "P2. Decompression-bomb limits."),
    ("skill-archive-detect.js", "P2. Archive format detection."),
    ("global-skill-import.js", "P2. prepare -> preview -> commit."),
    ("global-skill-migration.js", "P2. Validated per-skill migration."),
    ("global-skill-catalog.js", "P2. Load and diagnose."),
    ("global-skill-paths.js", "P2. Directory resolution and versioning."),
    ("global-skill-settings.js", "P2. Shared location setting."),
    ("skill-fs-retry.js", "P2. Retry around Windows file locking."),
    ("skill-import-recovery.js",
     "P2. Sweeps interrupted imports at startup."),
]

SECRET_RE = re.compile(
    r"(-----BEGIN [A-Z ]*PRIVATE KEY-----)"
    r"|(sk-[A-Za-z0-9]{20,})"
    r"|(ghp_[A-Za-z0-9]{20,})"
    r"|(xox[baprs]-[A-Za-z0-9-]{10,})"
    r"|(AKIA[0-9A-Z]{16})")

# (repo path, name inside the archive)
DOCS = [
    ("docs/handoff/WEB_AGENT_总方案-0.8.1.md", "总表.md"),
    ("docs/handoff/WEB_AGENT_MCP_SKILLS_PLAN.md", "方案-外部MCP与Skills.md"),
    ("docs/handoff/WEB_AGENT_0.8.1_整合方案.md", "方案-隧道代理终端.md"),
    ("docs/handoff/WEB_AGENT_方法论优化-0.8.1.md", "方法论优化.md"),
]

README = """ShunCode 0.8.1 - reference sources for web_agent
================================================

Read 总表.md first: it lists all 23 items with their benefit, cost and
priority, plus 13 things NOT to change because web_agent already does them
better. 方案-*.md expand each item.

方法论优化.md is a different kind of document: instead of "web_agent is
missing X", it distills the recurring *approach* in ShunCode's source and
applies it to web_agent's own architecture. Most of its 8 proposals have no
direct ShunCode counterpart.

Scope: tunnel reachability, proxy support, startup failure codes, skill
import, terminal contract, stateless request identity.
Deliberately excluded: payment/licensing, and the external-MCP set already
delivered in shuncode-0.8.1-mcp-skills.zip.

original-typescript/
    The author's own TypeScript, shipped verbatim inside the installer.
    Type annotations and comments are intact. This is the better reference.

recovered-from-bundle/
    Sliced out of the shipped dist/extension.js. The logic is the author's
    and the names are real, but TypeScript types and most comments were
    erased by the compiler, and imports are not rewired. Read for behaviour,
    never execute as-is.

These are NOT a drop-in library. ShunCode is a VS Code fork; these files
import from a carrier web_agent does not have. Copy ideas and constants,
not files.

MANIFEST.json lists every entry with its sha256 and why it is here.
"""


def collect(names, base, arc_prefix, kind):
    entries = []
    for name, why in names:
        entries.append((base / name, f"{arc_prefix}/{name}", kind, why))
    return entries


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output",
                        default=".work/downloads/shuncode-0.8.1-webagent.zip")
    parser.add_argument("--report",
                        default="docs/evidence/webagent-0-8-1-package.json")
    args = parser.parse_args()

    entries = collect(ORIGINAL, REPO / "recovered" / "shuncode-0.8.1" / "src",
                      "original-typescript", "original")
    entries += collect(RECONSTRUCTED,
                       REPO / "reconstructed" / "carrier-0.8.1" / "src",
                       "recovered-from-bundle", "compiler-output")

    missing = [str(p) for p, _, _, _ in entries if not p.exists()]
    if missing:
        raise SystemExit("missing source files:\n  " + "\n  ".join(missing))

    docs = []
    for rel, arcname in DOCS:
        path = REPO / rel
        if not path.exists():
            raise SystemExit(f"missing plan document: {path}")
        docs.append((path, arcname, rel))

    manifest = []
    total_lines = 0
    for path, arcname, kind, why in entries:
        text = path.read_text(encoding="utf8", errors="replace")
        found = SECRET_RE.search(text)
        if found:
            raise SystemExit(f"refusing to package {path}: looks like a "
                             f"secret at offset {found.start()}")
        lines = text.count("\n")
        total_lines += lines
        manifest.append({
            "path": arcname,
            "kind": kind,
            "lines": lines,
            "sha256": hashlib.sha256(text.encode("utf8")).hexdigest(),
            "whyIncluded": why,
            "caveat": ("Author's original TypeScript, types intact."
                       if kind == "original" else
                       "Compiler output from dist/extension.js: types and "
                       "most comments are erased, imports are not rewired. "
                       "Read it, do not run it."),
        })

    doc_blobs = []
    for path, arcname, rel in docs:
        text = path.read_text(encoding="utf8")
        if SECRET_RE.search(text):
            raise SystemExit(f"refusing to package {rel}: looks like a secret")
        doc_blobs.append((arcname, text.encode("utf8")))

    output = REPO / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        _add(archive, "README.txt", README)
        for arcname, blob in doc_blobs:
            _add(archive, arcname, blob)
        _add(archive, "MANIFEST.json",
             json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        for path, arcname, _, _ in entries:
            _add(archive, arcname, path.read_bytes())

    content_sha = hashlib.sha256(
        "".join(sorted(e["sha256"] for e in manifest)).encode("ascii")
    ).hexdigest()

    report = {
        "scope": ("Build record for the 0.8.1 reference package handed to the "
                  "web_agent project. Records what was packaged and why; "
                  "claims nothing about whether the code runs there."),
        "archive": args.output,
        "archiveSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "archiveSha256Note": ("Reproducible: zip entries are pinned to a "
                              "fixed timestamp, so rebuilding identical "
                              "content yields this same digest."),
        "contentSha256": content_sha,
        "contentSha256Note": ("sha256 over the sorted per-file digests, so it "
                              "is independent of zip metadata."),
        "bytes": output.stat().st_size,
        "fileCount": len(manifest) + 2 + len(doc_blobs),
        "sourceCount": len(manifest),
        "totalLines": total_lines,
        "plans": [rel for _, _, rel in docs],
        "comparedAgainst": ("web_agent branch arena/01a0e8ea-web-agent @ "
                            "cf313c1"),
        "excluded": ["payment and licensing sources (user asked to skip)"],
        "supersedes": "shuncode-0.8.1-mcp-skills.zip",
        "secretScan": "passed",
        "files": manifest,
    }
    report_path = REPO / args.report
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False)
                           + "\n", encoding="utf8")

    print(f"packaged {len(manifest)} source file(s), {total_lines} lines "
          f"-> {args.output}")
    print(f"  contentSha256 {content_sha}")
    print(f"  report        {args.report}")


if __name__ == "__main__":
    main()
