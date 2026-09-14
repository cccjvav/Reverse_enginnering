#!/usr/bin/env python3
"""Static completeness/provenance audit; never import or execute recovered code."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import posixpath
import re

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / 'recovered/shuncode-extension'


def resolve_reference(base, specifier, existing):
    target = posixpath.normpath(posixpath.join(base, specifier))
    options = [target]
    for shipped, source in (('.js', '.ts'), ('.mjs', '.mts'), ('.cjs', '.cts')):
        if target.endswith(shipped):
            options.append(target[:-len(shipped)] + source)
    if not posixpath.splitext(target)[1]:
        options.extend(target + suffix for suffix in ('.ts', '.mts', '.js', '/index.ts'))
    return next((option for option in options if option in existing), None)


def audit(extension, manifest):
    existing = {p.relative_to(extension).as_posix() for p in extension.rglob('*') if p.is_file()}
    hashes = []
    for entry in manifest['copied']:
        file = extension / entry['path']
        actual = hashlib.sha256(file.read_bytes()).hexdigest() if file.is_file() else None
        hashes.append({'path': entry['path'], 'matches_original': actual == entry['sha256']})
    source_files = sorted(p for p in existing if p.startswith('src/') and p.endswith(('.ts', '.mts', '.cts')))
    missing = []
    packages = Counter()
    imports = re.compile(r'(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*[\'\"]([^\'\"]+)[\'\"]')
    for relative in source_files:
        text = (extension / relative).read_text(encoding='utf-8')
        for specifier in sorted(set(imports.findall(text))):
            if specifier.startswith('.'):
                if resolve_reference(posixpath.dirname(relative), specifier, existing) is None:
                    missing.append({'from': relative, 'specifier': specifier,
                                    'normalized_target': posixpath.normpath(posixpath.join(posixpath.dirname(relative), specifier))})
            else:
                packages[specifier] += 1
    config = json.loads((extension / 'tsconfig.json').read_text())
    missing_config = [path for path in config.get('files', []) if path not in existing]
    compiled_origins = {}
    for relative in ('dist/extension.js', 'runtime/agent-host.js', 'runtime/mcp-server.js'):
        path = extension / relative
        if not path.exists():
            continue
        labels = sorted(set(re.findall(r'^// ((?:src|extensions/shuncode|runtime)/[^\r\n]+)', path.read_text(encoding='utf-8'), re.MULTILINE)))
        compiled_origins[relative] = labels
    package = json.loads((extension / 'package.json').read_text())
    return {'scope': 'Static inventory/regex audit; not a full TypeScript module resolver or a build test.',
            'source_file_count': len(source_files), 'source_files': source_files,
            'source_bytes': sum((extension / p).stat().st_size for p in source_files),
            'provenance': hashes, 'all_hashes_match': all(p['matches_original'] for p in hashes),
            'unresolved_relative_imports': missing, 'external_import_specifiers': dict(sorted(packages.items())),
            'missing_tsconfig_files': missing_config, 'compiled_source_labels': compiled_origins,
            'manifest_has_scripts': 'scripts' in package,
            'manifest_has_dependencies': 'dependencies' in package,
            'manifest_has_dev_dependencies': 'devDependencies' in package,
            'proposed_apis': package.get('enabledApiProposals', []),
            'note': 'Source labels in bundles are clues to original module boundaries, not embedded original TypeScript.'}


def main():
    manifest = json.loads((ROOT / 'docs/evidence/custom-extension.json').read_text())
    report = audit(EXTENSION, manifest)
    output = ROOT / 'docs/evidence/source-completeness.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{report["source_file_count"]} source files; hashes match: {report["all_hashes_match"]}; unresolved relative imports: {len(report["unresolved_relative_imports"])}')
    if not report['all_hashes_match']:
        raise SystemExit('Recovered file hash mismatch')


if __name__ == '__main__':
    main()
