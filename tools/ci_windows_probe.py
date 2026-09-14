#!/usr/bin/env python3
"""Static first-pass probe on a GitHub Windows runner; never run the installer."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

EXPECTED_SIZE = 240559253
EXPECTED_SHA256 = 'fdc2328b2520a128fd3449ed2015a7383e2b7dafaae05c3892d5a4c11a671272'


def probe(package):
    h = hashlib.sha256()
    with package.open('rb') as stream:
        prefix = stream.read(8)
        stream.seek(0)
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    if package.stat().st_size != EXPECTED_SIZE or h.hexdigest() != EXPECTED_SHA256:
        raise ValueError('Package does not match the uploaded Git LFS object. Stop.')
    report = {'file': package.name, 'size': package.stat().st_size, 'sha256': h.hexdigest(),
              'has_mz_header': prefix.startswith(b'MZ'),
              'scope': 'Static file fingerprint and archive listing only; no installer execution or source recovery.'}
    seven_zip = shutil.which('7z')
    if not seven_zip:
        candidate = Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / '7-Zip' / '7z.exe'
        if candidate.is_file():
            seven_zip = str(candidate)
    if not seven_zip:
        report['status'] = '7-Zip unavailable; fingerprint only'
        return report
    # A listing parses the installer as an archive; it does not invoke its entry point.
    # Spool output rather than retaining unbounded archive listings in memory.
    with tempfile.TemporaryFile() as output:
        try:
            result = subprocess.run([seven_zip, 'l', '-slt', '-sccUTF-8', str(package.resolve())],
                                    stdout=output, stderr=subprocess.STDOUT, timeout=180, check=False)
            report['archive_list_exit_code'] = result.returncode
        except subprocess.TimeoutExpired:
            report['status'] = 'Archive listing timed out'
            return report
        length = output.tell()
        output.seek(0)
        text = output.read(256 * 1024).decode('utf-8', errors='replace')
    # Keep only metadata fields, never file contents or raw diagnostics with runner paths.
    allowed = {'Path', 'Size', 'Packed Size', 'Type', 'Method', 'Physical Size', 'Offset', 'Headers Size', 'Solid', 'Blocks'}
    records = []
    record = {}
    for line in text.splitlines() + ['']:
        if not line.strip():
            if record:
                records.append(record)
                record = {}
            continue
        key, sep, value = line.partition(' = ')
        if sep and key in allowed:
            if key == 'Path' and (value == str(package.resolve()) or value == str(package)):
                value = package.name
            record[key] = value
    report.update(status='Archive listing completed' if report['archive_list_exit_code'] == 0 else '7-Zip could not fully list this installer; another unpacker may be needed',
                  listing_bytes=length, listing_truncated=length > 256 * 1024 or len(records) > 250,
                  archive_records=records[:250])
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = probe(args.package)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Report written: {args.output}')


if __name__ == '__main__':
    main()
