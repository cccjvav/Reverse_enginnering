import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import recover_custom_extension as mod


class CustomRecoveryTests(unittest.TestCase):
    def test_exact_recovery_and_secret_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            extension = root / 'input/resources/app/extensions/shuncode'
            extension.mkdir(parents=True)
            (extension / 'package.json').write_text('{"name":"shuncode"}')
            (extension / 'extension.js').write_bytes(b'// fixture\r\n')
            (extension / 'secret.js').write_text('const k = "ghp_' + 'a' * 36 + '";')
            (extension / 'image.png').write_bytes(b'image')
            output = root / 'output'
            report = mod.recover(root / 'input', output)
            self.assertEqual(report['copied_count'], 2)
            self.assertEqual((output / 'extension.js').read_bytes(), b'// fixture\r\n')
            self.assertFalse((output / 'secret.js').exists())
            self.assertEqual(len(report['skipped']), 2)
            self.assertNotIn('ghp_', json.dumps(report))
            self.assertEqual(mod.recover(root / 'input', output)['copied_count'], 2)
            (output / 'extension.js').write_text('edited')
            with self.assertRaises(ValueError):
                mod.recover(root / 'input', output)

    def test_secret_patterns_do_not_treat_variable_names_as_keys(self):
        self.assertEqual(mod.secret_findings('const apiKey = config.get("apiKey");'), [])


if __name__ == '__main__':
    unittest.main()
