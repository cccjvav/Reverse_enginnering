#!/usr/bin/env python3
"""Explain the last three skeleton errors, which are not what they looked like.

The remaining errors in bridge-mcp-transport.ts were filed as "MCP SDK drift".
That turned out to be wrong, and the correction matters more than the errors:

  * The shipped protocol version is LATEST_PROTOCOL_VERSION = "2025-11-25",
    which matches reconstructed/bridge-core/src/snapshot-sdk-versions.js and the
    installed @modelcontextprotocol/* 2.0.0 exactly. No drift.
  * The errors are all TS2345 on `string | string[]` versus `string`.

WHAT IS ACTUALLY HAPPENING. bridge-http-router.js reads four custom request
headers straight off `request.headers`. Node types any non-standard header as
`string | string[] | undefined`, because HTTP permits a header to repeat. The
router guards only against absence:

    if (!sessionId) { ...400... }
    await handlers.handleGet(request, response, sessionId);

An empty check rules out undefined. It does NOT rule out `string[]`. The
author's own handlers then declare the parameter as plain `string`
(bridge-mcp-transport.ts:494, :524), so a client sending a duplicated
`Mcp-Session-Id` header hands them an array where they expect a string.

This is a real latent defect in the shipped product, surfaced by typechecking
the recovered sources honestly. It is NOT:

  * a mistake in the B-layer declarations - they describe what the JavaScript
    does, and loosening them to `string` would be a false description
  * something to silence with a cast, which would hide the defect while
    claiming the typecheck as progress

ALREADY SOLVED, BY EARLIER WORK. Before proposing a fix I checked whether one
existed, and it does: community/bridge-core/http-router.mjs wraps the router and
answers 400 "Ambiguous MCP protocol header" when any of the four headers arrives
repeated or non-scalar. Running the linked diagnostic in httpMaintenance mode
drops the error count from 14 to 11 - all three of these errors disappear.

So the correct conclusion is not "here is a fix" but "the maintenance layer
already closes this, and the skeleton simply is not using it yet". Recorded that
way rather than re-solving a solved problem.
"""

import argparse
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ROUTER = REPO / "reconstructed" / "bridge-core" / "src" / "bridge-http-router.js"
TRANSPORT = (REPO / "recovered" / "shuncode-extension" / "src"
             / "bridge-mcp-transport.ts")
SNAPSHOT = (REPO / "reconstructed" / "bridge-core" / "src"
            / "snapshot-sdk-versions.js")
BUNDLE = REPO / "recovered" / "shuncode-extension" / "runtime" / "mcp-server.js"


def protocol_versions():
    shipped = re.search(r'LATEST_PROTOCOL_VERSION\s*=\s*"([^"]+)"',
                        BUNDLE.read_text(encoding="utf8", errors="replace"))
    rebuilt = re.search(r'LATEST_PROTOCOL_VERSION\s*=\s*"([^"]+)"',
                        SNAPSHOT.read_text(encoding="utf8", errors="replace"))
    return (shipped.group(1) if shipped else None,
            rebuilt.group(1) if rebuilt else None)


def header_reads():
    text = ROUTER.read_text(encoding="utf8", errors="replace")
    return sorted(set(re.findall(r'request\.headers\["([a-zA-Z-]+)"\]', text)))


def handler_signatures():
    text = TRANSPORT.read_text(encoding="utf8", errors="replace")
    found = {}
    for name in ("handlePost", "handleGet", "handleDelete"):
        match = re.search(rf"private async {name}\(([^)]*)\)", text)
        if match:
            params = [p.strip() for p in match.group(1).split(",")]
            session = next((p for p in params if p.startswith("sessionId")), None)
            found[name] = session
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    shipped, rebuilt = protocol_versions()
    headers = header_reads()
    signatures = handler_signatures()

    text = ROUTER.read_text(encoding="utf8", errors="replace")
    normalises = bool(re.search(r"Array\.isArray\(\s*sessionId", text))

    report = {
        "scope": ("Explains the three remaining bridge-mcp-transport.ts errors. "
                  "Reports only; changes no code."),
        "originalHypothesis": "MCP SDK version drift.",
        "hypothesisRejected": {
            "shippedProtocolVersion": shipped,
            "rebuiltSnapshotVersion": rebuilt,
            "match": shipped == rebuilt,
            "installedSdk": "2.0.0",
            "note": ("The shipped bundle, the rebuilt snapshot module and the "
                     "installed SDK agree on the protocol version, so drift was "
                     "the wrong explanation."),
        },
        "actualCause": {
            "customHeadersRead": headers,
            "nodeTypesThemAs": "string | string[] | undefined",
            "reason": "HTTP allows a header to repeat, so Node cannot narrow it.",
            "routerGuard": "if (!sessionId) -> 400",
            "guardRulesOutUndefined": True,
            "guardRulesOutArray": False,
            "routerNormalisesArrays": normalises,
            "authorHandlerSignatures": signatures,
        },
        "latentDefect": (
            "A client sending a duplicated Mcp-Session-Id header passes a "
            "string[] into handlers that declare `sessionId: string`. The "
            "emptiness check does not exclude arrays. This is a real defect in "
            "the shipped product, exposed by typechecking rather than caused by "
            "it."),
        "notADeclarationBug": (
            "The B-layer declarations describe what the JavaScript actually "
            "does. Loosening them to `string` would make the types lie and "
            "would erase the finding."),
        "alreadyAddressed": {
            "where": "community/bridge-core/http-router.mjs",
            "how": ("Wraps handleBridgeHttpRequest and answers 400 'Ambiguous "
                    "MCP protocol header' when any of the four headers is "
                    "repeated or non-scalar, so handlers only ever see a "
                    "scalar."),
            "measuredEffect": ("diagnoseTypes({httpMaintenance:true}) reports 11 "
                               "errors against 14 without it - exactly these "
                               "three."),
            "note": ("Found by checking for an existing fix before writing one. "
                     "The skeleton does not yet wire in the maintenance layer, "
                     "which is why it still reports 14."),
        },
        "errorCountExplained": 3,
    }
    Path(args.output).write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"protocol: shipped={shipped} rebuilt={rebuilt} match={shipped == rebuilt}")
    print(f"custom headers read: {headers}")
    print(f"router normalises arrays: {normalises}")
    for name, signature in signatures.items():
        print(f"  {name}({signature})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
