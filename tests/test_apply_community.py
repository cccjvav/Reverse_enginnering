import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('apply_community',Path(__file__).resolve().parents[1]/'tools/apply_community.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)


class ApplyTests(unittest.TestCase):
    def fixture(self,root):
        app=root/'app'; payload=root/'payload'
        a='resources/app/extensions/shuncode/package.json'; b='resources/app/out/workbench.js'
        for base in [app,payload]:
            (base/a).parent.mkdir(parents=True)
        (app/a).write_bytes(b'old manifest');(payload/a).write_bytes(b'community manifest')
        (app/b).parent.mkdir(parents=True);(app/b).write_bytes(b'prefix OLD-UI suffix')
        (payload/'ui').mkdir();(payload/'ui/old').write_bytes(b'OLD-UI');(payload/'ui/new').write_bytes(b'FREE-UI')
        manifest={'files':[{'path':a,'originalSha256':mod.sha(b'old manifest'),'sha256':mod.sha(b'community manifest')}],
                  'uiPatches':[{'path':b,'originalSha256':mod.sha(b'prefix OLD-UI suffix'),'find':'ui/old','findSha256':mod.sha(b'OLD-UI'),'replace':'ui/new','replaceSha256':mod.sha(b'FREE-UI')}]}
        (payload/'overlay-manifest.json').write_text(json.dumps(manifest))
        return app,payload,a,b

    def test_dry_run_apply_restore(self):
        with tempfile.TemporaryDirectory() as temp:
            app,payload,a,b=self.fixture(Path(temp))
            self.assertEqual(len(mod.prepare(app,payload)),2)
            self.assertEqual((app/a).read_bytes(),b'old manifest')
            backup=mod.install(app,payload)
            self.assertEqual((app/b).read_bytes(),b'prefix FREE-UI suffix')
            self.assertEqual((backup/a).read_bytes(),b'old manifest')
            mod.restore(app,backup)
            self.assertEqual((app/a).read_bytes(),b'old manifest')
            self.assertEqual((app/b).read_bytes(),b'prefix OLD-UI suffix')

    def test_version_mismatch_writes_nothing(self):
        with tempfile.TemporaryDirectory() as temp:
            app,payload,a,b=self.fixture(Path(temp));(app/b).write_bytes(b'different version')
            with self.assertRaises(ValueError):mod.install(app,payload)
            self.assertEqual((app/a).read_bytes(),b'old manifest')
            self.assertFalse((app/'.shuncode-community-backups').exists())
            self.assertFalse((app/'.shuncode-community.lock').exists())

    def test_failure_rolls_back_already_written_files(self):
        with tempfile.TemporaryDirectory() as temp:
            app,payload,a,b=self.fixture(Path(temp));original=mod.atomic_write;count=0
            def fail_second(path,data):
                nonlocal count
                count+=1
                if count==2:raise OSError('simulated locked file')
                return original(path,data)
            with patch.object(mod,'atomic_write',side_effect=fail_second):
                with self.assertRaisesRegex(RuntimeError,'rolled-back'):mod.install(app,payload)
            self.assertEqual((app/a).read_bytes(),b'old manifest')
            self.assertEqual((app/b).read_bytes(),b'prefix OLD-UI suffix')

    def test_payload_corruption_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            app,payload,a,b=self.fixture(Path(temp));(payload/a).write_bytes(b'corrupted')
            with self.assertRaises(ValueError):mod.prepare(app,payload)

    def test_restore_refuses_newer_app(self):
        with tempfile.TemporaryDirectory() as temp:
            app,payload,a,b=self.fixture(Path(temp));backup=mod.install(app,payload)
            (app/b).write_bytes(b'new app update')
            with self.assertRaises(ValueError):mod.restore(app,backup)
            self.assertEqual((app/a).read_bytes(),b'community manifest')

    def test_paths_and_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for name in ['../x','C:/x','/etc/passwd','resources/app/../../x','resources\\app\\x','file.exe']:
                with self.assertRaises(ValueError):mod.safe_path(root,name,app_file=True)
            (root/'resources').symlink_to(root/'outside')
            with self.assertRaises(ValueError):mod.safe_path(root,'resources/app/x',app_file=True)

    def test_updater_lock_prevents_second_install(self):
        with tempfile.TemporaryDirectory() as temp:
            app,payload,_,_=self.fixture(Path(temp));(app/'.shuncode-community.lock').touch()
            with self.assertRaises(FileExistsError):mod.install(app,payload)
            self.assertTrue((app/'.shuncode-community.lock').exists())


if __name__=='__main__':unittest.main()
