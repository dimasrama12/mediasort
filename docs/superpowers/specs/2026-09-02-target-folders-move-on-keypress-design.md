# MediaSort v2 — Slice #5b: Target Folders + Move-on-Keypress — Design Spec

**Date:** 2026-09-02
**Status:** Draft for plan
**Grounded in:** `DESIGN.md` §2.3 (Rust owns authoritative file-system truth; frontend owns view state), §4 (`FolderInfo` model), §5 (IPC: `move_files`, `create_folder`, `list_target_folders`), §6.1 (`normalize_path` — the dedup linchpin), §6.6 (`fileops.rs` move semantics), §6.7 (`folders.rs` create + key-mapping); `PRD-MediaSort-v2.md` §3.3 (map up to 9 folders to number keys; move focused file; visible legend), §5.1 (keys 1–9 move; Ctrl+Z undo), §4 v1 bug #1 (folder duplication). Builds directly on slice #5a (grid focus + keyboard nav) and back-fills roadmap step 5.

**Scoping note:** Roadmap slice 5 decomposes into **[#5a focus + keyboard nav ✓] → [#5b: this slice — target folders + move-on-keypress] → [#5c: folder rename/delete + multi-select + full undo/redo + trash]**. #5b is the first slice that *mutates the filesystem*: it introduces the target-folder subsystem and the move mechanic that is MediaSort's core one-pass-sorting value. It ships with a **minimal single-level undo** (Ctrl+Z) as a safety net; the full command-stack, rename/delete, and multi-select are #5c.

---

## 1. Goal

Map up to nine destination folders to number keys **1–9**; pressing a number **moves the focused file** into that folder and advances focus to the next file — the keyboard-driven sorting loop. Target folders are **created new under a base directory** (default: the scanned root) from a minimal left sidebar that also shows the live **key → folder legend**. A mis-pressed key is recoverable with **Ctrl+Z** (undo the last move).

## 2. Scope

**In:**
- `FolderInfo` model (Rust + TS mirror); **backend-authoritative** target-folder list + 1–9 mapping in Rust managed state.
- Backend `folders.rs` — `create_folder(base, name)` (creates the dir, **dedups by `normalize_path`**, assigns the lowest free 1–9 shortcut, registers it as a target) and `list_target_folders()`.
- Backend `fileops.rs` — `move_files(paths, dest)` (rename fast-path, cross-drive copy-then-delete fallback, `_N` collision suffix).
- Store `folders` slice: `folders`, `roots` (captured at scan), a move-undo stack, and sync reducers for move/undo.
- Minimal `Sidebar.tsx`: base path, **New folder** (inline name input), and the **1–9 legend** (`① Family (12)`).
- Keyboard (extend #5a's Preview-guarded handler in `FileGrid`): **`1`–`9`** move the focused file; **`Ctrl+Z`** undoes the last move. Inert while the Preview is open.
- Focus advances to the next file after a move (the moved file leaves the grid); Ctrl+Z re-inserts it and refocuses.

**Out — deferred to #5c / later slices:**
- Folder **rename** and **delete** (+ 1–9 renumber; v1 bug #2 "ghost folders").
- **Multi-select** moves (move the current selection, not just the focused file).
- **Redo** (`Ctrl+Y`) and the full command-pattern `undo_stack`/`redo_stack` (slice 9 / #5c).
- **Persistence** of target folders across app restarts (projects/settings — slice 10).
- Resizable / collapsible sidebar, folder colors, "change base directory" UI.

## 3. Success criteria

1. From the sidebar, "New folder" creates a subfolder under the base (default = scanned root) and it appears in the legend mapped to the next free 1–9 key; re-creating the same path **reuses** the existing target (no duplicate entry — v1 bug #1 guard).
2. With the Preview closed and a file focused, pressing a **mapped** number moves the focused file into that folder on disk; the file leaves the grid, focus advances to the next file, and the folder's count increments. An **unmapped** number is a no-op.
3. **Ctrl+Z** moves the last-moved file back to its original folder, re-inserts it at its original grid position, and refocuses it.
4. Number keys and Ctrl+Z are **inert while the Preview is open** (Preview keeps its ←/→/Esc).
5. A failed move (e.g. locked file) surfaces a non-blocking error, leaves the file in the grid, and does not advance focus or push undo.
6. Suites green: `cargo test` (folders dedup + shortcut assignment, fileops move + collision) and Vitest (store move/undo reducers, keyboard wiring, sidebar legend).

## 4. Architecture decision — backend-authoritative folders

Rust `folders.rs` holds the target-folder list + 1–9 mapping in managed state (`Mutex<Vec<FolderInfo>>`); the frontend mirrors it into a Zustand `folders` slice by consuming command returns. This matches DESIGN §2.3 ("Rust owns the authoritative file-system truth") and §6.7 ("target-key mapping lives here"), and keeps creation/dedup/move next to the filesystem. State is **session-only** for #5b (persistence is slice 10). *(Rejected alternative: Zustand owns the map and Rust only does raw fs ops — less code now, but diverges from the design and needs reconciling when projects/undo land.)*

## 5. Data model

**Rust `model.rs`** (serde `camelCase`, matching the existing `FileInfo`):
```rust
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub id: String,        // = normalize_path(path) — stable, unique, the dedup key
    pub name: String,      // leaf folder name (display)
    pub path: String,      // absolute path (as created)
    pub shortcut: u8,      // 1..=9
    pub file_count: u32,   // running count of files moved in this session
}
```
*(Drop v1/`DESIGN §4`'s `color`/`total_size` for #5b — YAGNI; add later with the polished sidebar.)*

**TS `src/lib/types.ts`:**
```ts
export interface FolderInfo {
  id: string;
  name: string;
  path: string;
  shortcut: number; // 1..9
  fileCount: number;
}
```

**Store additions (`useAppStore`):**
- `folders: FolderInfo[]`
- `roots: string[]` — the picked scan dirs (today discarded in `Toolbar.onScan`); `roots[0]` is the default base for new folders.
- `moveHistory: MoveRecord[]` where `MoveRecord = { file: FileInfo; fromDir: string; toPath: string; fromIndex: number }`.
- Lifecycle: a new `setRoots(roots)` action (called from `Toolbar.onScan` **before** `startScan`) records the scan dirs. `startScan` additionally clears `folders` and `moveHistory` (alongside its existing `files`/`focusedId`/`previewId` clears) but leaves `roots` intact; `reset` clears `folders`, `moveHistory`, and `roots` too.

## 6. Backend

### 6.1 `folders.rs` (new)
- Managed `FolderState(Mutex<Vec<FolderInfo>>)`, registered in `lib.rs` `.manage(...)`.
- `create_folder(base: String, name: String) -> Result<FolderInfo, String>`: join `base`/`name`, `create_dir_all`, compute `id = normalize_path(path)`. If a target with that `id` already exists, **return it unchanged** (dedup — bug #1). Else assign `shortcut` = lowest integer in 1..=9 not already used; if all nine are taken, `Err("all 9 target slots are in use")`. Push and return.
- `list_target_folders() -> Vec<FolderInfo>`.
- `normalize_path` (from `paths.rs`) is the identity/dedup key — the reason a repeat create can't spawn a duplicate.

### 6.2 `fileops.rs` (new)
- `move_files(paths: Vec<String>, dest: String) -> Result<Vec<String>, String>`: for each source, target = `dest`/`file_name`; on collision append `_N` before extension; `std::fs::rename` fast-path, and on cross-device error fall back to copy-then-`remove_file`. Return the actual new absolute paths (order-matched). #5b always calls it with a single path; the `Vec` signature is forward-compatible with #5c multi-select and matches DESIGN §5.
- Pure `std::fs` — **not gated by Tauri capabilities**, so no new fs permission is required (see §10).

### 6.3 `lib.rs` wiring
- `mod folders; mod fileops;`
- `.manage(folders::FolderState::default())`
- Add to `generate_handler!`: `folders::create_folder`, `folders::list_target_folders`, `fileops::move_files`.

## 7. Frontend

### 7.1 `src/lib/commands.ts`
Typed wrappers: `createFolder(base, name) -> FolderInfo`, `listTargetFolders() -> FolderInfo[]`, `moveFiles(paths, dest) -> string[]`.

### 7.2 Store `folders` slice + reducers
Keep the store synchronous and unit-testable (mirroring #5a); the async `invoke` orchestration lives in the sidebar handler / keyboard effect, which then calls a sync reducer:
- `setRoots(roots)`, `setFolders(folders)` / `upsertFolder(f)`.
- `completeMove(index, folderId, toPath)`: capture `file = files[index]`; remove it from `files`; **advance focus** to the file now at `index` (clamp to new last; clear if empty); increment that folder's `fileCount`; push `{ file, fromDir: dirname(file.path), toPath, fromIndex: index }` to `moveHistory`.
- `completeUndo(backPath)`: pop `moveHistory`; re-insert `record.file` (with `path` reset to `backPath`) at `min(fromIndex, files.length)`; set focus to it; decrement the folder's `fileCount`.

### 7.3 `Sidebar.tsx` (new, minimal)
Fixed-width (`w-56`) left column in the app's dark theme: base path (small, from `roots[0]`), a **New folder** button that reveals an inline text input (Enter = create via `createFolder(base, name)` → `upsertFolder`), and the **legend** — one row per folder sorted by shortcut: `<kbd>N</kbd> name (count)`. New-folder control disabled once nine exist. *Not* resizable/collapsible (later).

### 7.4 App layout
`App` becomes `Toolbar` / `<div class="flex flex-1"> <Sidebar/> <FileGrid/> </div>` / `Preview`. Capture `roots` in `Toolbar.onScan` (`setRoots(dirs)` before `startScan()`).

### 7.5 Keyboard (extend #5a handler in `FileGrid`)
Within the existing window `keydown` effect (already returns early when `previewId != null`):
- a **bare** `e.key` in `"1".."9"` (no `ctrlKey`/`altKey`/`metaKey`, so `Ctrl+1` etc. don't fire) → find the folder with that `shortcut`; if none, no-op; else `moveFiles([focusedPath], folder.path)` then `completeMove(index, folder.id, newPaths[0])`; `preventDefault`.
- `Ctrl+Z` (`e.ctrlKey && e.key === "z"`) → if `moveHistory` non-empty, take the top, `moveFiles([top.toPath], top.fromDir)` then `completeUndo(newPaths[0])`; `preventDefault`.
- Async errors are caught; on failure nothing mutates (file stays, focus unchanged, no undo push).

## 8. UX flows

**Create target:** New folder → type "Family" → Enter → `create_folder(root, "Family")` → row `① Family (0)` appears. Second "Family" → same `id` → dedup, no new row.

**Move:** focus a file, press `1` → file moves into Family, leaves the grid, focus jumps to the next file, legend shows `① Family (1)`. This repeats at speed — the one-pass loop.

**Undo:** press `Ctrl+Z` → the file returns to its source folder, reappears at its old grid slot with focus, `① Family (0)`.

## 9. Error handling
- **Move failure** (permission/lock/cross-device error surfaced as `Err`): non-blocking inline message in the sidebar/toolbar; file stays in the grid; focus unchanged; no undo push.
- **create_folder** on an existing path: reuse (dedup), not an error. Invalid/empty name: `Err`, shown inline. Nine slots full: New-folder disabled + `Err` guard server-side.
- **Undo collision** (original slot now occupied): `_N` suffix from `move_files` handles it; the file returns under a suffixed name (rare, acceptable).

## 10. Security / capabilities
File moves and folder creation run in Rust `std::fs`, which Tauri capabilities do **not** gate — so **#5b adds no new webview fs permission**. Destination folders are created under the scanned root, which slice #4 already grants recursive asset scope for (`scan.rs`: `asset_protocol_scope().allow_directory(root, true)`), so moved files keep thumbnailing/previewing. *(If a future "change base" places targets outside every scanned root, grant asset scope for that base via the same call — noted for #5c, not built now.)*

## 11. Testing

**Rust (`cargo test`, `tempfile` dirs):**
- `folders`: `create_folder` creates + returns shortcut 1; a second create of the same normalized path returns the **same** entry (no duplicate, same shortcut) — bug #1; distinct folders get 1, 2, 3…; the tenth errors.
- `fileops`: `move_files` moves a file into dest and returns its new path; a name collision yields a `_N`-suffixed path; the source no longer exists.
- `paths`: (existing) `normalize_path` already unit-tested; folders relies on it.

**Vitest:**
- Store reducers: `completeMove` removes the file, advances focus, bumps count, pushes history; `completeUndo` re-inserts at `fromIndex`, refocuses, decrements; `startScan` clears folders/history and sets roots.
- Keyboard (`FileGrid`, `moveFiles`/`createFolder` mocked): a mapped digit moves the focused file (asserts `moveFiles` called with `[path], folderPath` and the store updated); an unmapped digit is a no-op; `Ctrl+Z` undoes; both inert while `previewId` is set.
- `Sidebar`: renders the legend from `folders`; "New folder" calls `createFolder`; the control disables at nine folders.

**Manual (run the app), #5b acceptance:** scan → sidebar shows base; New folder ×3 → keys 1–3 legend; focus a file, press 1 → it moves, focus advances, count ticks; Ctrl+Z → it returns; open the Preview → 1–9/Ctrl+Z stay quiet; close → they resume.

## 12. Risks / open items
- **jsdom one-column** (from #5a) is irrelevant here — move/undo tests are index-based, not layout-based.
- **Cross-drive move** copy-then-delete is hard to unit-test on one volume; the rename + `_N`-collision paths are unit-tested, the cross-device branch is covered by the manual run and code review.
- **Focus-after-move edge cases** (moving the last file; emptying the grid) are covered explicitly in `completeMove` reducer tests.
- **`serde(rename_all="camelCase")`** must be confirmed on the existing `FileInfo` so `FolderInfo` matches the TS mirror (verify in `model.rs` at implementation).

## 13. Deferred (explicitly not in this slice)
Folder rename/delete + 1–9 renumber (bug #2), multi-select moves, redo + full undo/redo command stacks, target-folder persistence, resizable/collapsible sidebar, folder colors, "change base directory" UI.
