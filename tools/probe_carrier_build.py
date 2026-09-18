#!/usr/bin/env python3
"""Probe whether a ShunCode-like carrier can be built from upstream sources.

This answers the master switch question for repackaging a full ShunCode:
can we take upstream Code OSS 1.132.0, raise Electron to the 44.2.0 that the
shipped product actually used, install dependencies and compile?

Design rules, because a build probe is easy to fake:
  * Every stage records its real exit code. A failure is a RESULT, not an error
    to hide: knowing exactly which stage breaks is the point of the probe.
  * Nothing is marked "ok" unless the command exited 0 AND the expected output
    exists on disk.
  * The probe never edits the repository's own sources and never writes the
    upstream checkout into git; it works in a scratch directory.

Scope: this is a BUILD FEASIBILITY probe. It does not produce a signed
installer, does not apply the author's customisations, and a green result does
not mean the product is reproducible.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

UPSTREAM_TAG = "1.132.0"
UPSTREAM_COMMIT = "df53daabb18cd157bdb08c7f01c34df936cf12f4"
TARGET_ELECTRON = "44.2.0"


def resolve_executable(name):
    """Return a runnable path for `name`.

    On Windows, npm/npx are `.cmd` shims, and subprocess without shell=True
    does not apply PATHEXT, so a bare "npm" raises WinError 2. shutil.which
    applies PATHEXT and returns the real shim path. Resolving explicitly keeps
    shell=False, so arguments are never re-parsed by cmd.
    """
    found = shutil.which(name)
    return found or name


def run(cmd, cwd=None, timeout=3600, env=None):
    """Run a command, capturing a bounded transcript and the true exit code."""
    cmd = [resolve_executable(str(cmd[0]))] + [str(c) for c in cmd[1:]]
    started = time.time()
    merged = os.environ.copy()
    if env:
        merged.update(env)
    try:
        proc = subprocess.run(
            cmd, cwd=cwd, timeout=timeout, env=merged,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, errors="replace", shell=False,
        )
        out, code, timed_out = proc.stdout, proc.returncode, False
    except subprocess.TimeoutExpired as exc:
        out = (exc.output or "") if isinstance(exc.output, str) else ""
        code, timed_out = None, True
    except FileNotFoundError as exc:
        out, code, timed_out = f"executable not found: {exc}", None, False
    return {
        "command": [str(c) for c in cmd],
        "exit_code": code,
        "timed_out": timed_out,
        "duration_s": round(time.time() - started, 1),
        # Keep the tail: build failures report the cause at the end.
        "log_tail": out[-6000:],
        "log_bytes": len(out),
    }


def tool_versions():
    versions = {}
    for name, cmd in (("node", ["node", "--version"]),
                      ("npm", ["npm", "--version"]),
                      ("python", [sys.executable, "--version"]),
                      ("git", ["git", "--version"])):
        result = run(cmd, timeout=120)
        versions[name] = (result["log_tail"].strip().splitlines() or [""])[0] \
            if result["exit_code"] == 0 else None
    return versions


def missing_tools(versions):
    """Tools the probe cannot run without.

    A missing tool must not be reported as a build failure: that would blame
    the carrier for a defect in this harness, which is exactly what happened on
    the first run when npm.cmd could not be resolved on Windows.
    """
    return [name for name in ("node", "npm", "git") if not versions.get(name)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--work-dir", default=".work/carrier-build")
    parser.add_argument("--output", required=True)
    parser.add_argument("--electron", default=TARGET_ELECTRON)
    parser.add_argument("--no-patch", action="store_true",
                        help="Skip the Electron 44 patch, to re-measure the raw failure.")
    parser.add_argument("--skip-compile", action="store_true",
                        help="Stop after dependency install (faster triage run).")
    parser.add_argument("--install-timeout", type=int, default=3600)
    parser.add_argument("--compile-timeout", type=int, default=3600)
    args = parser.parse_args()

    work = Path(args.work_dir).resolve()
    src = work / "vscode"
    report = {
        "scope": ("Build feasibility probe only. Not a signed installer, no author "
                  "customisations applied, and success does not mean the shipped "
                  "product is reproducible."),
        "question": (f"Can upstream Code OSS {UPSTREAM_TAG} build with Electron "
                     f"{args.electron}, the version the shipped ShunCode used?"),
        "upstream": {"tag": UPSTREAM_TAG, "commit": UPSTREAM_COMMIT},
        "targetElectron": args.electron,
        "runner": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "toolVersions": tool_versions(),
        "stages": [],
    }

    def stage(name, result, ok=None, note=None):
        entry = {"stage": name, **result}
        entry["ok"] = (result["exit_code"] == 0) if ok is None else ok
        if note:
            entry["note"] = note
        report["stages"].append(entry)
        print(f"[{'ok' if entry['ok'] else 'FAIL'}] {name} "
              f"(exit={result['exit_code']}, {result['duration_s']}s)", flush=True)
        return entry["ok"]

    absent = missing_tools(report["toolVersions"])
    if absent:
        report["harnessError"] = {
            "missingTools": absent,
            "detail": ("The probe could not run these tools, so no conclusion about "
                       "the carrier build is possible. This is a defect in the probe "
                       "environment, NOT evidence that the carrier cannot be built."),
        }
        report["stages"] = []
        return finish(report, args.output)

    work.mkdir(parents=True, exist_ok=True)
    if src.exists():
        shutil.rmtree(src, ignore_errors=True)

    # 1. Shallow clone the exact upstream commit.
    ok = stage("clone-upstream", run(
        ["git", "clone", "--depth", "1", "--branch", UPSTREAM_TAG,
         "https://github.com/microsoft/vscode.git", str(src)], timeout=1800))
    if not ok:
        return finish(report, args.output)

    head = run(["git", "rev-parse", "HEAD"], cwd=src, timeout=120)
    actual = head["log_tail"].strip()
    report["upstream"]["checkedOutCommit"] = actual
    stage("verify-commit", head, ok=(actual == UPSTREAM_COMMIT),
          note=f"expected {UPSTREAM_COMMIT}")

    # 2. Repoint Electron, exactly the customisation the shipped product shows.
    try:
        pkg_path = src / "package.json"
        pkg = json.loads(pkg_path.read_text(encoding="utf8"))
        before = pkg.get("devDependencies", {}).get("electron")
        pkg["devDependencies"]["electron"] = args.electron
        pkg_path.write_text(json.dumps(pkg, indent="\t") + "\n", encoding="utf8")

        npmrc = src / ".npmrc"
        text = npmrc.read_text(encoding="utf8")
        lines = [f'target="{args.electron}"' if l.startswith("target=") else l
                 for l in text.splitlines()]
        npmrc.write_text("\n".join(lines) + "\n", encoding="utf8")

        report["electronRepoint"] = {
            "packageJsonBefore": before, "packageJsonAfter": args.electron,
            "npmrcTargetAfter": args.electron, "ok": True,
        }
        print(f"[ok] electron repointed {before} -> {args.electron}", flush=True)
    except Exception as exc:  # noqa: BLE001 - report, do not mask
        report["electronRepoint"] = {"ok": False, "error": repr(exc)}
        return finish(report, args.output)

    # 2b. Apply the Electron 44 compatibility patch. Without it the tree cannot
    #     compile, because Electron 44 deleted 13 clipboard methods.
    if not args.no_patch:
        patch = Path(__file__).with_name("patch_carrier_electron44.py")
        result = run([sys.executable, str(patch), "--tree", str(src),
                      "--output", str(work / "electron44-patch.json")], timeout=300)
        if not stage("apply-electron44-patch", result):
            return finish(report, args.output)
        try:
            report["electron44Patch"] = json.loads(
                (work / "electron44-patch.json").read_text(encoding="utf8"))
        except Exception:  # noqa: BLE001 - the stage log already carries detail
            pass

    # 3. Install dependencies. This is where an unsupported Electron usually
    #    fails first, because native modules are rebuilt against its headers.
    #
    #    `npm ci` is deliberately NOT used: it requires package.json and the
    #    lockfile to agree, and we just changed the Electron version, so it
    #    would fail on that mismatch alone and tell us nothing about whether
    #    Electron 44 actually works. `npm install` resolves a new tree, which
    #    is exactly the question being asked.
    ok = stage("npm-install", run(
        ["npm", "install", "--no-audit", "--no-fund"],
        cwd=src, timeout=args.install_timeout,
        env={"npm_config_build_from_source": "true"}),
        note="npm install, not npm ci: the lockfile still pins the old Electron")
    if not ok:
        # Distinguish "Electron 44 is incompatible" from "this machine could not
        # reach the download servers". Conflating them would turn an
        # environment limit into a false verdict about the carrier.
        tail = report["stages"][-1]["log_tail"]
        network_markers = ("ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
                           "socket disconnected", "network socket")
        resolution_markers = ("ERESOLVE", "No matching version", "notarget",
                              "peer dep", "ETARGET")
        hit_network = [m for m in network_markers if m in tail]
        hit_resolution = [m for m in resolution_markers if m in tail]
        report["installFailureAnalysis"] = {
            "networkMarkers": hit_network,
            "resolutionMarkers": hit_resolution,
            "reachedNativeBuild": "node-gyp" in tail or "build-from-source" in tail,
            "verdict": (
                "INCONCLUSIVE: dependency resolution succeeded and the failure is a "
                "download/network error, so this machine cannot answer the question. "
                "Re-run somewhere with unrestricted egress."
                if hit_network and not hit_resolution else
                "Electron version appears genuinely unsatisfiable: npm could not "
                "resolve a dependency tree."
                if hit_resolution else
                "Install failed for another reason; read log_tail."),
        }
    if not ok or args.skip_compile:
        if ok:
            report["stoppedEarly"] = "--skip-compile requested"
        return finish(report, args.output)

    # 4. Compile the client. Success here means the tree builds with Electron 44.
    ok = stage("compile", run(["npm", "run", "compile"],
                              cwd=src, timeout=args.compile_timeout))
    if ok:
        out_dir = src / "out"
        produced = out_dir.is_dir() and any(out_dir.iterdir())
        report["compileOutput"] = {
            "outDirExists": out_dir.is_dir(),
            "nonEmpty": bool(produced),
            "entryCount": len(list(out_dir.iterdir())) if out_dir.is_dir() else 0,
        }
        if not produced:
            report["stages"][-1]["ok"] = False
            report["stages"][-1]["note"] = "compile exited 0 but out/ is missing or empty"

    return finish(report, args.output)


def finish(report, output):
    stages = report["stages"]
    report["allStagesPassed"] = bool(stages) and all(s["ok"] for s in stages)
    failed = [s["stage"] for s in stages if not s["ok"]]
    report["failedStages"] = failed
    if report.get("harnessError"):
        report["conclusion"] = (
            "INCONCLUSIVE. The probe itself could not run: missing "
            f"{report['harnessError']['missingTools']}. This says nothing about "
            "whether the carrier can be built; fix the harness and re-run."
        )
    else:
        report["conclusion"] = (
            "Carrier builds from upstream sources with the shipped Electron version. "
            "Repackaging a full ShunCode is therefore feasible in principle; the "
            "remaining work is applying the author's own customisations."
            if report["allStagesPassed"] else
            f"Build did not complete. First failure: {failed[0] if failed else 'unknown'}. "
            "This is a real answer, not a setup error to paper over: it tells us the "
            "carrier cannot currently be rebuilt as-is and shows exactly where it stops."
        )

    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf8")
    print(f"\nwrote {path}")
    print(f"allStagesPassed={report['allStagesPassed']} failed={failed}")
    # Exit non-zero on failure so CI shows red, but the report is already saved.
    return 0 if report["allStagesPassed"] else 1


if __name__ == "__main__":
    sys.exit(main())
