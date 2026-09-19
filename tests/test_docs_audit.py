"""Documentation must stay consistent with the evidence it cites.

Added after a manual review missed the two most-read files in the repository:
the root README and docs/RECOVERY_STATUS, both still describing a state from two
days earlier and naming the wrong branch. Reviewing 57 files by eye does not
scale, so the mechanical parts are checked here.
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "audit_docs.py"


class DocsAuditTests(unittest.TestCase):
    def run_audit(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as handle:
            out = Path(handle.name)
        result = subprocess.run([sys.executable, str(TOOL), "--output", str(out)],
                                capture_output=True, text=True, cwd=REPO)
        report = json.loads(out.read_text(encoding="utf8"))
        out.unlink(missing_ok=True)
        return result, report

    def test_every_file_under_docs_is_consistent(self):
        """Not just markdown. The second review pass found 65 of the 103 files
        under docs/ had never been checked at all."""
        result, report = self.run_audit()
        self.assertGreater(report["markdownReviewed"], 50)
        self.assertGreater(report["nonMarkdownReviewed"], 60,
                           "audit is skipping the JSON evidence")
        self.assertEqual(report["findingCount"], 0, result.stdout)

    def test_every_evidence_file_declares_its_scope(self):
        """A probe with no scope statement can be mistaken for a broad claim."""
        source = TOOL.read_text(encoding="utf8")
        self.assertIn("doesNotClaim", source)
        self.assertIn("cannot tell what it does not claim", source)

    def test_scans_for_secrets(self):
        source = TOOL.read_text(encoding="utf8")
        self.assertIn("SECRET_RE", source)
        self.assertIn("PRIVATE KEY", source)

    def test_knows_upstream_scripts_are_not_ours(self):
        """`npm run compile` belongs to the Code OSS carrier; flagging it would
        be a false positive that trains readers to ignore the audit."""
        source = TOOL.read_text(encoding="utf8")
        self.assertIn("UPSTREAM_SCRIPTS", source)
        self.assertIn("compile", source)

    def test_states_what_it_cannot_check(self):
        _, report = self.run_audit()
        self.assertIn("still", report["limits"])
        self.assertIn("needs a human", report["limits"])
