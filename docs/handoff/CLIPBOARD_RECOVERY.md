# Recovering the Electron 44 clipboard adaptation

## Why this mattered

The carrier build probe stopped with 11 compile errors. Calling them "small
signature adjustments" would have been wrong. Electron 44.0.0 **rewrote the
clipboard API**: it deleted 13 of 19 methods and made the survivors async.

| Version | Clipboard methods |
| --- | --- |
| 42.7.1, 43.0.0 | 19, synchronous |
| **44.0.0, 44.2.0** | **6** — `clear` `has` `read` `readText` `write` `writeText`, all Promise-based |

Verified by unpacking the published `electron.d.ts` for each version. The break
lands exactly on 44.0.0. Upstream Code OSS 1.132.0 calls five of the deleted
methods, all in `nativeHostMainService.ts`.

## The turning point: the author already solved this

ShunCode 0.7.4 **shipped on Electron 44.2.0**, so the author had already written
an adaptation. Reconstructing my own was the wrong instinct — the shipped
product is first-hand evidence of the real one.

`tools/probe_clipboard_adaptation.py` reads it out of the installed
`out/main.js` during installer forensics. **That file is not minified**, so the
author's implementation is recoverable essentially verbatim, not merely inferred.

## What the recovered code showed

My reconstruction was wrong in ways that mattered — it discarded features the
author had kept:

| Behaviour | My guess | What the author actually did |
| --- | --- | --- |
| Linux `selection` buffer | dropped as unreachable | `clipboard.selection`, **still present in 44**, via a `clipboardForType()` helper |
| macOS find text | degraded to no-op | preserved under a custom MIME type `electron application/findtext` |
| Custom format buffers | bare format string | namespaced `electron application/osclipboard;format="…"` so it cannot collide with web formats |
| `readImage` | returned raw bytes | prefers `image/png`, re-encodes through `nativeImage`, `try/catch` per item |

So the honest count of feature losses went from six to **zero**. The author's
design is simply better than what I had inferred, which is the whole argument
for reading the shipped product before writing a patch.

## What is recovered vs reconstructed

Being precise about this matters:

- **Recovered** — the control flow, the MIME-type strings, the helper, the
  fallbacks. Transcribed from the shipped JavaScript.
- **Reconstructed** — TypeScript type annotations, and three `as Blob`
  narrowings. Types are erased at compile time, so no amount of reading
  `main.js` can return them. `getType()` is typed `Blob | ClipboardBookmark`,
  and only the bookmark MIME type produces the latter.

## How it was verified

Typechecked against the real Electron 44.2.0 `.d.ts`, with a control to prove
the check has teeth:

- unpatched upstream clipboard region → **9 errors**, exactly matching what CI
  reported for that file
- recovered implementation → **0 errors**

`tools/patch_carrier_electron44.py` applies 13 exact-match edits and **aborts
entirely** if any one of them does not match exactly once, so it can never write
a half-patch against an unexpected tree.

## Status

Remaining after this: the two non-clipboard errors,
`browserViewMainService.ts:535` and `auth.ts:24`, both also addressed by the
patch. Whether the full `npm run compile` goes green is decided by the carrier
build probe, not by this typecheck.
