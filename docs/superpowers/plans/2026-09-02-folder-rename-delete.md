# Folder Rename + Delete (shortcut renumber) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename and delete target folders from the sidebar; deleting renumbers the remaining 1–9 shortcuts to a contiguous `1..=N` (v1 bug #2 "ghost folders" fix). Completes roadmap slice 5.

**Architecture:** Rust owns the target list; `rename_in`/`delete_in` mutate the managed `Mutex<Vec<FolderInfo>>` and the commands return the **whole updated list**, which the sidebar mirrors via `setFolders`. Rename moves the dir on disk and keeps the shortcut; delete keeps the dir and only unregisters + renumbers.

**Tech Stack:** Rust + Tauri v2 (`std::fs`, serde), React 19 + TypeScript, Zustand, Vitest + `@testing-library/react`, `cargo test` (+ `tempfile`).

**Spec:** [`../specs/2026-09-02-folder-rename-delete-design.md`](../specs/2026-09-02-folder-rename-delete-design.md).

## Global Constraints
- **Identity = `normalize_path(path)`** — rename recomputes `id` from the new path; collision is detected against other entries' ids.
- **Renumber invariant** — after any delete, shortcuts are exactly `1..=N` in shortcut order, no gaps. `upsert_target` (5b) still assigns the lowest free 1..=9, so a post-delete create fills the freed top.
- **Rename keeps the shortcut** — renaming must never reshuffle the 1–9 map.
- **Delete is file-safe** — the on-disk directory and its contents are kept; only the target registration is removed.
- **No new Tauri fs capability**; renamed dir stays under the asset-scoped scan root.
- **Tests gate each task.** Rust: `cargo test --manifest-path src-tauri/Cargo.toml`. Frontend: `npm test -- --run`.

---

## File Structure
**Modified:**
- `src-tauri/src/folders.rs` — add `rename_in`, `delete_in` cores + `rename_folder`, `delete_folder` commands + tests.
- `src-tauri/src/lib.rs` — register the two commands.
- `src/lib/commands.ts` — `renameFolder`, `deleteFolder` wrappers.
- `src/components/Sidebar.tsx` — inline double-click rename + per-row × delete.
- `src/components/Sidebar.test.tsx` — rename/delete wiring tests.

---

## Task 1: Backend rename + delete cores (TDD)
**Files:** `src-tauri/src/folders.rs`

- [x] **Step 1: Append failing tests** inside `folders.rs`'s `mod tests`:
  - `rename_moves_dir_and_updates_entry_keeping_shortcut`
  - `rename_to_existing_target_errors`
  - `delete_removes_and_renumbers_shortcuts`
- [x] **Step 2: Run — expect FAIL** (`rename_in`/`delete_in` undefined).
  Run: `cargo test --manifest-path src-tauri/Cargo.toml folders`
- [x] **Step 3: Implement** `rename_in(list, id, new_name) -> Result<(), String>` (empty-name guard → locate by id → `parent/new_name` → new id via `normalize_path` → collision guard against other entries → `fs::rename` → update id/name/path, keep shortcut) and `delete_in(list, id)` (`retain` != id → sort by shortcut → reassign `shortcut = i+1`).
- [x] **Step 4: Run — expect PASS** (3 new + existing folders tests).

## Task 2: IPC commands + wiring (TDD-adjacent)
**Files:** `src-tauri/src/folders.rs`, `src-tauri/src/lib.rs`

- [x] **Step 1:** Add `#[tauri::command] rename_folder(state, id, name) -> Result<Vec<FolderInfo>, String>` and `delete_folder(state, id) -> Result<Vec<FolderInfo>, String>` (lock, call core, `Ok(list.clone())`).
- [x] **Step 2:** Register both in `lib.rs` `generate_handler!`.
- [x] **Step 3: Run whole crate — expect PASS.**
  Run: `cargo test --manifest-path src-tauri/Cargo.toml` → 24 passed.

## Task 3: Command wrappers + Sidebar UI (TDD)
**Files:** `src/lib/commands.ts`, `src/components/Sidebar.tsx`, `src/components/Sidebar.test.tsx`

- [x] **Step 1:** Add failing tests — `delete button removes the folder via command and updates the store`; `double-clicking a name renames it via command`. Extend the mock with `renameFolder`/`deleteFolder`; add `beforeEach(clearAllMocks)`.
- [x] **Step 2: Run — expect FAIL.**
- [x] **Step 3:** Add `renameFolder`/`deleteFolder` wrappers to `commands.ts`. In `Sidebar.tsx` add `editingId`/`editName` state, `onRename`/`onDelete` (both `setFolders(await ...)` with inline error catch), the double-click-to-input on the name span, and the per-row `×` button (`aria-label={`Delete ${name}`}`).
- [x] **Step 4: Run — expect PASS** (`Sidebar.test.tsx`).

## Task 4: Full suites + manual acceptance
- [x] **Step 1:** `cargo test --manifest-path src-tauri/Cargo.toml` → 24 passed.
- [x] **Step 2:** `npm test -- --run` → 51 passed.
- [ ] **Step 3 (manual, deferred to batch run):** scan → 3 targets → double-click-rename #2 (dir renamed on disk, key stays 2) → delete #2 (legend renumbers to 1,2) → New folder → key 3 → deleted folder's files still on disk.

---

## Self-Review
**Spec coverage:** rename core + keep-shortcut + collision (Task 1 ✓); delete core + renumber + next-create-fills-top (Task 1 ✓); commands return whole list (Task 2 ✓); wrappers + double-click rename + × delete + inline errors (Task 3 ✓); both suites green (Task 4 ✓). Deferred (file/F2 rename, delete-to-trash, rename/delete undo, reorder/colors/confirm) — not implemented, by design. ✓
**Note:** implemented as a single working-tree change from a prior session; this plan documents the design retroactively and both suites are verified green (backend 24, frontend 51). Manual acceptance batched with the next slice's dev run.
