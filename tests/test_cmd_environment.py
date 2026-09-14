import importlib.util
import json
import hashlib
import zipfile
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('check_cmd_environment', ROOT / 'tools/check_cmd_environment.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CmdEnvironmentTests(unittest.TestCase):
    def inspect(self, prefix, **overrides):
        if overrides.pop("with_meta", True):
            (prefix / "conda-meta").mkdir(parents=True, exist_ok=True)
        values = dict(environ={'CONDA_PREFIX': str(prefix)}, executable=str(prefix / 'python.exe'),
                      python_version=(3, 12, 0), find=lambda name: str(prefix / name),
                      probe_node=lambda _: 'v22.22.3', probe_tk=lambda: '8.6')
        values.update(overrides)
        return module.inspect_environment(**values)

    def test_active_environment_is_required(self):
        with tempfile.TemporaryDirectory() as directory:
            r = self.inspect(Path(directory), environ={})
            self.assertFalse(r['ok'])
            self.assertFalse(r['checks']['conda_active'])

    def test_consistent_environment_passes(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertTrue(self.inspect(Path(directory))['ok'])

    def test_global_node_is_not_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            def unexpected(_):
                self.fail('A global Node must not be executed by this check')
            r = self.inspect(base / 'env', find=lambda _: str(base / 'global' / 'node'), probe_node=unexpected)
            self.assertFalse(r['ok'])
            self.assertFalse(r['checks']['node_in_active_conda'])

    def test_sibling_prefix_is_not_the_same_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertFalse(module.inside_prefix(str(root / 'env-other/python'), str(root / 'env')))

    def test_node_versions_are_checked(self):
        for value in ['v22.13.0', '22.22.3', 'v24.0.0']:
            self.assertTrue(module.supported_node(value), value)
        for value in ['v20.19.0', 'v22.12.0', 'v23.0.0', 'not-node']:
            self.assertFalse(module.supported_node(value), value)

    def test_missing_tk_is_reported_without_opening_a_window(self):
        def missing():
            raise ImportError('fixture')
        with tempfile.TemporaryDirectory() as directory:
            r = self.inspect(Path(directory), probe_tk=missing)
            self.assertFalse(r['ok'])
            self.assertFalse(r['checks']['tk_importable'])

    @unittest.skipUnless(os.name == 'nt', 'Real CMD launcher test requires Windows')
    def test_launcher_uses_conda_python_forwards_arguments_and_preserves_failure(self):
        with tempfile.TemporaryDirectory(prefix='shuncode launcher ') as directory:
            folder = Path(directory)
            launcher = folder / 'apply-community.cmd'
            shutil.copyfile(ROOT / 'tools/apply-community.cmd', launcher)
            # Fixture script instead of the real updater: no GUI or installation write.
            (folder / 'apply_community.py').write_text(
                'import json,sys\nprint(json.dumps({"python":sys.executable,"args":sys.argv[1:]}))\nsys.exit(7)\n', encoding='utf-8')
            env = dict(os.environ, CONDA_PREFIX=sys.prefix)
            command = f'"{os.environ.get("COMSPEC", "cmd.exe")}" /d /s /c ""{launcher}" --probe "path with spaces & sign""'
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 7, result.stdout + result.stderr)
            payload = json.loads(result.stdout.strip())
            self.assertEqual(os.path.normcase(payload['python']), os.path.normcase(sys.executable))
            self.assertEqual(payload['args'], ['--probe', 'path with spaces & sign'])

    def test_prefix_variable_alone_is_not_a_conda_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            r = self.inspect(Path(directory), with_meta=False)
            self.assertFalse(r['ok'])
            self.assertFalse(r['checks']['conda_metadata_present'])

    def test_distributed_zip_matches_launcher_and_payload_hashes(self):
        with zipfile.ZipFile(ROOT / 'community/shuncode-community-0.7.4-overlay.zip') as archive:
            self.assertIsNone(archive.testzip())
            for name, source in [('apply-community.cmd', 'tools/apply-community.cmd'),
                                 ('apply_community.py', 'tools/apply_community.py'),
                                 ('README.md', 'community/README.md')]:
                self.assertEqual(archive.read(name), (ROOT / source).read_bytes())
            manifest = json.loads(archive.read('payload/overlay-manifest.json'))
            for entry in manifest['files']:
                self.assertEqual(hashlib.sha256(archive.read('payload/' + entry['path'])).hexdigest(), entry['sha256'])
            for entry in manifest['uiPatches']:
                for key in ['find', 'replace']:
                    self.assertEqual(hashlib.sha256(archive.read('payload/' + entry[key])).hexdigest(), entry[key + 'Sha256'])

    @unittest.skipUnless(os.name == 'nt', 'Real CMD launcher test requires Windows')
    def test_broken_active_conda_does_not_fall_back_to_global_python(self):
        with tempfile.TemporaryDirectory(prefix='shuncode broken conda ') as directory:
            env = dict(os.environ, CONDA_PREFIX=str(Path(directory) / 'missing env'))
            command = f'"{os.environ.get("COMSPEC", "cmd.exe")}" /d /s /c ""{ROOT / "tools/apply-community.cmd"}" --help"'
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertIn('Active conda Python was not found', result.stdout)

    @unittest.skipUnless(os.name == 'nt', 'Real CMD runner test requires Windows')
    def test_learning_runner_requires_activation(self):
        env = dict(os.environ)
        env.pop('CONDA_PREFIX', None)
        command = f'"{os.environ.get("COMSPEC", "cmd.exe")}" /d /s /c ""{ROOT / "tools/run-learning.cmd"}""'
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('Activate your conda environment', result.stdout)
        self.assertNotIn('ALL_LEARNING_CHECKS_PASSED', result.stdout)


if __name__ == '__main__':
    unittest.main()
