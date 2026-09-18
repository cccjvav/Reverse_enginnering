"""Guards for the B-layer typing work.

Typing 392 exports invites invention. These tests hold the line on the two
things that make the result trustworthy: the evidence inventory must keep
separating recovered fact from reconstruction, and hand-written declarations
must stay tied to a stated justification.
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TYPES = REPO / "reconstructed" / "bridge-core" / "types"
HARVEST = REPO / "tools" / "harvest_btype_evidence.py"


class EvidenceInventoryTests(unittest.TestCase):
    def setUp(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as handle:
            self.out = Path(handle.name)
        subprocess.run([sys.executable, str(HARVEST), "--output", str(self.out)],
                       capture_output=True, text=True, check=True)
        self.report = json.loads(self.out.read_text(encoding="utf8"))

    def tearDown(self):
        self.out.unlink(missing_ok=True)

    def test_states_plainly_that_the_originals_were_not_shipped(self):
        """These types are reconstructed; conflating them with the clipboard
        recovery would overstate what we have."""
        self.assertIn("never shipped", self.report["whyNotSimplyRecovered"])

    def test_keeps_first_hand_names_separate_from_inference(self):
        tier_a = self.report["tierA_firstHand"]
        self.assertGreater(tier_a["typeSymbols"], 0)
        # Names the author demonstrably wrote must be present and attributed.
        flat = json.dumps(tier_a)
        for name in ("ManagedCommandCancellationPreview", "ToolContentBlock",
                     "BridgeActivitySnapshot"):
            self.assertIn(name, flat)

    def test_does_not_overstate_coverage(self):
        tier_a = self.report["tierA_firstHand"]
        self.assertLess(tier_a["modulesReferenced"], self.report["moduleCount"],
                        "Tier A cannot cover every module; say so rather than imply it")
        self.assertTrue(self.report["unreferencedByAuthorSources"])
        self.assertIn("reconstruction from behaviour", self.report["doesNotClaim"])


class HandWrittenTypeTests(unittest.TestCase):
    def test_every_declaration_file_records_its_provenance(self):
        files = list(TYPES.glob("*.d.ts"))
        self.assertTrue(files, "no hand-written declarations found")
        for path in files:
            text = path.read_text(encoding="utf8")
            self.assertIn("PROVENANCE", text,
                          f"{path.name} does not say where its types came from")
            # Each tier label used must be explained in the same file.
            self.assertTrue(
                any(tier in text for tier in ("FIRST-HAND", "OBSERVED", "INFERRED")),
                f"{path.name} does not distinguish recovered fact from inference")

    def test_force_confirmation_is_not_silently_optional(self):
        """The implementation throws without it; the type must not invite a
        caller to default it to true."""
        path = TYPES / "managed-command-cancellation.d.ts"
        text = path.read_text(encoding="utf8")
        self.assertIn("FORCE_CONFIRMATION_REQUIRED", text)


class VerificationHarnessTests(unittest.TestCase):
    """The verifier must be able to fail; a check that cannot fail is noise."""

    def test_keeps_skiplibcheck_off_with_the_reason_recorded(self):
        # skipLibCheck: true suppresses checking of .d.ts bodies, so a
        # declaration naming a nonexistent type compiles clean. This was a real
        # false pass, not a hypothetical.
        source = (REPO / "tools" / "verify_btypes.mjs").read_text(encoding="utf8")
        self.assertIn("skipLibCheck: false", source)
        self.assertIn("must stay OFF", source)

    def test_refuses_to_pass_when_the_compiler_is_missing(self):
        source = (REPO / "tools" / "verify_btypes.mjs").read_text(encoding="utf8")
        self.assertIn("tsc not found", source)
        self.assertIn("do not treat a missing compiler as a pass", source)

    def test_includes_a_control_that_must_fail(self):
        source = (REPO / "tools" / "verify_btypes.mjs").read_text(encoding="utf8")
        self.assertIn("deliberately broken control compiled", source)


if __name__ == "__main__":
    unittest.main()
