# MediaSort v2 — Slice #5c: Folder Rename + Delete (shortcut renumber) — Design Spec

**Date:** 2026-09-02
**Status:** Implemented (green)
**Grounded in:** `DESIGN.md` §2.3 (Rust owns authoritative file-system truth), §6.7 (`folders.rs` — "Deleting removes the entry from state immediately and renumbers 1–9 shortcuts (fixes bug #2, 'ghost folders')"), §5 IPC table (`rename_folder`, `delete_folder`), §6.1 (`normalize_path` as the dedup/identity key); `PRD-MediaSort-v2.md` §4 v1 bug #2 ("ghost folders" — deleted targets left gaps / stale shortcuts). Builds directly on slice #5b (target folders + move-on-keypress) and completes roadmap slice 5.

**Scoping note:** Slice 5 decomposes into **[#5a focus + keyboard nav ✓] → [#5b target folders + move-on-keypress + single undo ✓] → [#5c: this slice — folder rename + delete + 1–9 renumber]**. With #5c the target-folder subsystem is feature-complete for the roadmap: create (5b), list (5b), rename, delete. Multi-select moves and the Trash panel are the following slices.

---

## 1. Goal

Let the user **rename** and **delete** target folders from the sidebar. Deleting must **renumber the remaining 1–9 shortcuts to a contiguous `1..=N`** so there are never gaps or stale key mappings — the direct fix for v1 bug #2 ("ghost folders", where a removed folder left a dead number key and orphaned legend row).

## 2. Scope

**In:**
- Backend `folders.rs` — `rename_in(list, id, new_name)` (moves the directory on disk, keeps the shortcut, recomputes `id` from the new path, guards empty name + collision) and `delete_in(list, id)` (removes the entry, renumbers shortcuts contiguous). Both are pure functions over `&mut Vec<FolderInfo>`, unit-tested in `tempfile` dirs.
- IPC commands `rename_folder(id, name)` and `delete_folder(id)`, each returning the **updated full list** (`Vec<FolderInfo>`) so the frontend re-syncs in one shot.
- TS wrappers `renameFolder(id, name)` / `deleteFolder(id)`; sidebar wiring via the store's existing `setFolders`.
- `Sidebar.tsx` — **double-click a folder name** to rename it inline (Enter commits, Escape/blur cancels); a small **× button** deletes it. Errors surface inline (reusing #5b's `error` slot).

**Out — deferred:**
- **File** rename / batch rename + the `F2` shortcut → slice 8 (`Batch rename + search/filter`). #5c is *folder* rename only.
- Deleting the folder's **contents** — delete here only *unregisters the target and renumbers*; the on-disk directory is left intact (a folder full of already-sorted files must not vanish). Moving a target's files to Trash is out of scope.
- Undo of rename/delete via the command stack → slice 9 (full `undo_stack`/`redo_stack`; `RenameFolder` is listed there as reversible).
- Drag-to-reorder shortcuts, folder colors, confirm dialogs.

## 3. Success criteria

1. Double-clicking a folder name in the sidebar turns it into an input; typing a new name + **Enter** renames the folder on disk (its directory is moved under the same parent), the legend row updates, and the **shortcut is unchanged**.
2. Renaming to a name that collides with another registered target is rejected with an inline error and no filesystem change.
3. Clicking a folder's **×** removes it from the legend; the remaining folders renumber to a contiguous `1..=N` (no gap where the deleted key was); the next **New folder** fills the freed top slot (`N+1`).
4. Delete leaves the folder's directory and files on disk untouched — it only unregisters the target.
5. Suites green: `cargo test` (rename moves dir / keeps shortcut / collision error; delete removes + renumbers + next-create-fills-top) and Vitest (delete button calls `deleteFolder` and updates the store; double-click rename calls `renameFolder` and updates the store).

## 4. Architecture decision — mutate the backend list, return the whole list

Both commands take the target's stable `id` (= `normalize_path(path)`), mutate the managed `Mutex<Vec<FolderInfo>>` in place, and **return the entire updated list**. The sidebar handlers call `setFolders(returned)` — the frontend never patches the list itself, so backend and view can't drift. This mirrors #5b's backend-authoritative choice and keeps rename's id-recompute + delete's renumber logic in one place next to the filesystem. *(Rejected: returning only the changed entry — the caller would then have to replicate the renumber on the client, duplicating logic and risking divergence.)*

## 5. Backend (`folders.rs`)

```rust
/// Rename a target (by id) to `new_name`, moving its directory on disk.
/// Keeps the shortcut; recomputes id/name/path. Errors on empty name or a
/// collision with another registered target.
pub fn rename_in(list: &mut Vec<FolderInfo>, id: &str, new_name: &str) -> Result<(), String>
```
- Rejects an empty/whitespace name. Locates the entry by `id`; the new path is `old_path.parent()/new_name`; the new `id` is `normalize_path(new_path)`. If any **other** entry already has that new id → `Err` (no collision). Otherwise `std::fs::rename(old, new)` then update `id`/`name`/`path` in place. Shortcut is deliberately preserved (rename must not shuffle the 1–9 map).

```rust
/// Remove a target (by id) and renumber remaining shortcuts to a contiguous
/// 1..=N (v1 bug #2 fix). The on-disk directory is kept.
pub fn delete_in(list: &mut Vec<FolderInfo>, id: &str)
```
- `retain(|f| f.id != id)`, sort by `shortcut`, then reassign `shortcut = i + 1`. Because `upsert_target` (5b) always picks the lowest free 1..=9, a post-delete create naturally fills the freed top slot.

**Commands:** `rename_folder(state, id, name) -> Result<Vec<FolderInfo>, String>` and `delete_folder(state, id) -> Result<Vec<FolderInfo>, String>` lock the state, call the core, and return `list.clone()`. Registered in `lib.rs` `generate_handler!`.

## 6. Frontend

- `src/lib/commands.ts`: `renameFolder(id, name) -> Promise<FolderInfo[]>`, `deleteFolder(id) -> Promise<FolderInfo[]>`.
- `Sidebar.tsx`: local `editingId` / `editName` state. The name `<span>` gets `onDoubleClick` → enter edit mode; the input commits on Enter (`onRename` → `setFolders(await renameFolder(id, trimmed))`), cancels on Escape/blur. A `×` button per row (`aria-label={`Delete ${name}`}`) calls `onDelete` → `setFolders(await deleteFolder(id))`. Both catch errors into the existing inline `error` slot.

## 7. Error handling
- Empty rename → no-op client-side (commit only on a non-empty trimmed value) **and** guarded server-side.
- Collision on rename → backend `Err`, shown inline; the folder keeps its old name; nothing moves on disk.
- A failed `fs::rename` (locked dir) surfaces the OS error inline; state unchanged.
- Delete needs no confirmation dialog: it is non-destructive to files (dir kept), so it's cheaply repeatable; a mis-delete is fixed by re-creating the target (dedup makes that idempotent).

## 8. Security / capabilities
No new Tauri fs permission — rename/delete run in Rust `std::fs` (renamed dir stays under the already-asset-scoped scan root). Delete never touches file contents.

## 9. Testing

**Rust (`cargo test`, `tempfile`):**
- `rename_moves_dir_and_updates_entry_keeping_shortcut` — dir moved (`New` exists, `Old` gone), name updated, shortcut still 1, id followed the new path.
- `rename_to_existing_target_errors` — renaming A→B when B exists is `Err`.
- `delete_removes_and_renumbers_shortcuts` — deleting the middle of 1/2/3 leaves shortcuts `[1,2]`; the survivor keeps its identity; the next create gets shortcut 3.

**Vitest (`Sidebar.test.tsx`, `commands` mocked):**
- Delete button calls `deleteFolder(id)` and empties the store list.
- Double-click name → input → change → Enter calls `renameFolder(id, "Family")` and the store row updates to `Family`.

**Manual acceptance:** scan → create 3 targets → rename #2 (double-click, type, Enter) → its dir is renamed on disk, key stays 2 → delete #2 (×) → legend shows contiguous 1,2 → New folder → gets key 3 → confirm the deleted folder's files are still on disk.

## 10. Deferred (explicitly not in this slice)
File/batch rename + `F2` (slice 8), delete-to-Trash of a target's contents (slice 6+), rename/delete undo via the command stack (slice 9), reorder/colors/confirm dialogs.
