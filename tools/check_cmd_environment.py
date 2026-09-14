"""Read-only conda environment check. Never activates/installs packages or opens GUI."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def inside_prefix(filename: str | None, prefix: str | None) -> bool:
    if not filename or not prefix:
        return False
    candidate = os.path.normcase(os.path.realpath(filename))
    root = os.path.normcase(os.path.realpath(prefix))
    try:
        return os.path.commonpath([candidate, root]) == root
    except ValueError:
        return False


def supported_node(version: str) -> bool:
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", version.strip())
    if not match:
        return False
    major, minor, _ = map(int, match.groups())
    return (major == 22 and minor >= 13) or major >= 24


def node_version(executable: str) -> str:
    return subprocess.run([executable, "--version"], check=True, capture_output=True,
                          text=True, stdin=subprocess.DEVNULL, timeout=10).stdout.strip()


def tkinter_version() -> str:
    import tkinter
    # Import only: do not create Tk(), a window, or a display connection.
    return str(tkinter.TkVersion)


def inspect_environment(*, environ=None, executable=None, python_version=None,
                        find=None, probe_node=None, probe_tk=None) -> dict:
    env = os.environ if environ is None else environ
    executable = sys.executable if executable is None else executable
    python_version = sys.version_info[:3] if python_version is None else python_version
    find = shutil.which if find is None else find
    probe_node = node_version if probe_node is None else probe_node
    probe_tk = tkinter_version if probe_tk is None else probe_tk
    prefix = env.get("CONDA_PREFIX")
    node = find("node")
    npm = find("npm.cmd" if os.name == "nt" else "npm")
    checks = {
        "conda_active": bool(prefix),
        "conda_metadata_present": bool(prefix) and (Path(prefix) / "conda-meta").is_dir(),
        "python_in_active_conda": inside_prefix(executable, prefix),
        "python_supported": tuple(python_version) >= (3, 10),
        "node_in_active_conda": inside_prefix(node, prefix),
        "npm_in_active_conda": inside_prefix(npm, prefix),
    }
    details = {"conda_prefix": prefix, "python": executable,
               "python_version": ".".join(map(str, python_version)), "node": node, "npm": npm}
    try:
        # Do not execute a stray global Node when environment selection is wrong.
        version = probe_node(node) if checks["node_in_active_conda"] else ""
        checks["node_supported"] = supported_node(version)
        details["node_version"] = version
    except (OSError, subprocess.SubprocessError) as error:
        checks["node_supported"] = False
        details["node_probe_error"] = type(error).__name__
    try:
        details["tk_version"] = probe_tk()
        checks["tk_importable"] = True
    except (ImportError, OSError) as error:
        checks["tk_importable"] = False
        details["tk_probe_error"] = type(error).__name__
    return {"ok": all(checks.values()), "checks": checks, "details": details,
            "scope": "Environment selection/version/import checks only; not GUI, application or build acceptance."}


if __name__ == "__main__":
    result = inspect_environment()
    print(json.dumps(result, indent=2, ensure_ascii=True))
    if not result["ok"]:
        print("Environment mismatch. See docs/WINDOWS_CMD_CONDA.md. No settings were changed.", file=sys.stderr)
    sys.exit(0 if result["ok"] else 2)
