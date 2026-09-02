# MediaSort v2 — Slice #6: Trash Panel (bug #3) — Design Spec

**Date:** 2026-09-02
**Status:** Draft for plan
**Grounded in:** `DESIGN.md` §2 (Rust owns FS truth; store owns view state; glue verified by running), §6.8 (Trash: "port v1 wholesale… the v2 delta is UI wiring, bug #3; TrashPanel is a first-class view, key `T`"), §5 command table line 171 (`trash_files/restore_from_trash/list_trash/empty_trash/trash_stats`), §7 bug #3 ("Trash restore never in UI → first-class TrashPanel (`T`); manual: delete→open trash→restore→file back; store test for flow"), §10 keymap ("Del trash · T trash panel"), §13.1 (app-data under `%APPDATA%/MediaSort`). Builds on #5b (move plumbing, `move_one` rename→copy+delete pattern) and #5d (selection precedence: act on the selection if non-empty else the focused file).

**Scoping note:** `src-tauri/src/trash.rs` **does not exist yet** — so this slice is *not* just UI wiring. It ports v1's `source/trash.go` to a new Rust `trash.rs` module **and** builds the frontend TrashPanel end-to-end. v1 trashed both files and folders; v2 target-folder deletion already lives in `folders.rs` (#5c, keeps the dir), so this slice is **files-only** trash.

---

## 1. Goal

Delete media files to an **app-managed trash** (`Del`), see them in a first-class **TrashPanel** (`T`), **restore** any item back to its original location (collision-suffixed), and **empty** the trash to the OS Recycle Bin. This closes v1 bug #3 ("trash restore was never reachable in the UI").

## 2. Brainstorm / decisions (defaulted to lean "option 1", documented)

- **Files-only (v1 folder-trash deferred).** The media-sorting flow deletes *files*; v2 target folders have their own delete (#5c). `TrashItem` drops v1's `type`/`fileCount`/`thumbnailUrl` fields. *(Folder-to-trash — YAGNI for this slice.)*
- **Restore ≠ Ctrl+Z.** `Del`→trash is undone by **Restore in the panel**, not by `Ctrl+Z`. Wiring trash into the command-pattern `undo_stack`/`redo_stack` is **slice 9** — keeping #5b's per-file `moveHistory`/`Ctrl+Z` path untouched.
- **`Del` obeys #5d precedence:** if the selection is non-empty, trash the whole selection; else trash the focused file. Reuses the exact selection→focus fallback shipped in #5d.
- **Restore lands the file back on disk, not back into the live grid.** The grid is a scan view; a restored file reappears on a future scan. Auto-reinsertion into the current grid is deferred (YAGNI; matches v1).
- **Thumbnails reuse the asset protocol.** The panel renders each item via the existing `ensure_thumbnail(trashPath)` (#3 machinery) — no base64 data-URIs (v1's `GetTrashThumbnail` is dropped).
- **Testability via pure helpers.** Every trash operation is a pure `*_in(trash_dir, …)` helper taking an explicit `trash_dir: &Path` (mirroring `folders.rs`' `upsert_target(list, …)`), so unit tests only ever touch a `tempdir`. `#[tauri::command]` wrappers resolve the **real** trash dir from Tauri's `app_data_dir()/trash` and call the helpers.
- **Empty → Recycle Bin is thin glue.** The pure `empty_in` hard-removes entries + resets metadata (fully unit-tested = v1's fallback path). The `empty_trash` **command** first best-effort sends each entry to the OS Recycle Bin via the `trash` crate, then calls `empty_in`. The recycle-bin hop is glue "verified by running," never unit-tested (a unit test must not touch the real Recycle Bin).

## 3. Scope

**In — backend (`src-tauri/`):**
- New `src/trash.rs`: `TrashState(Mutex<PathBuf>)` (the resolved trash dir), pure helpers, and 5 commands.
- `src/model.rs`: add `TrashItem` + `TrashStats` (serde `camelCase`).
- `src/lib.rs`: `mod trash;`, `.manage(trash::TrashState…)` in `setup` (dir = `app_data_dir()/trash`, created), register the 5 commands.
- `Cargo.toml`: add `trash = "5"` (or latest 5.x).

**In — frontend (`src/`):**
- `lib/commands.ts`: `trashFiles`, `restoreFromTrash`, `listTrash`, `emptyTrash`, `trashStats` wrappers; `lib/types.ts`: `TrashItem`, `TrashStats`.
- Store trash slice: `trashItems`, `trashOpen`, `openTrash`/`closeTrash`/`toggleTrash`, `setTrashItems`, `completeTrash(ids)`; `trashOpen`/`trashItems` reset on `reset` (kept across `startScan` — trash is session-independent, but cleared on `reset`).
- `components/TrashPanel.tsx`: overlay listing items (thumbnail, name, size, relative time), per-item **Restore**, **Empty Trash**, close (`Esc`/✕). Mounted in `App.tsx` beside `<Preview />`.
- `components/FileGrid.tsx`: `Del` trashes the selection-or-focused file(s) and removes them from the grid via `completeTrash`; `T` toggles the panel (works even with 0 files); grid keys inert while `trashOpen` (like the `previewId` guard).

**Out — deferred:** folder-to-trash; trash as a `Ctrl+Z`/redo-able Op (slice 9); auto-reinserting a restored file into the live grid; multi-select *inside* the panel / bulk-restore; trash persistence surfaced in the toolbar count.

## 4. Data model

**Rust (`model.rs`, `camelCase`):**
```rust
pub struct TrashItem {
    pub id: String,            // "trash_<unix_nanos>_<basename>" — also the on-disk entry name
    pub original_path: String, // where it came from (for Restore)
    pub trash_path: String,    // absolute path inside the trash dir
    pub name: String,          // display (basename)
    pub size: u64,
    pub deleted_at: i64,       // unix millis (matches FileInfo.modified_at convention)
}
pub struct TrashStats { pub count: u32, pub total_size: u64 }
```

**TS (`types.ts`):**
```ts
export interface TrashItem { id: string; originalPath: string; trashPath: string; name: string; size: number; deletedAt: number; }
export interface TrashStats { count: number; totalSize: number; }
```

**Metadata on disk:** `<trash_dir>/trash.json` = a JSON object mapping `id → TrashItem` (v1 parity). Missing/corrupt file ⇒ treated as `{}`.

## 5. Backend design (`trash.rs`)

Pure helpers (all `tempdir`-testable; `trash_dir: &Path`):
- `trash_files_in(trash_dir, paths: &[String]) -> Result<Vec<TrashItem>, String>` — for each existing file: `id = format!("trash_{nanos}_{basename}")`; move into `trash_dir/id` via **rename → (on error) copy+remove** (reuse the `fileops::move_one` cross-volume idiom, but the destination is an exact path, no collision-suffixing — the id is unique); build `TrashItem`; skip (don't fail) files that stat-fail or fail to move. Merge new items into `trash.json`. Return the created items.
- `list_trash_in(trash_dir) -> Result<Vec<TrashItem>, String>` — load metadata; read dir entries (skip `trash.json`); for each entry emit its metadata `TrashItem`, or a fallback item (empty `original_path`, size/mtime from the entry) when metadata is missing. Sort **newest-first** by `deleted_at`.
- `restore_in(trash_dir, id, dest_path) -> Result<String, String>` — require `trash_dir/id` to exist (else `Err("item not found in trash")`); if `dest_path` exists, suffix `_restored_N` (N=1,2,… on stem, before ext) until free; move back via rename → copy+remove; delete the id from metadata; return the final restore path.
- `empty_in(trash_dir) -> Result<(), String>` — remove every entry (files) under `trash_dir` except `trash.json`; overwrite `trash.json` with `{}`.
- `stats_in(trash_dir) -> Result<TrashStats, String>` — derive from `list_trash_in` (count + Σ size).

Metadata helpers: `metadata_path(trash_dir) -> PathBuf` (`trash_dir/trash.json`); `load_metadata(trash_dir) -> BTreeMap<String, TrashItem>` (missing/parse-fail ⇒ empty map); `save_metadata(trash_dir, &map) -> Result<(), String>` (pretty JSON).

Commands (thin; resolve dir from `TrashState`):
- `trash_files(state, paths) -> Vec<TrashItem>`
- `restore_from_trash(state, id, dest) -> ()` (returns unit; frontend re-lists)
- `list_trash(state) -> Vec<TrashItem>`
- `empty_trash(state) -> ()` — best-effort `trash::delete(entry)` per entry (Recycle Bin), then `empty_in`
- `trash_stats(state) -> TrashStats`

`TrashState(pub Mutex<PathBuf>)`; command reads `let dir = state.0.lock()?.clone();` then calls the helper. Dir is created in `lib.rs` `setup`.

## 6. Frontend design

**Store (`useAppStore`):**
- `trashOpen: boolean` (init `false`); `trashItems: TrashItem[]` (init `[]`).
- `openTrash()` / `closeTrash()` / `toggleTrash()` set `trashOpen`.
- `setTrashItems(items)` replaces `trashItems`.
- `completeTrash(ids: string[])` — remove all `ids` from `files` (mirrors `completeMoveMany`'s removal + lowest-index focus advance + `selectedIds: []`), **no** folder-count/`moveHistory` changes.
- `reset` also clears `trashOpen:false`, `trashItems:[]`. (`startScan` leaves trash untouched — trash spans scans.)

**`TrashPanel.tsx`** (rendered in `App.tsx`; visible only when `trashOpen`): a right-side overlay/drawer. On open, calls `listTrash()` → `setTrashItems`. Each row: thumbnail (`useThumbnail`-style via `ensureThumbnail(item.trashPath)`), `name`, humanized `size`, relative `deletedAt`, a **Restore** button (`restoreFromTrash(item.id, item.originalPath)` → re-`listTrash`). Footer: **Empty Trash** (`emptyTrash()` → re-`listTrash`) + item count; ✕ / `Esc` closes. Empty state: "Trash is empty."

**`FileGrid.tsx`** keyboard additions (same `onKey`):
- Guard: `if (trashOpen) { if (T or Esc) toggleTrash/closeTrash; return; }` — grid keys inert while the panel owns focus (parallels the `previewId` guard).
- `T` (no modifiers): `toggleTrash()` — placed **before** the `files.length===0` guard so it works on an empty grid.
- `Delete`→ trash (the `Del` key only; no `Backspace`): `sel = selectedIds.length ? files.filter(∈selectedIds) : [focused]`; `void trashFiles(sel.paths).then(() => completeTrash(sel.ids))`.
- Pass nothing new to `FileCard`.

**`commands.ts`:** `trashFiles(paths) → invoke("trash_files",{paths})`; `restoreFromTrash(id,dest) → invoke("restore_from_trash",{id,dest})`; `listTrash() → invoke("list_trash")`; `emptyTrash() → invoke("empty_trash")`; `trashStats() → invoke("trash_stats")`.

## 7. Behavior

Select {A,C} (or focus B) → `Del` → files leave the grid, land in the app trash; focus advances to the survivor at the lowest removed slot; selection clears. `T` → panel opens listing A, C (newest-first) with thumbnails. **Restore** A → A moves back to its original dir (suffixed `A_restored_1.jpg` if the original name is taken); the row disappears. **Empty Trash** → remaining items go to the OS Recycle Bin; panel shows empty. `T`/`Esc` closes the panel.

## 8. Security / capabilities

Trash dir is under Tauri's `app_data_dir()` (already asset-scoped for thumbnails). Restore writes back to a user path that was a scan source. No network. The `trash` crate uses the Windows Shell API via `windows-rs` bindings (no C toolchain beyond the MSVC already in use). No new capability entries beyond what `fs` move/delete already require.

## 9. Testing

**Rust (`trash.rs`, `tempdir` only):**
- `trash_files_in` moves a real temp file into `trash_dir/<id>`, source gone, item returned, `trash.json` contains the id.
- non-existent input path is skipped (no error, empty/partial result).
- `list_trash_in` returns stored items newest-first; ignores `trash.json`.
- `restore_in` moves the entry back to `dest`, removes it from metadata; when `dest` exists, restores to `<stem>_restored_1.<ext>`; unknown id ⇒ `Err`.
- `empty_in` removes all entries and resets `trash.json` to `{}`.
- `stats_in` returns count + summed size.
- **`model.rs`**: `TrashItem`/`TrashStats` serialize `camelCase` (`originalPath`, `trashPath`, `deletedAt`, `totalSize`).

**Vitest — store:** `completeTrash` removes the ids, advances focus to the lowest survivor, clears selection, leaves folders/`moveHistory` untouched; `toggleTrash`/`open`/`close` flip `trashOpen`; `setTrashItems` replaces; `reset` clears `trashOpen`+`trashItems`, `startScan` keeps them.

**Vitest — `TrashPanel.test.tsx` (new):** given `trashItems`, renders a row per item + count; clicking **Restore** calls `restoreFromTrash(id, originalPath)` then re-lists; **Empty Trash** calls `emptyTrash` then re-lists; empty state renders. (Mock `../lib/commands`.)

**Vitest — `FileGrid.test.tsx`:** `Del` with a selection calls `trashFiles` with all selected paths and removes them (count unaffected); `Del` with only a focus trashes the focused file; `T` toggles `trashOpen`; keys are inert while `trashOpen`. Existing move/undo/preview tests stay green.

**Manual acceptance (bug #3):** scan → select a few → `Del` → `T` → items listed with thumbnails → **Restore** one → file reappears on disk (suffixed on collision) → **Empty Trash** → items go to Recycle Bin → panel empty → `Esc` closes.

## 10. Deferred (explicitly not in this slice)
Folder-to-trash; trash as an undo/redo Op (slice 9); auto-reinsert of a restored file into the live grid; in-panel multi-select / bulk restore; toolbar trash-count badge; base64 trash thumbnails.
