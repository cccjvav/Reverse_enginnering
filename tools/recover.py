#!/usr/bin/env python3
"""Download, verify and statically inspect ShunCode; never execute package code."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REPO = 'cccjvav/Reverse_enginnering_of_shun'
TAG = 'upload'
ASSET = 'shuncode_0.7.3_Lunix_amd64.deb'
SIZE = 216372268
SHA256 = '6dab4779cb393f2fc1795ed0e45bb99cb59682bb92d0def276043ef718fd89b4'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def verify(path):
    if path.stat().st_size != SIZE or digest(path) != SHA256:
        raise ValueError('安装包大小或 SHA-256 不匹配；停止分析。')


def download(work):
    dest = work / 'downloads' / ASSET
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        verify(dest)
        return dest
    # Only promote a completely verified download; no credentials in files.
    with tempfile.TemporaryDirectory(dir=dest.parent) as tmp:
        subprocess.run(['gh', 'release', 'download', TAG, '--repo', REPO,
                        '--pattern', ASSET, '--dir', tmp], check=True)
        candidate = Path(tmp) / ASSET
        verify(candidate)
        candidate.replace(dest)
    return dest


def inspect(tree):
    """Relative paths and hashes only; do not publish arbitrary embedded secrets."""
    result = dict(files=[], packages=[], products=[], source_maps=[],
                  asar_archives=[], native_files=[], symlinks=[])
    for parent, dirs, files in os.walk(tree, followlinks=False):
        dirs.sort()
        for name in sorted(files + [d for d in dirs if (Path(parent) / d).is_symlink()]):
            p = Path(parent) / name
            rel = p.relative_to(tree).as_posix()
            if p.is_symlink():
                result['symlinks'].append({'path': rel, 'target': os.readlink(p)})
                continue
            if not p.is_file():
                continue
            result['files'].append({'path': rel, 'size': p.stat().st_size, 'sha256': digest(p)})
            if p.suffix == '.asar':
                result['asar_archives'].append(rel)
            with p.open('rb') as stream:
                magic = stream.read(4)
            if magic == b'\x7fELF' or p.suffix.lower() in {'.node', '.dll', '.exe', '.so'}:
                result['native_files'].append(rel)
            if p.name in {'package.json', 'product.json'}:
                try:
                    data = json.loads(p.read_text(encoding='utf-8'))
                    if not isinstance(data, dict):
                        continue
                    keys = (('name', 'version', 'main', 'engines') if p.name == 'package.json'
                            else ('nameShort', 'nameLong', 'applicationName', 'version', 'commit', 'date'))
                    record = {'path': rel, **{k: data[k] for k in keys if k in data}}
                    result['packages' if p.name == 'package.json' else 'products'].append(record)
                except (ValueError, UnicodeError):
                    pass
            if p.suffix == '.map':
                record = {'path': rel}
                try:
                    data = json.loads(p.read_text(encoding='utf-8'))
                    if isinstance(data, dict):
                        sources = data.get('sources', [])
                        content = data.get('sourcesContent', [])
                        record.update(source_count=len(sources) if isinstance(sources, list) else 0,
                                      embedded_source_count=sum(isinstance(s, str) for s in content)
                                      if isinstance(content, list) else 0,
                                      indexed='sections' in data)
                except (ValueError, UnicodeError):
                    record['invalid_json'] = True
                result['source_maps'].append(record)
    return result


def analyze(package, work):
    verify(package)
    tree = work / 'extracted'
    if tree.exists():
        raise ValueError(f'{tree} 已存在；请指定新的 --work 目录，避免覆盖之前的提取结果。')
    work.mkdir(parents=True, exist_ok=True)
    # dpkg-deb extraction does not run preinst/postinst; use an unprivileged account.
    with tempfile.TemporaryDirectory(prefix='extract-', dir=work) as tmp:
        staging = Path(tmp) / 'root'
        subprocess.run(['dpkg-deb', '--extract', str(package), str(staging)], check=True)
        staging.rename(tree)
    control = subprocess.run(['dpkg-deb', '--info', str(package)], check=True,
                             capture_output=True, text=True).stdout
    (work / 'control.txt').write_text(control, encoding='utf-8')
    report = inspect(tree)
    report['input'] = {'asset': ASSET, 'sha256': SHA256, 'size': SIZE, 'release': TAG}
    (work / 'inventory.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'提取目录：{tree}\n分析清单：{work / "inventory.json"}')
    for key in ['files', 'packages', 'products', 'source_maps', 'asar_archives', 'native_files']:
        print(f'{key}: {len(report[key])}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, help='使用本地 .deb，跳过网络下载')
    parser.add_argument('--work', type=Path, default=ROOT / '.work')
    args = parser.parse_args()
    try:
        if not shutil.which('dpkg-deb'):
            raise ValueError('需要 Linux/WSL 和 dpkg-deb。')
        package = args.package.resolve() if args.package else download(args.work.resolve())
        analyze(package, args.work.resolve())
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f'恢复流程停止：{exc}\n若下载域名不可达，可用 --package 指定原始 Release 安装包。\n')


if __name__ == '__main__':
    main()
