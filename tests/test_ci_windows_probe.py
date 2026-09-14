import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ci_windows_probe', Path(__file__).resolve().parents[1] / 'tools/ci_windows_probe.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class StaticProbeTests(unittest.TestCase):
    def test_reject_pointer(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'setup.exe'
            p.write_text('version https://git-lfs.github.com/spec/v1\n')
            with self.assertRaises(ValueError):
                mod.probe(p)

    def test_verified_file_without_unpacker(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'setup.exe'
            data = b'MZfixture'
            p.write_bytes(data)
            with patch.object(mod, 'EXPECTED_SIZE', len(data)), patch.object(mod, 'EXPECTED_SHA256', hashlib.sha256(data).hexdigest()), patch.object(mod.shutil, 'which', return_value=None), patch.dict(mod.os.environ, {'ProgramFiles': str(Path(tmp) / 'missing')}):
                report = mod.probe(p)
            self.assertTrue(report['has_mz_header'])
            self.assertEqual(report['status'], '7-Zip unavailable; fingerprint only')


if __name__ == '__main__':
    unittest.main()
