# MediaSort v2 — Architecture & Design

**Companion to:** [`PRD-MediaSort-v2.md`](../PRD-MediaSort-v2.md) (the product spec)
**This doc:** the technical architecture the PRD doesn't prescribe — module layout, data model, IPC surface, the thumbnail/preview delivery strategy, and the root-cause fix for every v1 bug.
**Stack:** Tauri v2 · Rust · React 18 + TypeScript + Vite · Tailwind · Zustand · TanStack Virtual
**Status:** Draft for build (2026-08-31)

---

## 1. Guiding principles

1. **Vertical slices.** Every slice leaves the app runnable and demoable. We never have a "big bang" integration step.
2. **TDD where logic lives.** Pure Rust logic (dedup, hashing, grouping, rename, cache keys, path normalization) is unit-tested with `cargo test`. Store logic is tested with Vitest. UI glue is verified by running the app.
3. **Heavy work off the UI thread.** Scanning, hashing, and thumbnailing run on Rust threads (`rayon`/`tauri::async_runtime`); progress streams to the UI via Tauri events. The WebView never blocks.
4. **No AI. Anywhere.** No Gemini, no `ProcessAICommand`, no API-key settings, no "AI group" button. Grouping is pHash + temporal only.
5. **Fix v1 bugs as requirements** (§7), each with an acceptance test.

---

## 2. Why the big technical decisions went the way they did

### 2.1 Thumbnail & preview delivery: **asset protocol, not base64-over-IPC**

v1 read each image, base64-encoded it, and returned a `data:` URI through the Wails IPC bridge (`app.go` `GetThumbnail`/`GetFilePreview`). At 5,000+ items this serializes hundreds of MB through the IPC channel and forces the WebView to decode giant data URIs — the direct cause of jank and, combined with a fixed 200×200 thumbnail upscaled by CSS, the **blurry previews**.

**v2:** Rust generates thumbnails to an on-disk cache, and the frontend loads them by **URL via Tauri's asset protocol** (`convertFileSrc(path)`), letting the WebView fetch, decode, and cache images natively — no IPC payload, no base64. Full-size previews decode the **original** file (served directly through the asset protocol when the format is browser-native), so previews are pixel-exact.

| | v1 | v2 |
|---|---|---|
| Thumb transport | base64 data URI over IPC | `asset://` URL (no IPC bytes) |
| Thumb size | fixed 200×200, CSS-upscaled | tiered (see §6.3), crisp at grid size |
| Preview | re-encoded, capped 1920×1080 | original decoded at full res |
| Cache key | `md5(path)` — stale on edit | `hash(path + mtime + size)` |
| Cache lifetime | wiped on exit | persists across sessions |

### 2.2 Video: **runtime-detected ffmpeg, not a bundled sidecar**

The PRD (§3.4) suggests a bundled ffmpeg sidecar, but success criterion #11 caps the installer at **~15 MB** — bundling ffmpeg (~30–70 MB) breaks that. Resolution:

- **Playback:** always works with zero dependencies — WebView2 plays MP4/WebM/MOV via a `<video>` element pointed at the original file through the asset protocol.
- **Thumbnails:** if `ffmpeg` is found on `PATH` at runtime, extract a representative frame and cache it like an image thumbnail; otherwise show a **film-strip placeholder** with the file's extension. Detection is cached per session.
- This keeps the installer small and the app fully functional without ffmpeg. *(Open question for the user: acceptable to leave video thumbnails as placeholder-until-ffmpeg? Default = yes.)*

### 2.3 State: **Zustand slices (UI) + `State<Mutex<AppState>>` (Rust)**

Frontend owns view state (selection, focus, filter, theme, sidebar width) in Zustand slices. Rust owns the authoritative file-system truth and the undo/redo stacks behind a `Mutex`, mirroring v1's `App` struct but thread-safe. The two synchronize through commands + events, never by duplicating the source of truth.

---

## 3. Project structure

```
photosort/
├─ PRD-MediaSort-v2.md          # product spec
├─ docs/
│  ├─ DESIGN.md                 # this file
│  └─ superpowers/plans/        # implementation plans (one per phase)
├─ source/                      # v1 Go/Wails — REFERENCE ONLY, never built
├─ src/                         # React frontend
│  ├─ main.tsx  App.tsx
│  ├─ components/               # Grid, FileCard, Sidebar, Fullscreen, TrashPanel, ...
│  ├─ store/                    # Zustand slices (files, folders, selection, ui, trash)
│  ├─ lib/                      # tauri command wrappers, asset-url helpers, types
│  └─ styles/
├─ src-tauri/
│  ├─ Cargo.toml  tauri.conf.json  build.rs
│  ├─ capabilities/             # scoped permissions (fs, asset protocol)
│  └─ src/
│     ├─ main.rs  lib.rs        # app setup, command registration, managed state
│     ├─ model.rs               # FileInfo, FolderInfo, FileGroup, Operation, ...
│     ├─ scan.rs                # recursive scan, streamed via events
│     ├─ thumbnail.rs           # generation + disk cache (path+mtime+size key)
│     ├─ preview.rs             # full-res preview / original passthrough
│     ├─ grouping.rs            # pHash (image_hasher) + temporal
│     ├─ fileops.rs             # move/copy/dedup/batch-rename
│     ├─ folders.rs             # create/rename/delete + path-normalized dedup
│     ├─ trash.rs               # app trash + restore + empty→OS recycle bin
│     ├─ history.rs             # undo/redo command stacks
│     ├─ project.rs             # save/load/import/export sessions
│     ├─ settings.rs            # load/save AppSettings
│     └─ paths.rs               # normalize_path, app-data dirs, cache dirs
```

**Module boundary rule:** files that change together live together, split by responsibility (scan vs. thumbnail vs. trash), not by layer. Each Rust module owns one subsystem and exposes a small set of `#[tauri::command]`s plus pure, unit-testable helpers.

---

## 4. Data model

Ported from v1 (`app.go`) and trimmed to photos+video. Rust structs derive `Serialize/Deserialize/Clone`; TS mirror lives in `src/lib/types.ts`.

```rust
// model.rs
pub struct FileInfo {
    pub id: String,          // = normalized absolute path (stable, unique)
    pub path: String,
    pub name: String,
    pub extension: String,   // lowercased, includes dot
    pub size: u64,
    pub modified_at: i64,    // unix secs (fs mtime)
    pub date_taken: Option<i64>, // EXIF DateTimeOriginal, else None
    pub file_type: FileType, // Image | Video
    pub group_id: Option<String>,
}

pub struct FolderInfo {
    pub id: String,          // = normalized absolute path  (FIX: was timestamp-based in v1)
    pub name: String,
    pub path: String,
    pub shortcut: Option<u8>,// 1..=9 target-key mapping
    pub color: Option<String>,
    pub file_count: u32,
    pub total_size: u64,
}

pub enum GroupType { Visual, Temporal }
pub struct FileGroup {
    pub id: String,
    pub name: String,
    pub file_ids: Vec<String>,   // reference by id, not embedded copies
    pub similarity: f32,         // 0..100 (visual only)
    pub time_span: Option<String>,
    pub group_type: GroupType,
}

pub struct Operation {           // undo/redo command record
    pub kind: OpKind,            // Move | Trash | CreateFolder | RenameFolder
    pub timestamp: i64,
    pub payload: OpPayload,      // source_paths, destination_path, folder_path, old/new name, trash_items
}

pub struct TrashItem {
    pub id: String, pub original_path: String, pub trash_path: String,
    pub name: String, pub kind: String /*file|folder*/, pub size: u64,
    pub file_count: u32, pub deleted_at: i64,
}

pub struct AppSettings {
    pub similarity_threshold: u8, // default 80
    pub time_window_hours: f64,   // default 1.0
    pub min_group_size: u8,       // default 2
    pub theme: Theme,             // Light | Dark | System (default System)
    pub default_view: String,     // grid | list
    pub thumbnail_size: u16,      // default 200 (display px)
    pub sidebar_width: u16, pub sidebar_collapsed: bool,
    pub cache_path: Option<String>,
    // REMOVED vs v1: gemini_api_key, show_audio/documents/code/archives, auto_cleanup_thumbnails
}
```

**Deliberate changes from v1:**
- `FolderInfo.id` and `FileGroup.file_ids` reference by **normalized path**, not timestamped/embedded — kills bug #1 and shrinks project files.
- Dropped every non-photo/video filter flag and all Gemini fields.
- `theme` gains `System` (PRD §5: follow OS on first launch).
- Cache is **not** auto-wiped (removed `AutoCleanupThumbnails`).

---

## 5. IPC surface (Tauri commands)

Grouped by module; all are `async` and return `Result<T, String>`. Long-running ones emit events instead of blocking.

| Module | Commands | Events emitted |
|---|---|---|
| scan | `scan_folders(paths) -> ScanHandle`, `cancel_scan(id)` | `scan://progress`, `scan://file`, `scan://done` |
| thumbnail | `ensure_thumbnail(path) -> String(url)`, `clear_thumbnail_cache()` | `thumb://ready {path,url}` |
| preview | `get_preview_url(path) -> String` | — |
| grouping | `group_visual(ids, threshold)`, `group_temporal(ids, hours)` | `group://progress` |
| fileops | `move_files(paths, dest)`, `copy_files(paths, dest)`, `batch_rename(paths, pattern, start, pad)` | — |
| folders | `create_folder(base,name)`, `rename_folder(path,newName)`, `delete_folder(path)`, `list_target_folders()` | — |
| trash | `trash_files(paths)`, `restore_from_trash(id,dest)`, `list_trash()`, `empty_trash()`, `trash_stats()` | — |
| history | `undo()`, `redo()`, `can_undo()`, `can_redo()` | `history://changed` |
| project | `save_project(...)`, `load_project(id)`, `list_projects()`, `delete_project(id)`, `export_project(id)`, `import_project()` | — |
| settings | `get_settings()`, `save_settings(s)`, `reset_settings()` | — |

The frontend never calls these raw — `src/lib/commands.ts` wraps each with typed args/returns so components stay decoupled from `invoke`.

---

## 6. Backend subsystems

### 6.1 Path normalization (`paths.rs`) — the linchpin
`normalize_path(p)` → absolute, cleaned, canonical-cased key (on Windows: lowercased drive + separators normalized to `\`). **Every** folder identity, dedup check, and cache key flows through it. This single function is why bugs #1 and #2 can't recur. Unit-tested first, before anything depends on it.

### 6.2 Scan (`scan.rs`)
`walkdir` recursion filtered to the supported set — **photos:** jpg, jpeg, png, gif, webp, bmp, tiff, heic/heif, svg; **video:** mp4, mkv, mov, avi, webm. Runs on a background task; emits `scan://file` batches (say 100 at a time) and `scan://progress {done,total}`. A cancellation token (`AtomicBool` in managed state) makes `cancel_scan` immediate. EXIF `DateTimeOriginal` via `kamadak-exif`, fallback to fs mtime.

### 6.3 Thumbnails (`thumbnail.rs`)
`image` crate, **Lanczos3**, cache under `{app_data}/MediaSort/thumbnails/`. HEIC/HEIF are decoded via `libheif` first, SVG is rasterized to the target size via `resvg`, then all formats go through the same Lanczos3 → cache path. Cache key = `blake3(normalized_path + mtime + size)` → filename `{key}.jpg`. Generate at a base size that stays sharp when the grid is enlarged (tier to **256 / 512** by requested display size). Parallelized with `rayon`; results served as asset URLs. Persist across runs; validity is implicit in the key (mtime/size change ⇒ new key).

### 6.4 Preview (`preview.rs`)
Browser-native formats (jpg/jpeg/png/gif/webp/bmp) → return the **original** file's asset URL (zero re-encode, perfectly sharp — fixes bug #4). TIFF / HEIC / oversized images → decode once (HEIC via `libheif`), downscale-to-fit, cache, serve. SVG → rasterize with `resvg` at display resolution (stays crisp — it's vector). Never upscale raster originals.

### 6.5 Grouping (`grouping.rs`)
`image_hasher` (dHash default, pHash option), 64-bit hashes, Hamming distance; `similarity = 100 - distance*100/64` (matches v1's scale). **Visual:** greedy cluster where `similarity >= threshold`. **Temporal:** sort by `date_taken` (fallback mtime), split when gap `> time_window_hours`. Two explicit modes surfaced in the sidebar with type + similarity indicators. Hashing runs in parallel with progress events. *(v1's hierarchical "AIGroupFiles" auto-merge is dropped — it was the confusing "single blob" behavior.)*

### 6.6 File ops (`fileops.rs`)
Move = `rename` fast-path, fall back to copy-then-delete across drives (from v1 `folder.go`). Name collisions get `_N` suffix. Batch rename supports the PRD's `{n}` pattern + start number + zero-pad (v1 only did `Base (i)` — v2 generalizes). Every mutating op records an `Operation` for undo.

### 6.7 Folders (`folders.rs`)
Create/rename/delete + **dedup by `normalize_path`**. Deleting removes the entry from state immediately and renumbers 1–9 shortcuts (fixes bug #2, "ghost folders"). Target-key mapping (1–9) lives here.

### 6.8 Trash (`trash.rs`)
Port v1 wholesale (it worked): app-managed trash dir with `trash.json` metadata, cross-drive copy-then-delete, restore-with-collision-suffix, `empty_trash` → OS recycle bin via the `trash` crate. **The v2 delta is UI wiring** (bug #3): the TrashPanel is a first-class, always-reachable view (key `T`).

### 6.9 History (`history.rs`)
Command-pattern `undo_stack`/`redo_stack` (v1 `operations.go`). Reversible: Move, Trash, CreateFolder, RenameFolder. Hard delete is not offered as an undoable op (delete routes to trash first). Emits `history://changed` so toolbar enable/disable stays in sync.

### 6.10 Projects & settings (`project.rs`, `settings.rs`)
JSON under `{app_data}/MediaSort/{projects,settings.json}`. Save/load/list/delete/import/export sessions (files, folders+key map, groups, settings). App-data dir via `dirs`/Tauri path API (replaces v1's hard-coded `%APPDATA%/PhotoSort`).

---

## 7. v1 bug → root cause → v2 fix → acceptance test

| # | Bug | Root cause found in v1 | v2 fix | Acceptance test |
|---|---|---|---|---|
| 1 | Folder duplication on move | `generateFolderID` = `timestamp+hash` ⇒ same folder ≠ same id | identity = `normalize_path` | `cargo test` add same path twice ⇒ one entry; move to folder ⇒ no new entry |
| 2 | Ghost folders after delete | state kept stale entry; shortcuts not renumbered | delete purges by path, renumber 1–9 | delete folder ⇒ gone from state + keys re-mapped (store test) |
| 3 | Trash restore never in UI | backend fine, no UI wiring | first-class TrashPanel (`T`) | manual: delete→open trash→restore→file back; store test for flow |
| 4 | Blurry previews | base64 IPC + 200px upscaled + re-encoded preview | asset protocol + original-at-full-res + tiered thumbs | manual: preview matches original pixels; thumbs crisp when enlarged |
| 5 | No fullscreen close | missing control | always-visible ✕ + Esc | manual: ✕ closes, Esc closes |

---

## 8. Testing strategy

- **Rust (`cargo test`)** — pure logic: `normalize_path`, folder dedup, collision suffixing, batch-rename patterns, cache-key stability, Hamming/similarity math, temporal split boundaries, undo/redo reversibility. Filesystem ops tested in `tempfile` dirs.
- **Vitest** — Zustand slices: selection math, folder add/dedup/delete + shortcut renumber, trash flow, filter/search results count.
- **Manual (run the app)** — anything visual: thumbnail sharpness, fullscreen close, video playback, drag/keys, light/dark.

Each vertical slice ships with its tests; a slice isn't "done" until its tests pass and (if visual) it's been run.

---

## 9. Security / capabilities

Minimal Tauri v2 capability set (PRD §6): the `asset` protocol scoped to (a) the thumbnail/preview **cache dir** (static) and (b) **source folders** granted at runtime as the user selects them; `fs`/`dialog` scoped to what scan/move/trash require. No network permission at all (there is no network feature left).

---

## 10. Build & packaging

- **Dev toolchain: GNU** (`stable-x86_64-pc-windows-gnu`; MinGW already present). MSVC was the intended path, but its Build Tools need ~6–8 GB and C: has only ~3.5 GB free, so development builds use GNU. Two accommodations make GNU work: (1) `.cargo/config.toml` redirects `target-dir` to the space-free `D:/mediasort-target` (MinGW's `dlltool`/`as` choke on the space in `D:\vibe coding\photosort`); (2) the lib is `crate-type = ["rlib"]` only — the mobile-only `cdylib`/`staticlib` trip MinGW's "export ordinal too large". Verified: `cargo build` produces `mediasort.exe`.
- **Release & signing:** a signed installer (criterion #11) needs `signtool` from the Windows SDK (i.e. MSVC). Deferred to the packaging slice — by then we either free C: for MSVC or sign another way. Features/playback are toolchain-independent.
- Bundler: NSIS (small) and/or WiX MSI; target **signed installer ~≤15 MB** (criterion #11). No bundled ffmpeg (§2.2).
- Product name **MediaSort**; app-data namespace `MediaSort` (v1 used `PhotoSort`).

---

## 11. Keyboard shortcuts

Committed baseline from PRD §5.1 (note **Ctrl+B** toggles sidebar; **Ctrl+H retired**): 1–9 move to target · →/← or J/K navigate · F/Enter fullscreen · Esc + ✕ exit · Space play/pause · Del trash · Ctrl+Z/Ctrl+Y undo/redo · T trash panel · F2 rename · Ctrl+F search · Ctrl+=/Ctrl+- thumb size · Ctrl+, settings · Ctrl+O scan · Ctrl+N new folder · Ctrl+S save project.

---

## 12. Implementation roadmap (vertical slices)

Each row is a runnable milestone and will get its own detailed plan under `docs/superpowers/plans/`.

1. **Foundation** — scaffold (Tauri v2 + React/Vite/TS + Tailwind + Zustand), MSVC override, `cargo test`/Vitest wired, blank window runs.
2. **Scan + virtualized grid** — pick folder, stream scan, TanStack Virtual grid of names/placeholders. (`paths.rs` + tests first.)
3. **Thumbnails via asset protocol** — sharp cached thumbs; the bug-#4 win. Opens with the HEIC-build spike; integrates `libheif` (HEIC) + `resvg` (SVG) decoders.
4. **Selection + fullscreen + preview + video playback** — multi-select, fullscreen with working ✕/Esc (bug #5), inline `<video>`.
5. **Target folders + keys 1–9** — create/rename/delete, path-dedup, move on keypress (bugs #1/#2).
6. **Trash panel** — wire the ported backend end-to-end (bug #3).
7. **Grouping** — pHash visual + temporal, sidebar indicators.
8. **Batch rename + search/filter.**
9. **Undo/redo** — command stacks + toolbar state.
10. **Projects + settings + light/dark.**
11. **Packaging** — signed installer ≤15 MB, rename polish.

---

## 13. Resolved scope decisions (2026-08-31)

*(These supersede PRD §2 where they differ.)*

1. **Product name:** **MediaSort** — identifier `com.dimasrama.mediasort`, app-data under `%APPDATA%/MediaSort`.
2. **Video thumbnails:** **runtime-detected ffmpeg** (film-strip placeholder when absent) so the installer stays ≤15 MB. Playback always works via WebView2.
3. **HEIC/SVG:** **included.** SVG via `resvg` (pure Rust, straightforward). HEIC via `libheif` — a native C dependency that is fiddly on Windows/MSVC, so slice 3 opens with a short **spike** to lock the HEIC build approach (vcpkg-provided libheif vs. a prebuilt binary) before committing. If the spike shows HEIC threatens the ≤15 MB or build-stability goals, we revisit with the user rather than silently dropping it.
