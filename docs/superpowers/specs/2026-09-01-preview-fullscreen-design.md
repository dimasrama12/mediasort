# MediaSort v2 — Slice #4: Full-Size Preview + Fullscreen Viewer — Design Spec

**Date:** 2026-09-01
**Status:** Draft for plan
**Grounded in:** `DESIGN.md` §2.1 (asset protocol, original-at-full-res), §6.4 (preview delivery by format), §9 (asset scope: source folders granted at runtime), §10 (keyboard baseline), §11.4 (roadmap step 4); `PRD-MediaSort-v2.md` §3.4 (preview & playback), §5.1 (keyboard); the slice #3a thumbnail spec §2/§10, which named "full-res preview and original-file asset scope" as this slice. Fixes v1 **bug #5** (no working fullscreen close button) and completes the bug #4 win by serving pixel-exact originals.

**Scoping note:** `DESIGN` §11.4 bundles multi-select + fullscreen + preview + video. This spec covers only the **single-file fullscreen viewer + inline video for browser-native formats** — the direct bug-#5 fix. Multi-select, grid keyboard-focus (F/Enter-to-open), and HEIC/SVG/TIFF preview *decoding* are split into follow-on slices so they can't block the win, exactly as slice #3a split raster from HEIC/SVG/video.

---

## 1. Goal

Click any file in the grid → a fullscreen viewer that shows the **pixel-exact original** (image) or plays it **inline** (video), with an **always-visible close button + Esc** (the bug #5 fix) and **←/→** navigation through the scanned set. Originals are delivered by Tauri's asset protocol — no IPC bytes, no re-encode — reusing the pipeline built in slice #3a.

## 2. Scope

**In:**
- Click-to-open fullscreen overlay above the grid; click-backdrop / ✕ / Esc to close.
- Pixel-exact original display for the six browser-native raster formats: `jpg jpeg png gif webp bmp`.
- Inline `<video controls>` playback for browser-native video: `mp4 webm mov`.
- Always-visible ✕ close button and Esc; **←/→** (and **J/K**) move prev/next through `files`, clamped at the ends.
- Runtime asset scope: scanned source folders are granted to the asset protocol when a scan starts, so their originals load by URL (`DESIGN` §9).
- Graceful **fallback card** (filename + short reason) for formats WebView2 can't decode/play (`heic heif svg tiff`, `mkv avi`) and for unreadable/missing files — never a thrown error, never a broken grid.

**Out — each its own later slice:**
- Multi-select (Ctrl/Shift-click) and grid keyboard-focus / F/Enter-to-open → the sorting slice (keys 1–9).
- HEIC/HEIF (`libheif`), SVG (`resvg`), and oversized-TIFF decode-and-cache preview → the preview-decoders slice (`DESIGN` §6.4). Until then those formats show the fallback card.
- `preview.rs` + a `get_preview_url` command → introduced by that decoders slice, where a backend round-trip earns its place. For browser-native originals it would only pass the path through, so it is YAGNI here.
- Video-frame *thumbnails* (ffmpeg sidecar) — already deferred by slice #3a.
- Zoom / pan / rotate, slideshow, thumbnail-size slider.

## 3. Success criteria

1. Click a photo → fullscreen, pixel-exact — matches the original with no blur and no upscale artifacts.
2. The ✕ button closes the viewer; **Esc also closes it** — the explicit bug #5 acceptance (`DESIGN` §7 row 5).
3. **←/→** move through the current file set without leaving fullscreen; the ends clamp (no wrap-past-end crash).
4. An MP4 (or WebM) opens and **plays inline** with transport controls (PRD success #4).
5. HEIC / SVG / MKV / unreadable files show the **fallback card**; the grid never errors.
6. No IPC image bytes — originals load by `asset://` URL. `cargo test` and Vitest suites are green.

## 4. Backend

### 4.1 `src-tauri/src/scan.rs` — grant asset scope for scanned roots

At the start of the `scan_folders` command, before spawning the scan, grant each requested root to the asset protocol scope so its files are loadable as originals:

```rust
// pseudocode — exact API verified during implementation (see §9)
for root in &paths {
    let _ = app.asset_protocol_scope().allow_directory(root, /* recursive */ true);
}
```

Scope is in-memory and resets each launch; because there is no project persistence yet, the user always re-scans, which re-grants it. This is the whole backend change for the slice: **no new module, no new command, no new dependency, no new managed state.** The static `tauri.conf.json` scope stays cache-dir-only; originals are runtime-granted (`DESIGN` §9).

### 4.2 `src-tauri/src/lib.rs`

No change — no new command to register. (`scan_folders` is already wired; it gains the scope grant internally.)

## 5. Frontend

### 5.1 `src/lib/preview.ts` (new)

Pure, unit-tested format gate + URL helper — no async, because scope is already granted at scan time and `convertFileSrc` is synchronous:

```ts
import { convertFileSrc } from "@tauri-apps/api/core";
import type { FileInfo } from "./types";

const NATIVE_IMAGE = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const NATIVE_VIDEO = new Set(["mp4", "webm", "mov"]);

export type PreviewKind = "image" | "video" | "unsupported";

export function previewKind(file: FileInfo): PreviewKind {
  const ext = file.extension.toLowerCase();
  if (file.fileType === "video") return NATIVE_VIDEO.has(ext) ? "video" : "unsupported";
  return NATIVE_IMAGE.has(ext) ? "image" : "unsupported";
}

/** Asset URL for the original file (scope granted at scan time). */
export const previewSrc = (file: FileInfo): string => convertFileSrc(file.path);
```

### 5.2 `src/store/useAppStore.ts` — preview state

Add a transient "which file is open in the viewer" plus navigation. Store the **id** (stable across any future re-ordering) and derive the index from `files` for prev/next:

```ts
previewId: string | null;
openPreview: (id: string) => void;   // set previewId
closePreview: () => void;            // previewId = null
previewNext: () => void;             // index+1, clamped to files.length-1
previewPrev: () => void;             // index-1, clamped to 0
```

`previewNext`/`previewPrev` find the current file's index in `files`; if it is missing or at a bound they no-op (clamp). `reset()` also clears `previewId`.

### 5.3 `src/components/Preview.tsx` (new)

Fullscreen overlay; renders `null` when `previewId` is null. Otherwise, for the file resolved from `previewId`:

- **Layout:** `fixed inset-0 z-50` dark backdrop (`bg-black/90`); media centered with `object-contain` so nothing is cropped or upscaled past its pixels.
- **Close (bug #5):** an **always-visible ✕** button, top-right, `z`-above the media, `aria-label="Close"`; clicking the backdrop (not the media) also closes.
- **Media by `previewKind(file)`:** `image` → `<img src={previewSrc(file)} onLoad onError>`; `video` → `<video src={previewSrc(file)} controls autoPlay onError>`; `unsupported` (or an `onError` from the two above) → the **fallback card**: filename + "Preview not available for .heic yet" style message. `onError` is the safety net that catches an unreadable/deleted file or a codec WebView2 rejects.
- **States:** a light loading affordance until `<img> onLoad`; the fallback card on error.
- **Navigation:** prev/next chevrons (disabled at the ends) calling `previewPrev`/`previewNext`.
- **Keyboard:** a `useEffect` attaches a `window` `keydown` while open — `Escape` → `closePreview`; `ArrowRight`/`j` → `previewNext`; `ArrowLeft`/`k` → `previewPrev`; the listener is removed on close/unmount.

### 5.4 `src/components/FileCard.tsx`

Make the card a `<button>` (native click + Enter/Space activation, an a11y win at no extra cost) whose `onClick` calls `openPreview(file.id)`. The thumbnail/placeholder rendering from slice #3a is unchanged.

### 5.5 `src/App.tsx`

Render `<Preview />` as a sibling after `<FileGrid />`; it overlays via its own fixed positioning and shows only when `previewId` is set.

## 6. Capabilities / config

- The asset protocol is already enabled (slice #3a). This slice adds **runtime** scope for source folders; the static `tauri.conf.json` scope stays `["$APPDATA/thumbnails/*"]`. `capabilities/default.json` is expected to need no change (the existing `core:default` covered asset loading for thumbnails) — verified during implementation.
- The exact runtime-scope API (`asset_protocol_scope().allow_directory` vs `allow_file`, and the Windows path form it expects) is the one version-sensitive detail — see §9.

## 7. Security / correctness

- **Scope stays app-relevant:** only folders the user explicitly scans are granted, and only as originals for `<img>`/`<video>`. There is no network permission and no untrusted content that could forge an `asset://` URL, so folder-level scope is an acceptable, PRD-aligned surface (`DESIGN` §9).
- **No IPC bytes:** the asset protocol streams the file; WebView2 decodes natively — the same property that fixed bug #4.
- **`convertFileSrc` stays JS-side**, matching the slice #3a rationale (hand-building `http://asset.localhost/…` in Rust is fragile across platforms/versions).
- **Idempotent + bounded:** re-scans re-grant scope harmlessly; the keydown listener is scoped to the open viewer and torn down on close.

## 8. Testing

**Vitest:**
- `preview.ts`: `previewKind` truth table — `jpg/png/webp/bmp/gif` → `image`; `mp4/webm/mov` → `video`; `heic/svg/tiff` and `mkv/avi` → `unsupported`; branch honors `fileType`.
- `useAppStore`: `openPreview` sets id; `previewNext`/`previewPrev` move and **clamp** at both ends; `closePreview`/`reset` clear it.
- `Preview.tsx`: renders `null` when closed; renders `<img>` for an image and `<video>` for a video (with `convertFileSrc` mocked); renders the fallback card for an `unsupported` file and when `onError` fires; the ✕ button and `Escape` both close; `→`/`←` navigate.
- `FileCard.tsx`: click (and Enter) calls `openPreview(file.id)`.

**cargo test:** no new Rust logic to unit-test (the scan scope grant is an app-runtime side effect); the existing 13 tests stay green. The grant is proven by the manual run.

**Manual (run the app):** scan a real folder → click a photo → sharp fullscreen; **✕ closes, Esc closes** (bug #5); `→`/`←` step through; an MP4 plays inline; a HEIC/SVG/MKV file shows the fallback card; delete a file then preview it → graceful error, no crash.

## 9. Risks / open items

- **Runtime asset-scope API** is the single version-sensitive detail (method name, recursive flag, Windows path form). Well-documented, not a spike; verified first in implementation, with "an original loads via `asset://`" as its acceptance point — mirroring how slice #3a verified its scope syntax.
- **WebView2 video support is codec- not container-dependent** (MOV/H.264 plays; MKV usually will not). The fallback card covers the gaps by design; we do not attempt to enumerate codecs.
- **Very large originals** (e.g. 100 MP) decode in the webview with no downscale tier yet; acceptable for this slice. If a specific huge-image jank shows up, the deferred preview-decoders slice adds decode-to-fit caching (`DESIGN` §6.4).

## 10. Deferred (explicitly not in this slice)

Multi-select + grid keyboard-focus (F/Enter-to-open), HEIC/HEIF + SVG + oversized-TIFF preview decoders (`preview.rs` + `get_preview_url`), video-frame thumbnails (ffmpeg), zoom / pan / rotate, slideshow, thumbnail-size slider.
