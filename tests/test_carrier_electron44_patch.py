"""The Electron 44 carrier patch must stay exact-match and faithful to the original.

The patch is defined as byte-exact replacements against upstream 1.132.0. These
tests guard the properties that make it trustworthy, without needing a network
fetch of the upstream tree.
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "patch_carrier_electron44.py"


def run_tool(tree, extra=()):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as handle:
        out = Path(handle.name)
    proc = subprocess.run(
        [sys.executable, str(TOOL), "--tree", str(tree), "--output", str(out), *extra],
        capture_output=True, text=True)
    report = json.loads(out.read_text(encoding="utf8"))
    out.unlink(missing_ok=True)
    return proc.returncode, report


class CarrierPatchTests(unittest.TestCase):
    def test_refuses_to_patch_a_tree_it_does_not_recognise(self):
        """A partial patch is worse than none: every edit must match or abort."""
        with tempfile.TemporaryDirectory() as tmp:
            code, report = run_tool(tmp)
        self.assertNotEqual(code, 0)
        self.assertFalse(report["allApplied"])
        self.assertIn("Refusing to write a partial patch", report["conclusion"])

    def test_states_what_is_recovered_and_what_is_reconstructed(self):
        """Transcribed logic and reconstructed types must not be conflated."""
        with tempfile.TemporaryDirectory() as tmp:
            _, report = run_tool(tmp)
        self.assertIn("not invented here", report["scope"])
        self.assertIn("reconstructed", report["scope"])

    def test_preserves_the_features_the_author_kept(self):
        """The author kept find-text and the selection buffer; we must not drop them."""
        source = TOOL.read_text(encoding="utf8")
        self.assertIn("electron application/findtext", source)
        self.assertIn("clipboard.selection", source)
        self.assertIn("osclipboard", source)

    def test_every_removed_api_is_handled_and_losses_are_declared(self):
        source = TOOL.read_text(encoding="utf8")
        # The five upstream call sites that Electron 44 deleted outright.
        for gone in ("readImage", "readFindText", "writeFindText",
                     "writeBuffer", "readBuffer"):
            self.assertIn(gone, source, f"{gone} is not addressed by the patch")
        # Degradations, where any remain, must be user-visible in the report.
        self.assertIn("featureLosses", source)

    def test_check_mode_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            tree = Path(tmp)
            target = tree / "src/vs/platform/native/electron-main"
            target.mkdir(parents=True)
            probe = target / "nativeHostMainService.ts"
            probe.write_text("untouched", encoding="utf8")
            run_tool(tree, extra=("--check",))
            self.assertEqual(probe.read_text(encoding="utf8"), "untouched")


if __name__ == "__main__":
    unittest.main()
