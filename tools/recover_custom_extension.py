#!/usr/bin/env python3
"""Recover an allowlisted extension's shipped text files, without executing code."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

ALLOWED = {'.map', '.js', '.cjs', '.mjs', '.ts', '.cts', '.mts', '.json', '.html', '.css', '.md', '.txt', '.svg', '.yml', '.yaml'}
MAX_FILE = 8 * 1024 * 1024
MAX_TOTAL = 20 * 1024 * 1024
SECRET_PATTERNS = {
    'private_key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
    'github_token': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})\b'),
    'aws_access_key': re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'provider_key': re.compile(r'\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b'),
    'jwt_literal': re.compile(r'\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b'),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def secret_findings(text):
    return [{'kind': kind, 'offset': match.start()} for kind, pattern in SECRET_PATTERNS.items()
            for match in list(pattern.finditer(text))[:20]]


def asar_index(path):
    report = {'path': path.name, 'size': path.stat().st_size}
    with path.open('rb') as stream:
        prefix = stream.read(16)
        if len(prefix) != 16:
            return {**report, 'error': 'short header'}
        size = struct.unpack('<4I', prefix)[3]
        if not 0 < size <= min(16 * 1024 * 1024, path.stat().st_size - 16):
            return {**report, 'error': 'invalid or excessive JSON header size'}
        header = json.loads(stream.read(size))
    counts = {'files': 0, 'maps': 0, 'typescript': 0}
    maps = []
    def visit(nodes, parent='', depth=0):
        if depth > 80 or not isinstance(nodes, dict):
            return
        for name, node in nodes.items():
            if not isinstance(node, dict):
                continue
            rel = parent + name
            if 'files' in node:
                visit(node['files'], rel + '/', depth + 1)
            else:
                counts['files'] += 1
                counts['maps'] += rel.endswith('.map')
                counts['typescript'] += rel.endswith('.ts')
                if rel.endswith('.map') and len(maps) < 100:
                    maps.append(rel)
    visit(header.get('files', {}))
    return {**report, **counts, 'map_paths': maps}


def recover(tree, output):
    candidates = [p for p in tree.rglob('extensions/shuncode/package.json') if not p.is_symlink()]
    if len(candidates) != 1:
        raise ValueError(f'Expected one custom extension; found {len(candidates)}')
    extension = candidates[0].parent
    app = extension.parent.parent
    report = {'origin': extension.relative_to(tree).as_posix(), 'copied': [], 'skipped': [],
              'scope': 'Exact shipped text files, not original source reconstruction. Do not execute before review.',
              'secret_scan': 'Heuristic gate for common private keys/tokens only; NOT a security audit.',
              'core_code_index': [], 'asar_indexes': []}
    selected = []
    total = 0
    for path in sorted(extension.rglob('*')):
        if path.is_symlink() or not path.is_file():
            continue
        rel = path.relative_to(extension).as_posix()
        size = path.stat().st_size
        reason = None
        if 'node_modules' in path.relative_to(extension).parts:
            reason = 'third-party dependencies excluded'
        elif path.suffix.lower() not in ALLOWED:
            reason = 'non-text or non-allowlisted file'
        elif size > MAX_FILE:
            reason = 'file size limit'
        if reason:
            report['skipped'].append({'path': rel, 'size': size, 'reason': reason})
            continue
        data = path.read_bytes()
        try:
            text = data.decode('utf-8')
        except UnicodeError:
            report['skipped'].append({'path': rel, 'reason': 'not UTF-8'})
            continue
        findings = secret_findings(text)
        if findings:
            report['skipped'].append({'path': rel, 'reason': 'potential credential; withheld for review', 'findings': findings})
            continue
        total += len(data)
        if total > MAX_TOTAL or len(selected) >= 1200:
            raise ValueError('Recovery budget exceeded; refine selection before publishing')
        selected.append((rel, data))
        report['copied'].append({'path': rel, 'size': size, 'sha256': digest(data),
                                 'source_mapping_url_present': 'sourceMappingURL=' in text,
                                 'inline_source_map_present': bool(re.search(r'sourceMappingURL=data:', text)),
                                 'is_declaration': path.name.endswith(('.d.ts', '.d.cts', '.d.mts'))})
    # Core paths and keyword counts guide later targeted comparison, without dumping bundles.
    for path in sorted((app / 'out').rglob('*')):
        if path.is_symlink() or not path.is_file() or path.suffix not in ('.js', '.css', '.html'):
            continue
        size = path.stat().st_size
        record = {'path': path.relative_to(app).as_posix(), 'size': size}
        if size <= 80 * 1024 * 1024:
            data = path.read_bytes()
            record.update(sha256=digest(data), shuncode_occurrences=data.lower().count(b'shuncode'),
                          source_mapping_url_present=b'sourceMappingURL=' in data)
        report['core_code_index'].append(record)
    for path in sorted(app.glob('*.asar')):
        report['asar_indexes'].append(asar_index(path))
    # Refuse to overwrite edited evidence; unchanged prior recovery is idempotent.
    for rel, data in selected:
        dest = output / rel
        if dest.is_symlink() or (dest.exists() and dest.read_bytes() != data):
            raise ValueError(f'Existing evidence differs: {rel}')
    output.mkdir(parents=True, exist_ok=True)
    for rel, data in selected:
        dest = output / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    report['copied_count'] = len(selected)
    report['copied_bytes'] = total
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tree', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    result = recover(args.tree, args.output)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Recovered {result["copied_count"]} shipped text files; inspect report for omissions.')


if __name__ == '__main__':
    main()
