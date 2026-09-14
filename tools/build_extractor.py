#!/usr/bin/env python3
"""Record reproducible tool build diagnostics even when configure fails."""
import json
from pathlib import Path
from installer_forensics import command_report


def main():
    result = {'repository': 'dscharrer/innoextract', 'commit': '6e9e34ed0876014fdb46e684103ef8c3605e382e'}
    result['cmake_version'] = command_report(['cmake', '--version'])
    result['configure'] = command_report(['cmake', '-S', '.work/innoextract-source', '-B', '.work/innoextract-build', '-DCMAKE_BUILD_TYPE=Release', '-DUSE_LTO=OFF'])
    code = result['configure']['exit_code']
    if code == 0:
        result['build'] = command_report(['cmake', '--build', '.work/innoextract-build', '--parallel', '2'], timeout=600)
        code = result['build']['exit_code']
    result['success'] = code == 0
    output = Path('docs/evidence/extractor-build.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(result, ensure_ascii=False, indent=2).replace(str(Path.cwd()), '<workspace>')
    output.write_text(text + '\n', encoding='utf-8')
    return 0 if result['success'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
