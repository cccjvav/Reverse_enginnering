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


class HostSurfaceGapTests(unittest.TestCase):
    """The missing Chat fields must stay described as a missing input, never
    fabricated onto the public vscode namespace."""

    def setUp(self):
        self.report = REPO / "docs" / "evidence" / "host-chat-surface.json"
        if not self.report.exists():
            self.skipTest("run probe_host_chat_surface.py first")
        self.data = json.loads(self.report.read_text(encoding="utf8"))

    def test_public_interface_really_is_smaller(self):
        self.assertEqual(self.data["publicMembers"], ["input", "output"])
        self.assertGreater(self.data["missingCount"], 0)

    def test_refuses_to_fabricate_the_host(self):
        self.assertIn("would turn 11 red errors green without recovering",
                      self.data["whyNotFixedHere"].replace("\n", " "))
        self.assertIn("false-host claim", self.data["whyNotFixedHere"])

    def test_every_missing_field_has_a_runtime_witness(self):
        """A field claimed missing must be shown to exist in the shipped
        product, otherwise it is speculation."""
        for name, detail in self.data["fields"].items():
            witness = detail["runtimeWitness"]
            self.assertIsNotNone(witness, name)
            self.assertGreater(witness["occurrences"], 0, name)

    def test_no_augmentation_file_was_written(self):
        """Guard against a later shortcut that declares these members."""
        for path in (REPO / "reference" / "vscode-types").glob("*.d.ts"):
            text = path.read_text(encoding="utf8", errors="replace")
            if "interface ChatSimpleToolResultData" in text:
                start = text.index("interface ChatSimpleToolResultData")
                body = text[start:text.index("\n\t}", start)]
                self.assertNotIn("presentationKind", body,
                                 "public host declarations must stay unmodified")


class HeaderNarrowingTests(unittest.TestCase):
    """The three transport errors were misdiagnosed as SDK drift; keep the
    corrected explanation and the credit for the existing fix."""

    def setUp(self):
        self.report = REPO / "docs" / "evidence" / "header-narrowing.json"
        if not self.report.exists():
            self.skipTest("run probe_header_narrowing.py first")
        self.data = json.loads(self.report.read_text(encoding="utf8"))

    def test_sdk_drift_hypothesis_is_recorded_as_rejected(self):
        rejected = self.data["hypothesisRejected"]
        self.assertTrue(rejected["match"],
                        "shipped and rebuilt protocol versions must agree")
        self.assertEqual(rejected["shippedProtocolVersion"], "2025-11-25")

    def test_defect_is_attributed_to_the_code_not_the_declarations(self):
        self.assertFalse(self.data["actualCause"]["guardRulesOutArray"])
        self.assertIn("would make the types lie", self.data["notADeclarationBug"])

    def test_credits_the_existing_maintenance_fix(self):
        """A fix already existed; re-solving it would have been waste."""
        addressed = self.data["alreadyAddressed"]
        self.assertIn("community/bridge-core/http-router.mjs", addressed["where"])
        self.assertIn("11 errors against 14", addressed["measuredEffect"])


class MaintenanceOverlayTests(unittest.TestCase):
    """The overlay must be honest about when it is valid."""

    def test_overlay_states_its_precondition(self):
        """The narrowed declaration is only true with the adapter in front, and
        the generated file must say so. Assert on the emitted text rather than
        the generator source, which wraps the sentence across lines."""
        source = (REPO / "tools" / "assemble_skeleton.py").read_text(encoding="utf8")
        self.assertIn("Valid ONLY when", source)
        self.assertIn("Without the adapter the unmodified declaration is the ",
                      source)
        overlaid = (REPO / ".work" / "skeleton" / "src"
                    / "bridge-http-router.d.ts")
        if not overlaid.exists():
            self.skipTest("run npm run assemble:skeleton-maintenance first")
        text = overlaid.read_text(encoding="utf8")
        if "MAINTENANCE OVERLAY" not in text:
            self.skipTest("skeleton assembled without --maintenance")
        self.assertIn("Valid ONLY when", text)
        self.assertIn("does not exclude string[]", text)


class HostShapeReconstructionTests(unittest.TestCase):
    """The reconstructed Chat shapes must stay evidence, and stay checkable."""

    PROBE = (REPO / "docs" / "evidence" / "host-chat-shapes"
             / "reconstruction-probe.ts")

    def test_probe_declares_itself_evidence_not_a_host(self):
        text = self.PROBE.read_text(encoding="utf8")
        self.assertIn("EVIDENCE, NOT A HOST DECLARATION", text)
        self.assertIn("Do not import this file into the build", text)
        self.assertIn("NOT a claim to have\n// recovered the host", text)

    def test_probe_typechecks_and_the_control_fails(self):
        result = subprocess.run(
            ["node", str(REPO / "tools" / "verify_host_shapes.mjs")],
            capture_output=True, text=True, cwd=REPO)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("mutated control was correctly rejected", result.stdout)

    def test_uses_key_set_comparison_not_bare_extends(self):
        """A two-way `extends` treats { label } and { label; description? } as
        equal, so an optional member can vanish unnoticed. That actually
        happened here before the helper was changed."""
        text = self.PROBE.read_text(encoding="utf8")
        self.assertIn("KeysEqual", text)
        self.assertIn("an optional member can vanish unnoticed", text)

    def test_shapes_are_recorded_with_their_evidence(self):
        report = REPO / "docs" / "evidence" / "host-chat-surface.json"
        if not report.exists():
            self.skipTest("run probe:host-chat first")
        data = json.loads(report.read_text(encoding="utf8"))
        for name, detail in data["fields"].items():
            shape = detail.get("reconstructedShape")
            self.assertIsNotNone(shape, name)
            self.assertTrue(shape["evidence"], name)
        # Confidence must be graded, not uniform.
        self.assertIn("presentationStyle", data["lowConfidence"])
        self.assertIn("Not resolved", data["knownDiscrepancy"])
