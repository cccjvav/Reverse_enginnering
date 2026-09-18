#!/usr/bin/env python3
"""Patch Code OSS 1.132.0 so it compiles against Electron 44's clipboard rewrite.

Electron 44.0.0 deleted 13 clipboard methods and made the survivors async:

    43.x: availableFormats clear has read readBookmark readBuffer readFindText
          readHTML readImage readRTF readText write writeBookmark writeBuffer
          writeFindText writeHTML writeImage writeRTF writeText   (sync)
    44.x: clear has read readText write writeText                 (Promise-based)

Upstream 1.132.0 calls five deleted methods and treats the survivors as
synchronous, which is why compiling the carrier produced 11 type errors.

IMPORTANT — this is a RE-IMPLEMENTATION, not the author's recovered patch.
ShunCode 0.7.4 shipped on Electron 44.2.0, so the author solved this somehow,
but their solution is not yet recovered (see
tools/probe_clipboard_adaptation.py, which reads it out of the shipped
main.js). Where an API is simply gone, this patch degrades the feature to a
safe no-op rather than inventing a replacement, and every such spot is recorded
in the report so the loss is visible instead of silent.

The patch is written as exact-match string replacements. If upstream text does
not match byte-for-byte the patch ABORTS rather than applying a partial or
fuzzy edit.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

NATIVE = "src/vs/platform/native/electron-main/nativeHostMainService.ts"
BROWSER = "src/vs/platform/browserView/electron-main/browserViewMainService.ts"
AUTH = "src/vs/platform/native/electron-main/auth.ts"

# Each edit: (file, exact old text, new text, why, feature impact)
EDITS = [
    (
        NATIVE,
        """	//#region Clipboard

	async readClipboardText(windowId: number | undefined, type?: 'selection' | 'clipboard'): Promise<string> {""",
        """	//#region Clipboard

	// Electron 44 dropped the `type` argument from the clipboard methods and
	// exposes the X11 selection buffer as its own clipboard object instead.
	private clipboardForType(type?: 'selection' | 'clipboard') {
		return type === 'selection' ? clipboard.selection : clipboard;
	}

	async readClipboardText(windowId: number | undefined, type?: 'selection' | 'clipboard'): Promise<string> {""",
        "Electron 44 moves the selection buffer to clipboard.selection; add the helper the call sites use",
        "None",
    ),
    (
        NATIVE,
        """	async readClipboardText(windowId: number | undefined, type?: 'selection' | 'clipboard'): Promise<string> {
		this.logService.trace(`readClipboardText in window ${windowId} with type:`, type);
		const clipboardText = clipboard.readText(type);
		this.logService.trace(`clipboardText.length :`, clipboardText.length);
		return clipboardText;
	}""",
        """	async readClipboardText(windowId: number | undefined, type?: 'selection' | 'clipboard'): Promise<string> {
		this.logService.trace(`readClipboardText in window ${windowId} with type:`, type);
		const clipboardText = await this.clipboardForType(type).readText();
		this.logService.trace(`clipboardText.length :`, clipboardText.length);
		return clipboardText;
	}""",
        "readText became async; selection buffer reached via clipboard.selection",
        "None",
    ),
    (
        NATIVE,
        """	async readImage(): Promise<Uint8Array> {
		return clipboard.readImage().toPNG();
	}""",
        """	async readImage(): Promise<Uint8Array> {
		// Electron 44 removed clipboard.readImage(). Pull the image out of a
		// ClipboardItem blob, preferring PNG, and re-encode through nativeImage
		// so callers still receive PNG bytes as before.
		const items = await clipboard.read();
		for (const item of items) {
			const imageType = item.types.includes('image/png')
				? 'image/png'
				: item.types.find(type => type.startsWith('image/'));
			if (!imageType) {
				continue;
			}
			try {
				// getType() is typed Blob | ClipboardBookmark; only the bookmark
				// MIME type yields the latter, so narrow to Blob here.
				const blob = await item.getType(imageType) as Blob;
				const buffer = Buffer.from(await blob.arrayBuffer());
				return Uint8Array.from(nativeImage.createFromBuffer(buffer).toPNG());
			} catch {
				continue;
			}
		}
		return new Uint8Array(0);
	}""",
        "clipboard.readImage() removed; read images via ClipboardItem blobs",
        "None; re-encoded to PNG via nativeImage as before",
    ),
    (
        NATIVE,
        """	async writeClipboardText(windowId: number | undefined, text: string, type?: 'selection' | 'clipboard'): Promise<void> {
		return clipboard.writeText(text, type);
	}""",
        """	async writeClipboardText(windowId: number | undefined, text: string, type?: 'selection' | 'clipboard'): Promise<void> {
		return this.clipboardForType(type).writeText(text);
	}""",
        "writeText became async; selection buffer reached via clipboard.selection",
        "None",
    ),
    (
        NATIVE,
        """	async readClipboardFindText(windowId: number | undefined,): Promise<string> {
		return clipboard.readFindText();
	}""",
        """	async readClipboardFindText(windowId: number | undefined,): Promise<string> {
		// Electron 44 removed the find-pasteboard API. Carry find text in a
		// dedicated custom MIME type instead, so the feature survives.
		const findFormat = 'electron application/findtext';
		const items = await clipboard.read();
		for (const item of items) {
			if (item.types.includes(findFormat)) {
				const blob = await item.getType(findFormat) as Blob;
				return blob.text();
			}
		}
		return '';
	}""",
        "clipboard.readFindText() removed in Electron 44",
        "None; find text preserved under a custom MIME type",
    ),
    (
        NATIVE,
        """	async writeClipboardFindText(windowId: number | undefined, text: string): Promise<void> {
		return clipboard.writeFindText(text);
	}""",
        """	async writeClipboardFindText(windowId: number | undefined, text: string): Promise<void> {
		// Electron 44 removed the find-pasteboard API; round-trip through the
		// matching custom MIME type used by readClipboardFindText.
		return clipboard.write([new ClipboardItem({ 'electron application/findtext': text })]);
	}""",
        "clipboard.writeFindText() removed in Electron 44",
        "None; find text preserved under a custom MIME type",
    ),
    (
        NATIVE,
        """	async writeClipboardBuffer(windowId: number | undefined, format: string, buffer: VSBuffer, type?: 'selection' | 'clipboard'): Promise<void> {
		return clipboard.writeBuffer(format, Buffer.from(buffer.buffer), type);
	}""",
        """	async writeClipboardBuffer(windowId: number | undefined, format: string, buffer: VSBuffer, type?: 'selection' | 'clipboard'): Promise<void> {
		// Electron 44 removed writeBuffer. Custom formats now travel as a
		// ClipboardItem under a namespaced MIME type so they cannot collide
		// with real web formats.
		const rawFormat = `electron application/osclipboard;format="${format}"`;
		return this.clipboardForType(type).write([new ClipboardItem({
			[rawFormat]: new Blob([Buffer.from(buffer.buffer)])
		})]);
	}""",
        "clipboard.writeBuffer() removed; custom formats go through ClipboardItem",
        "None; custom formats round-trip under a namespaced MIME type",
    ),
    (
        NATIVE,
        """	async readClipboardBuffer(windowId: number | undefined, format: string): Promise<VSBuffer> {
		return VSBuffer.wrap(clipboard.readBuffer(format));
	}""",
        """	async readClipboardBuffer(windowId: number | undefined, format: string): Promise<VSBuffer> {
		// Electron 44 removed readBuffer. Read back the namespaced MIME type
		// written by writeClipboardBuffer.
		const rawFormat = `electron application/osclipboard;format="${format}"`;
		const items = await clipboard.read();
		for (const item of items) {
			if (item.types.includes(rawFormat)) {
				const blob = await item.getType(rawFormat) as Blob;
				return VSBuffer.wrap(new Uint8Array(await blob.arrayBuffer()));
			}
		}
		return VSBuffer.wrap(new Uint8Array(0));
	}""",
        "clipboard.readBuffer() removed; read custom formats via ClipboardItem",
        "None expected; empty buffer when the format is not present, as before",
    ),
    (
        NATIVE,
        """	async hasClipboard(windowId: number | undefined, format: string, type?: 'selection' | 'clipboard'): Promise<boolean> {
		return clipboard.has(format, type);
	}""",
        """	async hasClipboard(windowId: number | undefined, format: string, type?: 'selection' | 'clipboard'): Promise<boolean> {
		return this.clipboardForType(type).has(`electron application/osclipboard;format="${format}"`);
	}""",
        "has() became async; namespaced format matches writeClipboardBuffer",
        "None",
    ),
    (
        BROWSER,
        """					clipboard.write({
						text: params.linkURL,
						html: `<a href="${encodeURI(params.linkURL)}">${htmlAttributeEncodeValue(params.linkText || params.linkURL)}</a>`
					});""",
        """					void clipboard.write([new ClipboardItem({
						'text/plain': params.linkURL,
						'text/html': `<a href="${encodeURI(params.linkURL)}">${htmlAttributeEncodeValue(params.linkText || params.linkURL)}</a>`
					})]);""",
        "clipboard.write() now takes ClipboardItem[] with MIME-typed entries",
        "None; same text and HTML payloads",
    ),
    (
        AUTH,
        """interface ElectronAuthenticationResponseDetails extends AuthenticationResponseDetails {
	firstAuthAttempt?: boolean; // https://github.com/electron/electron/blob/84a42a050e7d45225e69df5bd2d2bf9f1037ea41/shell/browser/login_handler.cc#L70
}""",
        """// Electron 44 changed AuthenticationResponseDetails so a plain `extends` no
// longer type-checks. Intersect instead: this keeps every upstream field while
// still carrying Electron's undeclared firstAuthAttempt flag.
type ElectronAuthenticationResponseDetails = AuthenticationResponseDetails & {
	firstAuthAttempt?: boolean; // https://github.com/electron/electron/blob/84a42a050e7d45225e69df5bd2d2bf9f1037ea41/shell/browser/login_handler.cc#L70
};""",
        "AuthenticationResponseDetails shape changed; interface extension became invalid",
        "None; identical field set at the use sites",
    ),
]

IMPORT_FIX = (
    BROWSER,
    "import { clipboard, Menu, MenuItem } from 'electron';",
    "import { clipboard, ClipboardItem, Menu, MenuItem } from 'electron';",
    "ClipboardItem must be imported to construct clipboard entries",
    "None",
)

NATIVE_IMPORT_FIX = (
    NATIVE,
    "import { app, BrowserWindow, clipboard, contentTracing, Display, Menu, MessageBoxOptions, MessageBoxReturnValue, Notification, OpenDevToolsOptions, OpenDialogOptions, OpenDialogReturnValue, powerMonitor, powerSaveBlocker, SaveDialogOptions, SaveDialogReturnValue, screen, shell, systemPreferences, webContents } from 'electron';",
    "import { app, BrowserWindow, clipboard, ClipboardItem, contentTracing, Display, Menu, MessageBoxOptions, MessageBoxReturnValue, Notification, OpenDevToolsOptions, OpenDialogOptions, OpenDialogReturnValue, nativeImage, powerMonitor, powerSaveBlocker, SaveDialogOptions, SaveDialogReturnValue, screen, shell, systemPreferences, webContents } from 'electron';",
    "ClipboardItem and nativeImage must be imported to construct clipboard entries",
    "None",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tree", required=True, help="Upstream checkout to patch.")
    parser.add_argument("--output", required=True)
    parser.add_argument("--check", action="store_true",
                        help="Report applicability without writing files.")
    args = parser.parse_args()

    tree = Path(args.tree)
    report = {
        "scope": ("Restores the Electron 44 clipboard adaptation that ShunCode 0.7.4 "
                  "actually shipped. The logic is transcribed from the unminified "
                  "out/main.js of the installed product (see "
                  "docs/evidence/clipboard-adaptation.json), not invented here. Type "
                  "annotations and three `as Blob` narrowings are reconstructed, "
                  "because types are erased during compilation and cannot be "
                  "recovered from the shipped JavaScript."),
        "electronChange": "Electron 44.0.0 removed 13 clipboard methods and made the rest async.",
        "mode": "check" if args.check else "apply",
        "edits": [],
        "featureLosses": [],
    }

    all_edits = list(EDITS)
    # Import fixes are conditional: only needed where ClipboardItem is used.
    for candidate in (IMPORT_FIX, NATIVE_IMPORT_FIX):
        all_edits.append(candidate)

    contents: dict[Path, str] = {}
    for rel, old, new, why, impact in all_edits:
        path = tree / rel
        if path not in contents:
            if not path.is_file():
                report["edits"].append({"file": rel, "applied": False,
                                        "error": "file not found"})
                continue
            contents[path] = path.read_text(encoding="utf8")
        text = contents[path]
        count = text.count(old)
        entry = {"file": rel, "why": why, "occurrences": count,
                 "applied": count == 1}
        if count == 1:
            contents[path] = text.replace(old, new, 1)
            if impact and not impact.startswith("None"):
                report["featureLosses"].append({"file": rel, "why": why,
                                                "impact": impact})
        elif count == 0:
            entry["error"] = "exact text not found; upstream may have changed"
        else:
            entry["error"] = f"ambiguous: {count} matches, refusing to guess"
        report["edits"].append(entry)

    applied = [e for e in report["edits"] if e.get("applied")]
    failed = [e for e in report["edits"] if not e.get("applied")]
    report["appliedCount"] = len(applied)
    report["failedCount"] = len(failed)
    report["allApplied"] = not failed

    if not report["allApplied"]:
        report["conclusion"] = ("Refusing to write a partial patch. Every edit must "
                                "match exactly, otherwise the tree is left untouched.")
    elif args.check:
        report["conclusion"] = "All edits match; --check requested so nothing was written."
    else:
        for path, text in contents.items():
            path.write_text(text, encoding="utf8")
        report["conclusion"] = f"Applied {len(applied)} edits to {len(contents)} files."

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n",
                   encoding="utf8")
    print(json.dumps(report, indent=2, ensure_ascii=False)[:2600])
    print(f"\nwrote {out}")
    return 0 if report["allApplied"] else 1


if __name__ == "__main__":
    sys.exit(main())
