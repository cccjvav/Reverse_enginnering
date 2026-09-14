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


if __name__ == '__main__':
    unittest.main()
