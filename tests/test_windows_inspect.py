import importlib.util
import io
import json
from pathlib import Path
import struct
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('windows_inspect', Path(__file__).resolve().parents[1] / 'tools/windows_inspect.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def ar(name, body):
    header = f'{name + "/":<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{len(body):<10}`\n'.encode()
    return header + body + (b'\n' if len(body) % 2 else b'')


class WindowsInspectionTests(unittest.TestCase):
    def test_deb_and_asar(self):
        asar_json = json.dumps({'files': {'package.json': {'size': 10}, 'a.map': {'size': 3}}}).encode()
        asar = struct.pack('<4I', 4, len(asar_json) + 8, len(asar_json) + 4, len(asar_json)) + asar_json
        files = {
            'opt/app/resources/app/package.json': b'{"name":"fixture","version":"1","secret":"HIDDEN","dependencies":{"test":"PRIVATE_URL"}}',
            'opt/app/resources/app/a.js.map': b'{"sources":["a.ts"],"sourcesContent":["SECRET_SOURCE"]}',
            'opt/app/resources/app/a.node': b'ELF',
            'opt/app/resources/app.asar': asar,
        }
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w:xz') as tar:
            for name, body in files.items():
                info = tarfile.TarInfo(name)
                info.size = len(body)
                tar.addfile(info, io.BytesIO(body))
            link = tarfile.TarInfo('outside')
            link.type = tarfile.SYMTYPE
            link.linkname = '/etc/passwd'
            tar.addfile(link)
        with tempfile.TemporaryDirectory() as tmp:
            package = Path(tmp) / 'fixture.deb'
            package.write_bytes(b'!<arch>\n' + ar('debian-binary', b'2.0\n') + ar('data.tar.xz', buf.getvalue()))
            result = mod.inspect(package)
            report = result['analysis']
            self.assertEqual(report['file_count'], 4)
            self.assertEqual(report['source_maps'][0]['embedded_source_count'], 1)
            self.assertEqual(report['asar_archives'][0]['counts']['maps'], 1)
            self.assertEqual(len(report['native_files']), 1)
            self.assertFalse(result['matches_known_linux_release'])
            serialized = json.dumps(result)
            for secret in ['HIDDEN', 'PRIVATE_URL', 'SECRET_SOURCE', '/etc/passwd', tmp]:
                self.assertNotIn(secret, serialized)

    def test_windows_is_fingerprint_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'setup.exe'
            p.write_bytes(b'MZtest')
            self.assertEqual(mod.inspect(p)['analysis']['status'], 'fingerprint-only')

    def test_path_validation(self):
        for path in ('../bad', '/etc/passwd', 'C:\\bad', 'a/../../b'):
            self.assertIsNone(mod.safe_relative(path))
        self.assertEqual(mod.safe_relative('./opt/app/package.json'), 'opt/app/package.json')

    def test_truncated_ar(self):
        with self.assertRaises(ValueError):
            list(mod.ar_members(io.BytesIO(b'!<arch>\nshort')))


if __name__ == '__main__':
    unittest.main()
