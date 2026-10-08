import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import installer_forensics as mod


class ForensicsTests(unittest.TestCase):
    def test_identify_fixture(self):
        body = bytearray(1024)
        body[:2] = b'MZ'
        struct.pack_into('<I', body, 0x3c, 0x80)
        body[0x80:0x84] = b'PE\0\0'
        struct.pack_into('<HHI', body, 0x84, 0x14c, 1, 0)
        struct.pack_into('<H', body, 0x94, 0)
        body[0x98:0xa0] = b'.text\0\0\0'
        struct.pack_into('<II', body, 0xa8, 128, 256)
        marker = b'Inno Setup Setup Data (6.4.0)'
        body[512:512+len(marker)] = marker
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'fixture.exe'
            p.write_bytes(body)
            with patch.object(mod, 'EXPECTED_SIZE', len(body)), patch.object(mod, 'EXPECTED_SHA256', mod.sha256(p)):
                result = mod.identify(p)
            self.assertEqual(result['pe']['section_data_end'], 384)
            self.assertEqual(result['pe']['machine_hex'], '0x14c')
            self.assertEqual(result['markers'][0]['matches'][0]['offset'], 512)

    def test_manifest_redaction(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'package.json').write_text(json.dumps({'name': 'fixture', 'secret': 'PRIVATE', 'dependencies': {'safe': '^1.2.3', 'custom': 'https://PRIVATE'}}))
            (root / 'test.map').write_text('{"sourcesContent":["PRIVATE",null]}')
            result = mod.inventory(root)
            self.assertEqual(result['file_count'], 2)
            self.assertEqual(result['maps'][0]['embedded_source_count'], 1)
            self.assertEqual(result['manifests'][0]['dependencies']['safe'], '^1.2.3')
            self.assertNotIn('PRIVATE', json.dumps(result))

    def test_command_exit_and_output(self):
        result = mod.command_report([sys.executable, '-c', 'print("fixture");exit(2)'])
        self.assertEqual(result['exit_code'], 2)
        self.assertIn('fixture', result['log_head'])


class InstallerRegistryTests(unittest.TestCase):
    """The hash gate must admit every supplied installer and nothing else."""

    def test_registry_matches_the_committed_lfs_pointers(self):
        # An LFS sha256 oid is the content hash, so the pointer files are an
        # independent record of what each installer must hash to. If someone
        # replaces a sample, this catches the registry drifting out of date.
        repo = Path(__file__).resolve().parents[1]
        checked = 0
        for name, (size, digest) in mod.KNOWN_INSTALLERS.items():
            pointer = repo / name
            if not pointer.exists():
                continue
            text = pointer.read_text(encoding='utf8', errors='replace')
            if not text.startswith('version https://git-lfs'):
                continue  # resolved to the real binary; nothing to cross-check
            self.assertIn(f'oid sha256:{digest}', text, name)
            self.assertIn(f'size {size}', text, name)
            checked += 1
        self.assertGreater(checked, 0, 'no LFS pointers were available to verify')

    def test_unregistered_file_is_refused_with_the_observed_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'ShunCode-0.0.0-unknown.exe'
            p.write_bytes(b'not an installer')
            with self.assertRaises(ValueError) as caught:
                mod.identify(p)
            message = str(caught.exception)
            self.assertIn('ShunCode-0.0.0-unknown.exe', message)
            # The old message said only "mismatch", which could not distinguish
            # an unregistered installer from a corrupted download.
            self.assertIn('got 16 bytes', message)

    def test_known_installer_is_looked_up_by_name(self):
        name = 'ShunCode-0.8.1-Windows-x64.exe'
        self.assertEqual(mod.expected_for(Path('/any/dir') / name),
                         mod.KNOWN_INSTALLERS[name])

    def test_unknown_name_falls_back_to_the_module_defaults(self):
        self.assertEqual(mod.expected_for(Path('fixture.exe')),
                         (mod.EXPECTED_SIZE, mod.EXPECTED_SHA256))


class SevenZipFallbackTests(unittest.TestCase):
    """0.7.4 is Inno; a repackaged release must not report 'not extractable'."""

    def _run(self, seven_zip_behaviour):
        tmp = Path(tempfile.mkdtemp())
        package = tmp / 'pkg.exe'
        package.write_bytes(b'MZ' + bytes(600))
        extract_dir = tmp / 'extracted'
        output = tmp / 'report.json'

        def fake_which(name):
            return '/usr/bin/7z' if name == '7z' else None  # no innoextract

        def fake_command_report(argv, cwd=None, timeout=300):
            if argv[1] == 'x':
                target = next(a[2:] for a in argv if a.startswith('-o'))
                # An earlier version of this fake read the wrong argv slot,
                # got an empty string, and wrote its fixtures into the repo
                # root. Fail loudly instead of littering the working tree.
                assert target and Path(target).is_absolute(), \
                    f'refusing to extract to {target!r}'
                return seven_zip_behaviour(Path(target))
            return {'exit_code': 0, 'log_head': ''}

        argv = ['installer_forensics.py', '--package', str(package),
                '--output', str(output), '--extract-dir', str(extract_dir),
                '--require-extraction']
        with patch.object(mod, 'EXPECTED_SIZE', package.stat().st_size), \
             patch.object(mod, 'EXPECTED_SHA256', mod.sha256(package)), \
             patch.object(mod.shutil, 'which', fake_which), \
             patch.object(mod, 'command_report', fake_command_report), \
             patch.object(sys, 'argv', argv):
            code = mod.main()
        return code, json.loads(output.read_text())

    def test_falls_back_to_7z_when_innoextract_is_unavailable(self):
        def extracted(target):
            (target / 'resources' / 'app').mkdir(parents=True, exist_ok=True)
            (target / 'resources' / 'app' / 'package.json').write_text('{"name":"x"}')
            return {'exit_code': 0, 'log_head': 'ok'}

        code, report = self._run(extracted)
        self.assertEqual(code, 0)
        self.assertEqual(report['extraction_method'], '7z')
        self.assertTrue(report['extracted'])
        self.assertEqual(report['inventory']['file_count'], 1)

    def test_warning_exit_code_still_counts_when_files_appeared(self):
        # 7z returns 1 for non-fatal warnings while still writing usable files.
        def warned(target):
            target.mkdir(parents=True, exist_ok=True)
            (target / 'thing.txt').write_text('data')
            return {'exit_code': 1, 'log_head': 'WARNING'}

        code, report = self._run(warned)
        self.assertEqual(code, 0)
        self.assertEqual(report['extraction_method'], '7z')

    def test_require_extraction_fails_when_nothing_came_out(self):
        def produced_nothing(target):
            target.mkdir(parents=True, exist_ok=True)
            return {'exit_code': 2, 'log_head': 'cannot open'}

        code, report = self._run(produced_nothing)
        self.assertEqual(code, 1)
        self.assertFalse(report['extracted'])
        self.assertNotIn('inventory', report)



if __name__ == '__main__':
    unittest.main()
