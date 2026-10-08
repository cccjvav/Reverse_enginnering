#!/usr/bin/env python3
"""Extract the carrier-side modules out of a shipped esbuild bundle.

The author asked whether the logic that never shipped as source is lost for
good. It is not. The extension's .ts files import ~40 modules from the
carrier's own src/, and those are absent from the installer as source - but
their compiled bodies are inside dist/extension.js, which esbuild emits
unminified and annotated with a "// src/<name>.ts" comment before each
module's code. This slices the bundle on those markers.

WHAT YOU GET. Readable JavaScript with the author's original function,
class and constant names, full control flow and string literals.

WHAT IS GONE, and cannot be undone by any tool. TypeScript annotations and
interfaces are erased by the compiler, so parameter and return types must be
reconstructed by hand (as was already done for 0.7.4 under
reconstructed/bridge-core/types). Most comments are gone. Declaration order
and formatting are the bundler's, not the author's.

NOT DEPENDENCY-CLOSED. Unlike reconstruct_bridge_core.mjs, this does not
rewire imports into runnable ESM; a slice can reference helpers esbuild
hoisted elsewhere in the bundle. These files are for reading and for
rebuilding from, not for executing as-is.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# esbuild writes exactly this before each module it inlines.
MARKER = re.compile(r'^// ([A-Za-z0-9_@./-]+\.(?:ts|mts|js|mjs|cjs))$')

# Lines esbuild injects into every module; they carry no authored meaning.
NOISE = re.compile(r'^\s*init_define_[A-Za-z0-9_]+\(\);\s*$')


def segments(bundle_text):
    """Map every marker in the bundle to the lines that follow it."""
    lines = bundle_text.split('\n')
    marks = []
    for index, line in enumerate(lines):
        found = MARKER.match(line.strip())
        if found:
            marks.append((index, found.group(1)))
    out = {}
    for position, (index, name) in enumerate(marks):
        end = marks[position + 1][0] if position + 1 < len(marks) else len(lines)
        body = lines[index + 1:end]
        out.setdefault(name, []).append(body)
    return out


def carrier_imports(source_dir):
    """Module names the extension imports from the carrier's own src/."""
    names = set()
    pattern = re.compile(r'\.\./\.\./\.\./src/([A-Za-z0-9_-]+)\.(?:js|mjs)')
    for path in sorted(source_dir.rglob('*')):
        if path.is_file() and path.suffix in {'.ts', '.mts', '.cts'}:
            names.update(pattern.findall(path.read_text(encoding='utf8', errors='replace')))
    return sorted(names)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--sources', type=Path, required=True,
                        help='recovered src/ tree that names the carrier imports')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--all', action='store_true',
                        help='extract every src/ module in the bundle, not only '
                             'the ones the extension imports directly')
    args = parser.parse_args()

    text = args.bundle.read_text(encoding='utf8', errors='replace')
    found = segments(text)
    direct = carrier_imports(args.sources)
    if args.all:
        # The directly imported modules import further carrier modules of
        # their own. The 0.7.4 reconstruction covered 41 modules for 24 direct
        # imports precisely because it followed that closure; taking every
        # src/ label in the bundle captures it without guessing.
        wanted = sorted({
            name[4:].rsplit('.', 1)[0]
            for name in found
            if name.startswith('src/')
        })
    else:
        wanted = direct

    report = {
        'scope': ('Compiled module bodies sliced out of a shipped esbuild bundle. '
                  'Readable JavaScript, NOT original TypeScript: type annotations '
                  'and most comments are erased by the compiler and are not '
                  'recoverable from the bundle.'),
        'notRunnable': ('Imports are not rewired; slices may reference helpers '
                        'esbuild hoisted elsewhere. For reading and rebuilding, '
                        'not execution.'),
        'bundle': str(args.bundle),
        'bundleSha256': hashlib.sha256(text.encode('utf8', 'replace')).hexdigest(),
        'mode': 'all-src-modules-in-bundle' if args.all else 'direct-imports-only',
        'directImportCount': len(direct),
        'wantedCount': len(wanted),
        'modules': [],
        'missing': [],
    }

    args.output.mkdir(parents=True, exist_ok=True)
    for name in wanted:
        hit = None
        for extension in ('ts', 'mts'):
            key = f'src/{name}.{extension}'
            if key in found:
                hit = (key, found[key])
                break
        if hit is None:
            report['missing'].append(name)
            continue
        key, bodies = hit
        # A module can be inlined into more than one chunk; keep the richest
        # copy rather than the first, which is sometimes an empty stub.
        body = max(bodies, key=lambda b: len([x for x in b if x.strip()]))
        kept = [line for line in body if not NOISE.match(line)]
        while kept and not kept[0].strip():
            kept.pop(0)
        while kept and not kept[-1].strip():
            kept.pop()
        code = '\n'.join(kept)
        header = (f'// EXTRACTED from {key} in {args.bundle.name}.\n'
                  f'// Compiler output, not the author\'s source: types and most\n'
                  f'// comments are gone. Imports are not rewired. See {args.report.name}.\n\n')
        target = args.output / f'{name}.js'
        target.write_text(header + code + '\n', encoding='utf8')
        report['modules'].append({
            'module': name,
            'originLabel': key,
            'codeLines': len([x for x in kept if x.strip()]),
            'occurrencesInBundle': len(bodies),
            'file': target.name,
            'sha256': hashlib.sha256((header + code + '\n').encode('utf8')).hexdigest(),
        })

    report['extractedCount'] = len(report['modules'])
    report['totalCodeLines'] = sum(m['codeLines'] for m in report['modules'])
    report['emptyAfterCompile'] = [m['module'] for m in report['modules'] if m['codeLines'] <= 2]

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n',
                           encoding='utf8')

    print(f"wanted {len(wanted)} carrier modules; "
          f"extracted {report['extractedCount']}, missing {len(report['missing'])}")
    print(f"  {report['totalCodeLines']} lines of code written to {args.output}")
    if report['missing']:
        print('  missing: ' + ', '.join(report['missing']))
    if report['emptyAfterCompile']:
        print('  compiled to nothing (type-only files): '
              + ', '.join(report['emptyAfterCompile']))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
