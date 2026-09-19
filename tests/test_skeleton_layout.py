"""The project layout must stay recovered from evidence, not invented.

Step 3 assembles the A and B layers into the directory structure ShunCode was
actually built in. The structure is read out of the author's own shipped
tsconfig.json, so these tests guard the reading rather than a design choice.
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "assemble_skeleton.py"
REPORT = REPO / "docs" / "evidence" / "skeleton.json"


class LayoutProvenanceTests(unittest.TestCase):
    def test_layout_comes_from_the_authors_tsconfig(self):
        source = TOOL.read_text(encoding="utf8")
        self.assertIn("RECOVERED, NOT DESIGNED", source)
        self.assertIn("tsconfig.json", source)

    def test_both_import_spellings_resolve_to_one_place(self):
        """`../../src/x.ts` from the extension dir and `../../../src/x.js` from
        its src/ must land on the same file, or the layout is misread."""
        import posixpath
        ext = "extensions/shuncode"
        from_config = posixpath.normpath(posixpath.join(ext, "../../src/x"))
        from_source = posixpath.normpath(posixpath.join(ext + "/src", "../../../src/x"))
        self.assertEqual(from_config, from_source)
        self.assertEqual(from_config, "src/x")

    def test_dry_run_reports_what_was_never_recovered(self):
        result = subprocess.run(
            [sys.executable, str(TOOL), "--dry-run", "--report",
             str(REPO / ".work" / "skeleton-dryrun.json")],
            capture_output=True, text=True, check=True)
        report = json.loads(
            (REPO / ".work" / "skeleton-dryrun.json").read_text(encoding="utf8"))
        self.assertEqual(report["coreModules"], 41)
        self.assertEqual(report["extensionSources"], 34)
        # The author's tsconfig asks for two B-layer modules as .ts and a test
        # file; none were shipped. That gap must stay visible.
        self.assertEqual(report["missingCount"], 3)
        declared = {m["declared"] for m in report["missingFromAuthorTsconfig"]}
        self.assertIn("../../src/file-tool-registry.ts", declared)

    def test_records_that_the_host_types_are_public_candidates(self):
        if not REPORT.exists():
            self.skipTest("run npm run assemble:skeleton first")
        report = json.loads(REPORT.read_text(encoding="utf8"))
        self.assertIn("not the author's private host", report["hostCaveat"])
        self.assertIn("is not a build", report["doesNotClaim"])


if __name__ == "__main__":
    unittest.main()
