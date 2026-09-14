#!/usr/bin/env python3
"""Local, read-only release inspection. Python 3.10+; no package code executed."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import tarfile

EXPECTED_NAME = 'shuncode_0.7.3_Lunix_amd64.deb'
EXPECTED_SIZE = 216372268
EXPECTED_SHA = '6dab4779cb393f2fc1795ed0e45bb99cb59682bb92d0def276043ef718fd89b4'
MAX_JSON = 16 * 1024 * 1024
MAX_LIST = 3000


class Region:
    """Seekable view of one ar member, without copying a large payload."""
    def __init__(self, stream, start, size):
        self.stream, self.start, self.size, self.pos = stream, start, size, 0

    def read(self, n=-1):
        n = self.size - self.pos if n < 0 else min(n, self.size - self.pos)
        self.stream.seek(self.start + self.pos)
        data = self.stream.read(n)
        self.pos += len(data)
        return data

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        if pos < 0:
            raise ValueError('Invalid archive offset')
        self.pos = min(pos, self.size)
        return self.pos


def ar_members(stream):
    stream.seek(0, 2)
    total = stream.tell()
    stream.seek(0)
    if stream.read(8) != b'!<arch>\n':
        raise ValueError('Not a Debian/ar archive')
    while stream.tell() < total:
        header = stream.read(60)
        if len(header) != 60 or header[58:] != b'`\n':
            raise ValueError('Invalid ar header')
        name = header[:16].decode('ascii').strip().rstrip('/')
        size = int(header[48:58])
        start = stream.tell()
        if size < 0 or start + size > total:
            raise ValueError('Truncated ar member')
        yield name, start, size
        stream.seek(start + size + (size % 2))


def safe_relative(name):
    name = name.replace('\\', '/')
    while name.startswith('./'):
        name = name[2:]
    if name.startswith('/') or any(p == '..' or ':' in p for p in name.split('/')):
        return None
    return name


def inspect_deb(path):
    report = {'format': 'deb', 'file_count': 0, 'unpacked_bytes': 0,
              'app_roots': [], 'manifests': [], 'source_maps': [],
              'native_files': [], 'asar_archives': [], 'warnings': []}
    roots = set()
    def append(key, entry):
        if len(report[key]) < MAX_LIST:
            report[key].append(entry)
        elif f'{key}: list truncated at {MAX_LIST}' not in report['warnings']:
            report['warnings'].append(f'{key}: list truncated at {MAX_LIST}')
    with path.open('rb') as raw:
        members = list(ar_members(raw))
        data_members = [m for m in members if m[0].startswith('data.tar')]
        if len(data_members) != 1:
            raise ValueError('Expected exactly one data.tar member')
        name, start, size = data_members[0]
        region = Region(raw, start, size)
        if name.endswith(('.zst', '.zstd')):
            # Python 3.14 has zstd; older Python may use the optional zstandard package.
            try:
                from compression import zstd
                stream = zstd.ZstdFile(region, 'rb')
            except ImportError:
                try:
                    import zstandard
                except ImportError as exc:
                    raise ValueError('This package uses zstd. Use Python 3.14+, or install zstandard: python -m pip install zstandard') from exc
                stream = zstandard.ZstdDecompressor().stream_reader(region)
            archive = tarfile.open(fileobj=stream, mode='r|')
        else:
            archive = tarfile.open(fileobj=region, mode='r|*')
        with archive:
            for member in archive:
                if not member.isfile():
                    continue  # Never follow links or extract anything to disk.
                rel = safe_relative(member.name)
                if rel is None:
                    report['warnings'].append('Skipped unsafe member name')
                    continue
                report['file_count'] += 1
                report['unpacked_bytes'] += member.size
                if '/resources/' in rel:
                    roots.add(rel.split('/resources/')[0] + '/resources')
                base = rel.rsplit('/', 1)[-1]
                lower = base.lower()
                if lower.endswith(('.node', '.dll', '.exe', '.so')) or '.so.' in lower:
                    append('native_files', rel)
                if lower.endswith('.asar'):
                    record = {'path': rel, 'size': member.size}
                    if member.size >= 16:
                        src = archive.extractfile(member)
                        prefix = src.read(16)
                        json_size = struct.unpack('<4I', prefix)[3] if len(prefix) == 16 else 0
                        if 0 < json_size <= min(MAX_JSON, member.size - 16):
                            try:
                                header = json.loads(src.read(json_size))
                                counts = {'files': 0, 'maps': 0, 'native': 0}
                                manifests = []
                                def walk(nodes, parent='', depth=0):
                                    if not isinstance(nodes, dict) or depth > 80:
                                        return
                                    for key, item in nodes.items():
                                        if not isinstance(item, dict):
                                            continue
                                        p = parent + key
                                        if 'files' in item:
                                            walk(item['files'], p + '/', depth + 1)
                                        else:
                                            counts['files'] += 1
                                            counts['maps'] += p.endswith('.map')
                                            counts['native'] += p.endswith('.node')
                                            if key in ('package.json', 'product.json') and len(manifests) < MAX_LIST:
                                                manifests.append(p)
                                walk(header.get('files', {}))
                                record.update(counts=counts, manifest_paths=manifests)
                            except (ValueError, AttributeError, RecursionError):
                                record['header_unreadable'] = True
                        else:
                            record['header_not_parsed'] = True
                    append('asar_archives', record)
                if base in ('package.json', 'product.json') or lower.endswith('.map'):
                    if member.size > MAX_JSON:
                        if lower.endswith('.map'):
                            append('source_maps', {'path': rel, 'size': member.size, 'skipped_large': True})
                        continue
                    try:
                        data = json.load(archive.extractfile(member))
                        if not isinstance(data, dict):
                            continue
                        if lower.endswith('.map'):
                            content = data.get('sourcesContent', [])
                            sources = data.get('sources', [])
                            append('source_maps', {'path': rel,
                                'source_count': len(sources) if isinstance(sources, list) else 0,
                                'embedded_source_count': sum(isinstance(c, str) for c in content) if isinstance(content, list) else 0,
                                'indexed': 'sections' in data})
                        else:
                            keys = ('name', 'version', 'main', 'commit', 'applicationName', 'nameShort', 'nameLong')
                            record = {'path': rel, **{k: data[k] for k in keys if isinstance(data.get(k), str)}}
                            # Dependency names only, not potentially private registry URLs.
                            for key in ('dependencies', 'devDependencies'):
                                deps = data.get(key)
                                if isinstance(deps, dict):
                                    record[key] = sorted(deps)[:MAX_LIST]
                            append('manifests', record)
                    except (ValueError, UnicodeError):
                        continue
    report['app_roots'] = sorted(roots)
    return report


def inspect(path):
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        magic = stream.read(8)
        stream.seek(0)
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(block)
    result = {'report_version': 1, 'file_name': path.name, 'size': path.stat().st_size,
              'sha256': sha.hexdigest(), 'notes': [
                  'Read-only static inspection; package code was not executed.',
                  'No source code recovered by this report generator.',
                  'No absolute local file paths or application source bodies included.']}
    is_known = result['size'] == EXPECTED_SIZE and result['sha256'] == EXPECTED_SHA
    result['matches_known_linux_release'] = is_known
    if path.name == EXPECTED_NAME and not is_known:
        result['warning'] = 'Known filename but hash/size mismatch; preserve original and investigate.'
        return result
    if magic == b'!<arch>\n':
        result['analysis'] = inspect_deb(path)
    elif magic[:2] == b'MZ' or path.suffix.lower() in ('.exe', '.msi'):
        result['analysis'] = {'format': 'windows-installer', 'status': 'fingerprint-only',
                              'next_step': 'Installer extraction method must be determined separately. Do not run it.'}
    else:
        result['analysis'] = {'format': 'unknown', 'status': 'fingerprint-only'}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('packages', type=Path, nargs='*')
    args = parser.parse_args()
    gui = not args.packages
    root = None
    if gui:
        import tkinter as tk
        from tkinter import filedialog, messagebox
        root = tk.Tk()
        root.withdraw()
        names = filedialog.askopenfilenames(title='Select Linux .deb and/or old Windows installer',
                    filetypes=[('Installation packages', '*.deb *.exe *.msi'), ('All files', '*.*')])
        if not names:
            root.destroy()
            return
        paths = [Path(p) for p in names]
        dest = filedialog.askdirectory(title='Choose a folder for the small JSON reports')
        if not dest:
            root.destroy()
            return
        output = Path(dest)
    else:
        paths = args.packages
        output = Path.cwd()
    saved = []
    try:
        for path in paths:
            print(f'Inspecting {path.name} ...', flush=True)
            report = inspect(path)
            dest = output / (path.name + '.inspection.json')
            # Do not silently overwrite earlier evidence.
            index = 1
            while dest.exists():
                dest = output / (path.name + f'.inspection-{index}.json')
                index += 1
            with dest.open('x', encoding='utf-8') as stream:
                json.dump(report, stream, ensure_ascii=False, indent=2)
                stream.write('\n')
            saved.append(dest.name)
            print(f'Saved: {dest.name}', flush=True)
        if gui:
            messagebox.showinfo('Inspection complete', 'Reports saved. Share the JSON files, not the installers.\n\n' + '\n'.join(saved))
    except Exception as exc:
        if gui:
            messagebox.showerror('Inspection stopped', str(exc) + '\n\nPlease send this error message to the agent.')
        else:
            print(f'Inspection stopped: {exc}', file=sys.stderr)
        return 1
    finally:
        if root:
            root.destroy()
    return 0


if __name__ == '__main__':
    sys.exit(main())
