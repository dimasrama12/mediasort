# MediaSort Features

MediaSort is a fast, keyboard-driven desktop app for sorting large dumps of photos and videos: scan a folder, cluster the near-duplicates, and file everything into target folders in one pass.

## Core Features

### 1. Similarity & Time Grouping
- **Visual similarity** — clusters near-duplicate images by perceptual hash (dHash by default, DCT-based pHash optional for more robustness to gamma/scale changes).
- **Time grouping** — clusters files shot close together, using EXIF `DateTimeOriginal` and falling back to file modified time.
- **Group by Date / Type** — quick client-side grouping by calendar day or file extension.
- Group counts stay live: moving, trashing, or restoring files updates every group's count immediately, in every grouping mode.

### 2. Fast, Sharp Previews
- Thumbnails are generated once and cached on disk (keyed by path + size + mtime), so a grid of thousands of files scrolls smoothly — no re-decoding on every scroll.
- Full-size preview with zoom and rotation (rotation is written back to the file itself, not just the view).
- HEIC/HEIF photos decode via Windows WIC — no external codec needed.
- Video files (MP4, MKV, MOV, AVI, WebM) play inline with standard transport controls.
- EXIF viewer shows a file's metadata inline; values are sanitized and length-capped.

### 3. One-Pass Sorting
- Map up to 9 target folders to number keys `1`–`9`; press a key to move the current selection instantly.
- Drag-and-drop and multi-select (`Ctrl`/`Shift` click, select-all) both work.
- Batch rename with a pattern + numbering, live preview before committing.
- Real-time search/filter across the current file list.
- Right-click context menu for rename, copy path, and other per-file actions.

### 4. Safety & Undo
- Deleting sends files to an in-app **trash** with full restore — nothing is silently lost.
- **Trash, restore, batch rename, and moves are all undoable** (`Ctrl+Z` / `Ctrl+Y`).
- **Permanent delete** is the one irreversible action, and the only one that asks for confirmation first.
- A **scratch-disk** folder (optional, set in Settings) is automatically emptied when the app closes.

### 5. Project Save / Load
- Save a sorting session — scanned files, folder/key mapping, groups, and settings — and resume it later.

### 6. Customization
- Every keyboard shortcut is rebindable in **Settings → Shortcuts**.
- Light / Dark / System theme.
- Adjustable thumbnail size and grid/list view.

### 7. Hardened by Design
- Every file-mutating command checks its target path against an allowlist of scanned/target folders.
- Strict Content-Security-Policy; settings and trash metadata are written atomically so a crash mid-write can't corrupt them.
- Every image decode path (including the HEIC/WIC fallback) enforces a pixel-count limit, so a malicious or corrupt file can't be used to exhaust memory.

## Keyboard Shortcuts (defaults — all rebindable)

| Action | Shortcut |
| :--- | :--- |
| **Scan / open folder** | `Ctrl + O` |
| **New target folder** | `Ctrl + N` |
| **Move to target folder** | `1` – `9` |
| **Move to trash** | `Delete` / `B` |
| **Delete permanently** | `Shift + Delete` |
| **Return files to library** | `` ` `` |
| **Batch rename** | `Shift + R` |
| **Select all** | `Ctrl + A` |
| **Toggle sidebar** | `Ctrl + H` |
| **Grid / list view** | `[` / `]` |
| **Open trash** | `T` |
| **Focus search** | `Ctrl + F` |
| **Refresh** | `Ctrl + R` / `F5` |
| **Undo / redo** | `Ctrl + Z` / `Ctrl + Y` |
| **Open settings** | `Ctrl + ,` |
| **Exit app** | `Alt + X` |
| **Rotate left / right (preview)** | `L` / `R` |
| **Zoom in / out / reset (preview)** | `+` / `-` / `0` |

---
*Built with Tauri v2, Rust, and React.*
