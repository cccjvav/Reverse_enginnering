#!/usr/bin/env python3
"""Offline, hash-locked community overlay installer. Never runs ShunCode."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import uuid


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(root, relative, app_file=False):
    if not isinstance(relative, str) or '\\' in relative or ':' in relative:
        raise ValueError('Invalid relative path')
    rel = PurePosixPath(relative)
    if rel.is_absolute() or '..' in rel.parts or not rel.parts:
        raise ValueError('Unsafe relative path')
    if app_file and rel.parts[:2] != ('resources', 'app'):
        raise ValueError('Overlay may only change resources/app')
    root = root.resolve()
    candidate = root
    for part in rel.parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise ValueError(f'Symlinks are not allowed: {relative}')
    candidate.resolve().relative_to(root)
    return candidate


def checked(path, expected):
    data = path.read_bytes()
    if sha(data) != expected:
        raise ValueError(f'Hash mismatch; no patch applied to {path.name}. This overlay requires the exact uploaded 0.7.4 build.')
    return data


def prepare(app, payload):
    manifest = json.loads((payload / 'overlay-manifest.json').read_text(encoding='utf-8'))
    result = []
    for item in manifest['files']:
        target = safe_path(app, item['path'], app_file=True)
        old = checked(target, item['originalSha256'])
        new = checked(safe_path(payload, item['path']), item['sha256'])
        result.append((item['path'], old, new))
    for item in manifest['uiPatches']:
        target = safe_path(app, item['path'], app_file=True)
        old = checked(target, item['originalSha256'])
        find = checked(safe_path(payload, item['find']), item['findSha256'])
        replacement = checked(safe_path(payload, item['replace']), item['replaceSha256'])
        if not find or old.count(find) != 1:
            raise ValueError(f'Expected exactly one custom UI class in {target.name}')
        result.append((item['path'], old, old.replace(find, replacement, 1)))
    if len({r[0] for r in result}) != len(result):
        raise ValueError('Duplicate target paths')
    return result


def atomic_write(path, data):
    # Same-directory replacement: a single file is never left half-written.
    fd, temporary = tempfile.mkstemp(prefix='.shuncode-update-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        if path.exists():
            shutil.copymode(path, temporary)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def install(app, payload):
    app = app.resolve()
    lock = app / '.shuncode-community.lock'
    with lock.open('x') as stream:
        stream.write('Close all ShunCode processes before installing.\n')
    try:
        plan = prepare(app, payload)  # Revalidate everything under the update lock.
        backup = safe_path(app, '.shuncode-community-backups/' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8])
        backup.mkdir(parents=True)
        journal = {'edition': 'community', 'status': 'prepared', 'files': []}
        for relative, old, new in plan:
            copy = safe_path(backup, relative, app_file=True)
            copy.parent.mkdir(parents=True, exist_ok=True)
            copy.write_bytes(old)
            journal['files'].append({'path': relative, 'originalSha256': sha(old), 'sha256': sha(new)})
        (backup / 'backup.json').write_text(json.dumps(journal, indent=2) + '\n')
        written = []
        try:
            for relative, old, new in plan:
                target = safe_path(app, relative, app_file=True)
                checked(target, sha(old))  # Detect a concurrent application updater.
                atomic_write(target, new)
                written.append((relative, old, new))
        except Exception as exc:
            rollback_errors = []
            for relative, old, new in reversed(written):
                try:
                    target = safe_path(app, relative, app_file=True)
                    checked(target, sha(new))
                    atomic_write(target, old)
                except Exception:
                    rollback_errors.append(relative)
            journal['status'] = 'rollback-incomplete' if rollback_errors else 'rolled-back'
            journal['rollback_errors'] = rollback_errors
            (backup / 'backup.json').write_text(json.dumps(journal, indent=2) + '\n')
            raise RuntimeError(f'Update failed. Backup: {backup}. Rollback status: {journal["status"]}. Cause: {exc}') from exc
        journal['status'] = 'applied'
        (backup / 'backup.json').write_text(json.dumps(journal, indent=2) + '\n')
        return backup
    finally:
        lock.unlink(missing_ok=True)


def _restore(app, backup):
    # Refuse to overwrite an app that has since been updated or edited independently.
    journal = json.loads((backup / 'backup.json').read_text())
    plan = []
    for item in journal['files']:
        old = checked(safe_path(backup, item['path'], app_file=True), item['originalSha256'])
        target = safe_path(app, item['path'], app_file=True)
        current = target.read_bytes()
        if sha(current) not in (item['originalSha256'], item['sha256']):
            raise ValueError(f'File changed after patch: {item["path"]}; restore manually from backup after review.')
        plan.append((target, old))
    for target, old in plan:
        atomic_write(target, old)


def restore(app, backup):
    app = app.resolve()
    lock = app / '.shuncode-community.lock'
    with lock.open('x') as stream:
        stream.write('Restore in progress. Close all ShunCode processes.\n')
    try:
        _restore(app, backup)
    finally:
        lock.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-dir', type=Path, help='Installed directory containing resources/app')
    parser.add_argument('--payload', type=Path, default=Path(__file__).resolve().parent / 'payload')
    parser.add_argument('--apply', action='store_true', help='Write changes; default CLI operation is validation only')
    parser.add_argument('--restore', type=Path, help='Restore a backup directory instead of installing')
    args = parser.parse_args()
    root = None
    try:
        gui = args.app_dir is None
        if gui:
            import tkinter as tk
            from tkinter import filedialog, messagebox
            root = tk.Tk(); root.withdraw()
            selected = filedialog.askdirectory(title='Select ShunCode folder containing resources/app')
            if not selected:
                return 0
            args.app_dir = Path(selected)
        if args.restore:
            restore(args.app_dir, args.restore)
            print('Original files restored. No app was launched.')
            return 0
        plan = prepare(args.app_dir, args.payload)
        print(f'Validated {len(plan)} files. No user settings or credentials are modified.')
        if gui:
            args.apply = messagebox.askyesno('Community update (experimental)',
                f'All {len(plan)} original files match. Close ALL ShunCode windows and background processes first.\n\nApply the community update with an automatic backup?\nThis does not make external model or tunnel providers free.')
        if args.apply:
            backup = install(args.app_dir, args.payload)
            message = f'Applied. Backup: {backup}\nNo application was launched. Keep this backup for rollback.'
            print(message)
            if gui:
                messagebox.showinfo('Community update applied', message)
        else:
            print('Validation only; no files changed.')
        return 0
    except Exception as exc:
        print(f'Stopped: {exc}')
        if root is not None:
            from tkinter import messagebox
            messagebox.showerror('Update stopped', str(exc))
        return 1
    finally:
        if root is not None:
            root.destroy()


if __name__ == '__main__':
    raise SystemExit(main())
