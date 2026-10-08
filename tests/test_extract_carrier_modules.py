import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / 'tools' / 'extract_carrier_modules.py'

BUNDLE = '''\
// src/first-module.ts
init_define_SHUNCODE_BUILD_INFO();
var FIRST_LIMIT = 7;
function firstThing(value) {
  return value * FIRST_LIMIT;
}

// node_modules/vendor/index.js
init_define_SHUNCODE_BUILD_INFO();
var vendorNoise = 1;

// src/second-module.ts
init_define_SHUNCODE_BUILD_INFO();
function secondThing() {
  return "ok";
}

// src/type-only.ts
init_define_SHUNCODE_BUILD_INFO();
'''


def run(bundle_dir, *extra):
    out = bundle_dir / 'out'
    report = bundle_dir / 'report.json'
    result = subprocess.run(
        [sys.executable, str(TOOL),
         '--bundle', str(bundle_dir / 'extension.js'),
         '--sources', str(bundle_dir / 'src'),
         '--output', str(out), '--report', str(report), *extra],
        capture_output=True, text=True, check=True)
    return out, json.loads(report.read_text()), result.stdout


class ExtractCarrierModulesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / 'extension.js').write_text(BUNDLE, encoding='utf8')
        src = self.tmp / 'src'
        src.mkdir()
        # Only first-module is imported directly by the extension.
        (src / 'caller.ts').write_text(
            'import { firstThing } from "../../../src/first-module.js";\n',
            encoding='utf8')

    def test_default_mode_takes_only_direct_imports(self):
        out, report, _ = run(self.tmp)
        self.assertEqual(report['mode'], 'direct-imports-only')
        self.assertEqual(report['extractedCount'], 1)
        self.assertEqual(report['missing'], [])
        self.assertTrue((out / 'first-module.js').exists())
        self.assertFalse((out / 'second-module.js').exists())

    def test_all_mode_covers_the_dependency_closure(self):
        out, report, _ = run(self.tmp, '--all')
        self.assertEqual(report['mode'], 'all-src-modules-in-bundle')
        self.assertEqual(report['directImportCount'], 1)
        # first, second and type-only; never the node_modules vendor block.
        self.assertEqual(report['extractedCount'], 3)
        # Vendor blocks must not even be *wanted*: if they leak into the
        # wanted set they land in 'missing', which looks like a failed
        # extraction of something that was never the author's code.
        self.assertEqual(report['missing'], [])
        self.assertEqual(report['wantedCount'], 3)
        self.assertFalse((out / 'index.js').exists())
        self.assertNotIn('vendorNoise', (out / 'first-module.js').read_text())

    def test_module_bodies_keep_the_authored_names(self):
        out, _, _ = run(self.tmp)
        body = (out / 'first-module.js').read_text()
        self.assertIn('FIRST_LIMIT = 7', body)
        self.assertIn('function firstThing(value)', body)
        # The bundler's per-module preamble carries no authored meaning.
        self.assertNotIn('init_define_', body)

    def test_each_file_says_it_is_compiler_output(self):
        out, _, _ = run(self.tmp)
        header = (out / 'first-module.js').read_text()[:400]
        self.assertIn('EXTRACTED from src/first-module.ts', header)
        # Claiming these are the author's source would be the whole risk here.
        self.assertIn('not the author', header)

    def test_type_only_files_are_reported_rather_than_hidden(self):
        _, report, stdout = run(self.tmp, '--all')
        self.assertIn('type-only', report['emptyAfterCompile'])
        self.assertIn('compiled to nothing', stdout)

    def test_a_carrier_import_absent_from_the_bundle_is_reported(self):
        # Silence here would be the dangerous failure: a module the extension
        # needs but that the bundle does not contain must be named, not
        # quietly omitted from the output directory.
        (self.tmp / 'src' / 'caller.ts').write_text(
            'import { firstThing } from "../../../src/first-module.js";\n'
            'import { gone } from "../../../src/never-shipped.js";\n',
            encoding='utf8')
        out, report, stdout = run(self.tmp)
        self.assertEqual(report['missing'], ['never-shipped'])
        self.assertEqual(report['extractedCount'], 1)
        self.assertIn('never-shipped', stdout)
        self.assertFalse((out / 'never-shipped.js').exists())

    def test_report_records_the_bundle_hash_and_scope(self):
        _, report, _ = run(self.tmp)
        self.assertEqual(len(report['bundleSha256']), 64)
        self.assertIn('NOT original TypeScript', report['scope'])
        self.assertIn('not rewired', report['notRunnable'])


class RealBundleTests(unittest.TestCase):
    """Guards the claim that every carrier import resolves inside the bundle."""

    def test_every_carrier_import_is_present_in_the_0_8_1_bundle(self):
        report_path = REPO / 'docs' / 'evidence' / 'carrier-modules-0-8-1.json'
        if not report_path.exists():
            self.skipTest('0.8.1 extraction has not been run')
        report = json.loads(report_path.read_text())
        self.assertEqual(report['missing'], [])
        self.assertEqual(report['extractedCount'], report['wantedCount'])
        self.assertGreater(report['totalCodeLines'], 1000)


if __name__ == '__main__':
    unittest.main()
