#!/usr/bin/env python3
"""Static installer identification and optional Inno extraction, never execution."""
import argparse
from collections import Counter
import hashlib
import json
import mmap
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile

from ci_windows_probe import EXPECTED_SHA256, EXPECTED_SIZE


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def identify(path):
    if path.stat().st_size != EXPECTED_SIZE or sha256(path) != EXPECTED_SHA256:
        raise ValueError('Installer hash/size mismatch; refusing analysis')
    result = {'file': path.name, 'size': EXPECTED_SIZE, 'sha256': EXPECTED_SHA256,
              'markers': [], 'scope': 'Static parsing only. Installer code is never executed.'}
    with path.open('rb') as stream, mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
        if data[:2] == b'MZ':
            off = struct.unpack_from('<I', data, 0x3c)[0]
            if off + 24 <= len(data) and data[off:off+4] == b'PE\0\0':
                machine, nsec, timestamp = struct.unpack_from('<HHI', data, off+4)
                optional_size = struct.unpack_from('<H', data, off+20)[0]
                sections = []
                for i in range(min(nsec, 96)):
                    sec = off + 24 + optional_size + 40 * i
                    if sec + 40 > len(data):
                        break
                    name = data[sec:sec+8].rstrip(b'\0').decode('ascii', errors='replace')
                    raw_size, raw_offset = struct.unpack_from('<II', data, sec+16)
                    sections.append({'name': name, 'raw_size': raw_size, 'raw_offset': raw_offset})
                end = max((s['raw_size'] + s['raw_offset'] for s in sections), default=0)
                result['pe'] = {'machine_hex': hex(machine), 'timestamp_raw': timestamp,
                                'sections': sections, 'section_data_end': end,
                                'bytes_after_sections': max(0, len(data) - end),
                                'note': 'Installer stub architecture is not necessarily the application architecture; trailing bytes may include certificates.'}
        # Allowlisted signatures only: do not dump arbitrary strings/URLs/secrets.
        signatures = [('inno', b'Inno Setup Setup Data ('), ('inno-loader', b'Inno Setup Setup Loader'),
                      ('nsis', b'NullsoftInst'), ('7z', b'7z\xbc\xaf\x27\x1c'),
                      ('zip', b'PK\x03\x04')]
        for kind, marker in signatures:
            offset = 0
            matches = []
            while len(matches) < 16:
                offset = data.find(marker, offset)
                if offset < 0:
                    break
                item = {'offset': offset}
                if kind.startswith('inno'):
                    version = re.match(rb'[\x20-\x7e]{1,100}', data[offset:offset+100])
                    item['signature'] = version.group().decode('ascii') if version else kind
                matches.append(item)
                offset += len(marker)
            if matches:
                result['markers'].append({'kind': kind, 'matches': matches})
    return result


def command_report(args, cwd=None, timeout=300):
    with tempfile.TemporaryFile() as log:
        try:
            proc = subprocess.run(args, cwd=cwd, stdout=log, stderr=subprocess.STDOUT,
                                  check=False, timeout=timeout)
            code = proc.returncode
        except subprocess.TimeoutExpired:
            code = 'timeout'
        total = log.tell()
        log.seek(0)
        text = log.read(16000).decode('utf-8', errors='replace')
        if total > 16000:
            log.seek(max(16000, total - 8000))
            text += '\n[... middle omitted ...]\n' + log.read().decode('utf-8', errors='replace')
    for arg in args:
        if Path(arg).is_absolute():
            text = text.replace(arg, Path(arg).name)
    if cwd:
        text = text.replace(str(cwd), '<work>')
    return {'command': [Path(a).name if Path(a).is_absolute() else a for a in args],
            'exit_code': code, 'log_bytes': total, 'log_head': text,
            'log_truncated': total > 16000}


def inventory(tree):
    report = {'file_count': 0, 'total_bytes': 0, 'suffix_counts': {}, 'manifests': [],
              'maps': [], 'asars': [], 'native_modules': [], 'root_files': []}
    suffixes = Counter()
    for path in sorted(tree.rglob('*')):
        if path.is_symlink() or not path.is_file():
            continue
        rel = path.relative_to(tree).as_posix()
        size = path.stat().st_size
        report['file_count'] += 1
        report['total_bytes'] += size
        suffixes[path.suffix.lower()] += 1
        if len(Path(rel).parts) <= 3 and len(report['root_files']) < 300:
            report['root_files'].append({'path': rel, 'size': size})
        if path.suffix in ('.asar', '.node'):
            report['asars' if path.suffix == '.asar' else 'native_modules'].append({'path': rel, 'size': size, 'sha256': sha256(path)})
        if path.name in ('package.json', 'product.json') and size <= 2 * 1024 * 1024:
            try:
                data = json.loads(path.read_text(encoding='utf-8'))
                if not isinstance(data, dict):
                    continue
            except (ValueError, UnicodeError):
                continue
            keys = ('name', 'version', 'main', 'commit', 'date', 'applicationName', 'nameShort', 'nameLong')
            record = {'path': rel, 'sha256': sha256(path), **{k: data[k] for k in keys if isinstance(data.get(k), str)}}
            for key in ('dependencies', 'devDependencies'):
                deps = data.get(key)
                if isinstance(deps, dict):
                    record[key] = {k: (v if isinstance(v, str) and re.fullmatch(r'[~^<>=|*\d.vxX +\-]+', v) else '<non-semver omitted>') for k, v in deps.items()}
            report['manifests'].append(record)
        if path.suffix == '.map':
            record = {'path': rel, 'size': size}
            if size <= 32 * 1024 * 1024:
                try:
                    data = json.loads(path.read_text(encoding='utf-8'))
                    if isinstance(data, dict):
                        content = data.get('sourcesContent', [])
                        record['embedded_source_count'] = sum(isinstance(s, str) for s in content) if isinstance(content, list) else 0
                        record['indexed'] = 'sections' in data
                except (ValueError, UnicodeError):
                    record['invalid_json'] = True
            report['maps'].append(record)
    report['suffix_counts'] = dict(suffixes.most_common())
    for key in ('maps', 'asars', 'native_modules', 'manifests'):
        report[key + '_total'] = len(report[key])
        report[key] = report[key][:2000]
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--extract-dir', type=Path, required=True)
    args = parser.parse_args()
    report = identify(args.package)
    inno = shutil.which('innoextract')
    seven = shutil.which('7z')
    if seven:
        report['seven_zip'] = command_report([seven, 'l', '-slt', str(args.package.resolve())])
    if inno:
        report['innoextract_version'] = command_report([inno, '--version'])
        report['innoextract_list'] = command_report([inno, '--list', str(args.package.resolve())])
        if report['innoextract_list']['exit_code'] == 0:
            if args.extract_dir.exists():
                raise ValueError('Extraction directory must not exist')
            args.extract_dir.mkdir(parents=True)
            report['extraction'] = command_report([inno, '--extract', '--output-dir', str(args.extract_dir.resolve()), str(args.package.resolve())], timeout=600)
            if report['extraction']['exit_code'] == 0:
                report['inventory'] = inventory(args.extract_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Static report saved; see the report for actual extraction success/failure.')


if __name__ == '__main__':
    main()
