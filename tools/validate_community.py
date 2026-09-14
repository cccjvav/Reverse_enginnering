#!/usr/bin/env python3
"""Validate overlay against extracted real Windows files; parse JS, never run app."""
import argparse
import json
from pathlib import Path
import subprocess
from apply_community import prepare, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tree', type=Path, required=True)
    parser.add_argument('--payload', type=Path, default=Path('.work/community-overlay'))
    args = parser.parse_args()
    report = {'scope': 'Validation against statically extracted Windows 0.7.4 files. JS parsed only; no Windows GUI, extension activation or live MCP tests.', 'success': False, 'files': []}
    try:
        plan = prepare(args.tree / 'code$GetDestDir', args.payload)
        for relative, old, new in plan:
            item = {'path': relative, 'originalSha256': sha(old), 'sha256': sha(new), 'size': len(new)}
            if relative.endswith('.js'):
                mode = 'script' if '/extensions/' in relative else 'module'
                command = ['node', '--check'] if mode == 'script' else ['node', '--input-type=module', '--check']
                proc = subprocess.run(command, input=new, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
                item['syntax_exit_code'] = proc.returncode
                if proc.returncode:
                    item['syntax_error'] = proc.stderr.decode('utf-8', errors='replace')[:3000]
            report['files'].append(item)
        report['success'] = all(f.get('syntax_exit_code', 0) == 0 for f in report['files']) and len(report['files']) == 8
    except Exception as exc:
        report['error'] = str(exc)
    out = Path('docs/evidence/community-validation.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Community patch validation success: {report["success"]}')
    return 0 if report['success'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
