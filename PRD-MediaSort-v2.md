# PRD — MediaSort v2 (rebuild)

**Status:** Draft for build
**Owner:** Dimas Rama
**New stack:** Tauri v2 + Rust + React + TypeScript
**Replaces:** PhotoSort v1 (Go / Wails) — fully scrapped
**Name:** working title `MediaSort` (rename before release — v1's "PhotoSort" is misleading now)

---

## 1. Context & Positioning

PhotoSort v1 (Go/Wails) reached ~95% feature-complete but the UI is a 1/10: blurry previews, no working fullscreen close button, cluttered header, and an AI grouping feature (Gemini + perceptual hashing) that never worked reliably. The app is functional but unshippable.

**Market gap (from research):** Eagle, digiKam, PhotoPrism, XnView all target *permanent library management* — cataloging, tagging, and search over a collection you keep forever. None focus on the **rapid one-pass sorting workflow**: point at a messy dump folder, auto-cluster near-duplicates, blast through them with keyboard keys 1-9, and safely delete the junk. That is MediaSort's niche. v2 keeps v1's genuinely useful features but drops the broken AI, narrows scope to photos + video, and rebuilds the whole thing on a modern, performant stack.

**Non-goals:** No cloud sync, no AI/Gemini (removed entirely), no photo/video editing, no tagging catalog. This is a fast sorting tool, not a DAM.

---

## 2. Scope Decisions (locked)

| Decision | Choice |
|---|---|
| File types | **Photos + video only** (v1's audio / PSD / AI / PDF / code / archive support is dropped) |
| AI grouping | **Removed entirely** — all logic, buttons, and Gemini settings gone |
| Grouping method | pHash + temporal proximity only (kept, this worked) |
| Batch rename | **Kept** |
| Project save / load | **Kept** |
| Search & filter | **Kept** |
| Trash + restore | **Kept** — and actually wired to the UI this time (v1 bug) |
| Undo / redo | **Kept** |
| Name | **Rename** from PhotoSort |

**Supported formats**
- Photos: JPG, JPEG, PNG, GIF, WebP, BMP, TIFF (drop HEIC/SVG unless trivial)
- Video: MP4, MKV, MOV, AVI, WebM

---

## 3. Features to Build

### 3.1 Folder scanning
Select one or more source folders; recursive scan for photos + video. Progress shown; scan runs on a Rust background thread and streams results so the UI never freezes on folders with thousands of files.

### 3.2 Grouping (pHash + temporal only)
Perceptual-hash every image (`image_hasher` crate, dHash default / pHash option), compare by Hamming distance with a user-adjustable threshold. Group near-duplicates OR files shot within a configurable time window (EXIF `DateTimeOriginal`, fallback to file mtime). Groups listed in the sidebar with type indicator (visual / temporal) and similarity %; click a group to filter the grid. **No AI anywhere.**

### 3.3 Target folder mapping (keys 1-9)
Map up to 9 destination folders to number keys. Pressing a number moves the focused file (or current selection) to that folder. Visible legend of the key→folder mapping. Folder create / rename / delete from the sidebar.

### 3.4 Preview & playback
- **HD thumbnail pipeline** replacing v1's blurry previews: Rust generates sharp, correctly-sized thumbnails (Lanczos3), cached on disk keyed by `path + mtime + size` so re-scans are instant.
- Video thumbnails via a bundled **ffmpeg sidecar** (representative frame).
- Full-size preview on demand; **fullscreen with an always-visible, working close button** (the specific v1 bug) plus Esc to exit.
- **Inline video playback** for MP4/MOV/etc. with standard transport controls (play/pause/seek/volume) via the WebView `<video>` element.
- Adjustable thumbnail size (slider + Ctrl+= / Ctrl+-), carried over from v1.

### 3.5 Selection, batch rename, search
- Multi-file selection (Ctrl/Shift click, keyboard nav, select-all).
- Batch rename with pattern + `{n}` placeholder, start number, leading-zero padding, live preview (from v1).
- Real-time search + group filter with results count.

### 3.6 Safe deletion + trash
- Delete sends to a recoverable trash by default (v1's `trash` behavior, but **fully wired to the UI**).
- Trash panel: list deleted items (name, date, original path), restore individual items, empty-trash with confirmation, count badge.
- Never silently hard-deletes; permanent delete is explicit and confirmed.

### 3.7 Undo / redo
Command-pattern undo/redo for moves, folder create/rename/delete, and (where possible) deletes. Visible enabled/disabled state in the UI. (Ports v1's system.)

### 3.8 Project save / load
Save a sorting session (file metadata, folder structure + key mapping, groups, settings, timestamps) to disk; list, load, delete, import/export. (Ports v1.)

---

## 4. Bugs from v1 that MUST NOT recur (build as requirements)

These are documented v1 failures — treat each as an acceptance test:
1. **Folder duplication** when moving files via 1-9 or drag-drop → folders must dedupe by path; moves must not spawn duplicate folder entries.
2. **Ghost folders** after deletion → deleted folders disappear from state immediately, key mapping renumbers correctly.
3. **Trash restore never reached the UI** → restore must be fully functional end to end.
4. **Blurry previews** → HD pipeline, no blur regression.
5. **No fullscreen close button** → present and working.

---

## 5. UI / UX

- Clean, minimal, uncluttered. Remove all v1 header clutter, including the AI group button.
- **Light and Dark mode**, seamless toggle, follows OS preference on first launch.
- Left sidebar: source folders + key mapping + groups + trash. Resizable and collapsible, width persisted.
- Main area: virtualized thumbnail grid (only render visible items) with clear group boundaries and a focused-item highlight; grid/list toggle.
- Smooth at large scale — no jank on 5,000+ item grids.

### 5.1 Keyboard shortcuts (reviewed baseline)
| Action | Shortcut | Note |
|---|---|---|
| Toggle left sidebar | **Ctrl + B** | changed from v1's Ctrl+H |
| Move file to target folder | 1-9 | |
| Next / previous file | → / ← (or J / K) | |
| Fullscreen preview | F or Enter | |
| Exit fullscreen | Esc + visible close button | v1 bug fix |
| Play / pause video | Space | |
| Delete to trash | Del | |
| Undo / redo | Ctrl+Z / Ctrl+Y | |
| Open trash panel | T | |
| Batch rename | F2 | |
| Focus search | Ctrl+F | |
| Increase / decrease thumbnail | Ctrl+= / Ctrl+- | |
| Open settings | Ctrl+, | |
| Scan folder | Ctrl+O | |
| New folder | Ctrl+N | |
| Save project | Ctrl+S | |

The full set is to be reviewed once more during implementation for single-hand ergonomics; the table above is the committed baseline. **Ctrl+H is retired.**

---

## 6. Technical Notes

- **Frontend:** React + TypeScript + Vite, Tailwind, Zustand for state, TanStack Virtual (or react-window) for the grid.
- **Backend (Rust):** scanning, hashing, grouping, thumbnail generation, file moves, trash, project persistence. Heavy work off the UI thread; progress streamed via Tauri events.
- **Crates:** `image`, `image_hasher` (perceptual hashing — active fork, deps current as of Feb 2026), `kamadak-exif` or `nom-exif` (EXIF time), `trash` (cross-platform recycle bin), `rayon` (parallel hashing/thumbnails), `walkdir` (scan), `serde`/`serde_json` (settings + projects).
- **Video:** `ffmpeg` bundled as a Tauri sidecar for frame extraction; playback via WebView `<video>`.
- **Storage:** settings + projects + thumbnail cache under the OS app-data dir (mirrors v1's `%APPDATA%/PhotoSort/...` layout under the new name).
- **IPC security:** minimal Tauri capability set — only the filesystem scopes actually required.

---

## 7. Success Criteria

1. Scan a 5,000-file folder with no UI freeze; thumbnails stream in progressively.
2. Near-duplicate grouping is visibly accurate at the default threshold on a real messy folder.
3. Every thumbnail and preview is sharp (no v1 blur).
4. MP4 and MOV play inline without an external player.
5. Fullscreen has a working close button; Esc also exits.
6. Ctrl+B toggles the sidebar; keys 1-9 move files reliably; no folder duplication or ghost folders.
7. Zero AI/Gemini code, buttons, or settings remain anywhere.
8. Trash restore works end to end from the UI.
9. Batch rename, search/filter, project save/load, undo/redo all function.
10. Light/Dark toggle works with no visual breakage.
11. Release build packages to a signed Windows installer under ~15MB.

---

## 8. Explicitly Removed from v1

- AI grouping logic (all of it).
- "AI group" button in the header (and Ctrl+G).
- Gemini API key configuration in settings, including the text: *"Gemini API Key (Get Key →) Test 💡 Free API Available..."*.
- Blurry preview pipeline.
- Non-photo/video file support (audio, PSD, AI, PDF, code, archives).
- Any leftover header/toolbar clutter.
