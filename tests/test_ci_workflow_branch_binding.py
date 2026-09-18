"""Guard CI against being pinned to a single retired session branch.

Background: every workflow was hardcoded to `arena/01a09d2c-...`. After the
handoff to a new session branch that silently meant **zero** CI coverage for new
commits, and the two evidence-committing workflows would have checked out and
pushed back to the *old* branch. These assertions are structural text checks on
the workflow YAML (PyYAML is not a declared dependency of this repo, and the
recovery conda environment does not ship it), so they verify the exact strings
that GitHub Actions evaluates rather than a parsed approximation.

They deliberately do NOT claim the workflows pass, that runners are healthy, or
that any release gate is satisfied.
"""

import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[1] / '.github/workflows'
# The retired session branch that every workflow used to hardcode.
RETIRED_BRANCH = 'arena/01a09d2c-reverse-enginnering-of-shun'
# Workflows that commit generated evidence back to the branch that triggered them.
EVIDENCE_WRITERS = {'installer-forensics.yml', 'windows-static-probe.yml'}


def workflow_files():
    files = sorted(p for p in WORKFLOWS.glob('*.yml'))
    assert files, 'no workflow files found'
    return files


class WorkflowBranchBindingTests(unittest.TestCase):
    def test_no_workflow_pins_a_specific_session_branch_id(self):
        """A rotated session branch must not leave CI bound to the old id."""
        for path in workflow_files():
            text = path.read_text()
            self.assertNotIn(RETIRED_BRANCH, text, f'{path.name} still pins the retired branch')
            # Catch any other hardcoded arena session id, e.g. a future copy-paste.
            stray = re.findall(r'arena/[0-9a-f]{8}-[\w-]+', text)
            self.assertEqual([], stray, f'{path.name} hardcodes session branch(es): {stray}')

    def test_push_trigger_matches_the_session_branch_family(self):
        """Each workflow must trigger on the arena/** family, not one branch."""
        for path in workflow_files():
            text = path.read_text()
            self.assertRegex(
                text,
                r"branches:\s*(\[\s*'arena/\*\*'\s*\]|(\n\s*#[^\n]*)*\n\s*-\s*'arena/\*\*')",
                f'{path.name} does not trigger on the arena/** branch family',
            )

    def test_job_guards_accept_any_session_branch(self):
        """Job-level `if:` guards must not re-pin what the trigger just widened."""
        for path in workflow_files():
            for guard in re.findall(r'^\s{4}if:.*$', path.read_text(), re.MULTILINE):
                self.assertIn(
                    "startsWith(github.ref, 'refs/heads/arena/')",
                    guard,
                    f'{path.name} has a job guard that is not branch-agnostic: {guard.strip()}',
                )

    def test_evidence_writers_use_the_triggering_ref(self):
        """Checkout and push-back must follow the triggering ref, never a fixed branch."""
        for name in sorted(EVIDENCE_WRITERS):
            text = (WORKFLOWS / name).read_text()

            refs = re.findall(r'^\s*ref:\s*(\S.*)$', text, re.MULTILINE)
            checkout_refs = [r.strip() for r in refs]
            self.assertIn('${{ github.ref }}', checkout_refs, f'{name} never checks out the triggering ref')
            for ref in checkout_refs:
                # A pinned third-party action SHA is fine; a branch name is not.
                self.assertTrue(
                    ref == '${{ github.ref }}' or re.fullmatch(r'[0-9a-f]{40}', ref),
                    f'{name} checks out a non-triggering, non-pinned ref: {ref}',
                )

            # Match to end of line: the ref expression contains spaces (${{ github.ref }}).
            pushes = [m.strip() for m in re.findall(r'git push origin .*$', text, re.MULTILINE)]
            self.assertTrue(pushes, f'{name} is expected to push evidence back')
            for push in pushes:
                self.assertEqual(
                    'git push origin HEAD:${{ github.ref }}',
                    push,
                    f'{name} pushes to a branch other than the one that triggered it',
                )

    def test_evidence_writer_concurrency_is_scoped_per_branch(self):
        """A global group would serialise independent session branches."""
        for name in sorted(EVIDENCE_WRITERS):
            text = (WORKFLOWS / name).read_text()
            group = re.search(r'^\s*group:\s*(\S.*)$', text, re.MULTILINE)
            self.assertIsNotNone(group, f'{name} declares no concurrency group')
            self.assertIn(
                '${{ github.ref }}',
                group.group(1),
                f'{name} uses a branch-independent concurrency group: {group.group(1).strip()}',
            )


if __name__ == '__main__':
    unittest.main()
