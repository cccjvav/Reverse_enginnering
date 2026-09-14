#!/usr/bin/env python3
"""Package a validated overlay only; do not ship entire VS Code bundles."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def package():
    payload = ROOT / '.work/community-overlay'
    evidence = json.loads((ROOT / 'docs/evidence/community-validation.json').read_text())
    manifest_data = (payload / 'overlay-manifest.json').read_bytes()
    if not evidence.get('success'):
        raise ValueError('No successful real-package validation; refusing to publish overlay')
    if hashlib.sha256(manifest_data).hexdigest() != evidence.get('overlayManifestSha256'):
        raise ValueError('Payload manifest differs from the one validated against the real Windows package')
    manifest = json.loads(manifest_data)
    paths = {'overlay-manifest.json'}
    for entry in manifest['files']:
        paths.add(entry['path'])
        if hashlib.sha256((payload / entry['path']).read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError('Payload file hash mismatch')
    for entry in manifest['uiPatches']:
        for key in ('find','replace'):
            paths.add(entry[key])
            if hashlib.sha256((payload / entry[key]).read_bytes()).hexdigest() != entry[key+'Sha256']:
                raise ValueError('UI payload hash mismatch')
    archive = ROOT / 'community/shuncode-community-0.7.4-overlay.zip'
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as output:
        def add(name,data):
            info = zipfile.ZipInfo(name, date_time=(1980,1,1,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info,data)
        for relative in sorted(paths):
            add('payload/'+relative,(payload/relative).read_bytes())
        add('apply_community.py',(ROOT/'tools/apply_community.py').read_bytes())
        add('README.md',(ROOT/'community/README.md').read_bytes())
        add('VALIDATION.json',(ROOT/'docs/evidence/community-validation.json').read_bytes())
        command = '''@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
    py -3 apply_community.py
    goto finished
)
python --version >nul 2>nul
if not errorlevel 1 (
    python apply_community.py
    goto finished
)
echo Python 3.10 or later is required. Install it from python.org with Tcl/Tk.
:finished
pause
'''
        add('apply-community.cmd',command.replace('\n','\r\n').encode('ascii'))
    with zipfile.ZipFile(archive) as check:
        if check.testzip() is not None:
            raise ValueError('ZIP integrity check failed')
    summary = {'file':archive.name,'size':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
               'scope':'Experimental, base-version-locked Windows overlay. Not a complete installer or Windows end-to-end certified build.',
               'real_package_validation_success':True,'windows_gui_tested':False}
    (ROOT/'docs/evidence/community-package.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))


if __name__=='__main__':package()
