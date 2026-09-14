import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('recover', Path(__file__).resolve().parents[1] / 'tools/recover.py')
recover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recover)


class RecoveryTests(unittest.TestCase):
    def test_inventory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'package.json').write_text('{"name":"fixture","version":"1.2.3","secret":"DO_NOT_EXPORT"}')
            (root / 'product.json').write_text('{"applicationName":"fixture"}')
            (root / 'app.js.map').write_text(json.dumps({'sources': ['a.ts', 'b.ts'], 'sourcesContent': ['hello', None]}))
            (root / 'bad.map').write_text('not json')
            (root / 'binary').write_bytes(b'\x7fELFhello')
            (root / 'app.asar').write_bytes(b'fixture')
            (root / 'external').symlink_to('/etc/passwd')
            report = recover.inspect(root)
            self.assertEqual(len(report['files']), 6)
            self.assertEqual(report['native_files'], ['binary'])
            self.assertEqual(report['asar_archives'], ['app.asar'])
            self.assertEqual(report['source_maps'][0]['embedded_source_count'], 1)
            self.assertTrue(report['source_maps'][1]['invalid_json'])
            self.assertEqual(len(report['symlinks']), 1)
            self.assertNotIn('DO_NOT_EXPORT', json.dumps(report))

    def test_reject_wrong_package(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bad.deb'
            path.write_bytes(b'not a deb')
            with self.assertRaises(ValueError):
                recover.verify(path)

    def test_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'empty'
            path.touch()
            self.assertEqual(recover.digest(path), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')


if __name__ == '__main__':
    unittest.main()
