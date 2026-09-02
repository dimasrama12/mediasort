# Slice 8 — Batch rename + search/filter

Roadmap: DESIGN.md §12.8 · Rename module: §6.6. Autonomous overnight build — decisions
default to the lean "option 1" and are recorded here (user asleep).

## Goal

Two independent capabilities:
1. **Batch rename** — rename a set of files to `pattern` + sequential number (`{n}`), with a
   start number and zero-pad width, preserving each file's extension (§6.6 generalizes v1's
   `Base (i)` to a `{n}` pattern).
2. **Search/filter** — a toolbar text box that filters the grid to files whose name matches the
   query (case-insensitive substring). Keyboard nav / moves / trash operate on the **visible**
   (filtered) set so behaviour stays consistent with what's shown.

Undo of a rename is **deferred to slice 9** (command stacks). This slice performs renames
directly and updates the store's file entries.

## Decisions (option-1 defaults)

1. **Sequence:** number `i` = `start + index` (0-based). Zero-padded to `pad` width (`pad = 0` ⇒
   no padding). `{n}` in the pattern is replaced by the number; if the pattern has no `{n}`, the
   number is appended (`"Vacation"` → `"Vacation 001"`). Extension preserved from the source.
2. **Collision safety = two-phase.** Phase 1 renames every source to a unique temp name in its own
   directory (frees all final names, so intra-batch reshuffles like `1,2,3 → 2,3,4` can't clash);
   phase 2 renames each temp to its final target, suffixing `_N` only on collision with a
   pre-existing *external* file. Reuses a shared `resolve_collision` helper (also adopted by
   `move_one`, de-duplicating its inline loop).
3. **Rename scope:** the current selection if any, else all (filtered) files. Frontend concern.
4. **Search is view-only state** (`query` in the store), never mutates `files`. The grid and its
   key handler both derive the visible list through one pure `filterFiles(files, query)` helper so
   render and navigation agree. Range-select still spans full file order (rare combo; documented).
5. **Post-rename store update:** a `completeRename(updates)` reducer patches each renamed file's
   `id`/`path`/`name` in place (id = normalized new path). No history record this slice.

## Backend (`fileops.rs`, #8a)

```rust
pub struct RenamePlan { pub from: String, pub to: String }
pub fn plan_batch_rename(paths: &[String], pattern: &str, start: u32, pad: usize) -> Vec<RenamePlan>; // pure
pub fn apply_batch_rename(paths: &[String], pattern: &str, start: u32, pad: usize) -> Result<Vec<String>, String>; // two-phase disk
fn resolve_collision(target: &Path) -> PathBuf; // shared _N suffix
#[tauri::command] pub async fn batch_rename(paths, pattern, start, pad) -> Result<Vec<String>, String>;
```

## Frontend

- `filterFiles(files, query)` pure helper + tests (#8b).
- Toolbar search `<input>` bound to `query`/`setQuery`; `FileGrid` renders `filterFiles(...)` and the
  key handler derives the same visible list (#8b).
- Batch-rename panel (pattern / start / pad, preview of first result), calls `batch_rename` then
  `completeRename`; opened from a toolbar button, acts on selection-or-all (#8c).

## Acceptance

- `plan_batch_rename`: `"Trip {n}"`,start 1,pad 3 ⇒ `Trip 001.jpg, Trip 002.png`; no-`{n}` pattern
  appends; `pad 0` ⇒ no padding; extension-less files handled.
- `apply_batch_rename`: renames in order, originals gone; `1,2,3 → 2,3,4` shift produces no `_N`
  suffix (two-phase); an external pre-existing target gets `_1`.
- `filterFiles`: case-insensitive substring; empty query ⇒ all; no match ⇒ empty.
- Grid shows only matches; typing in the search box doesn't trigger grid key shortcuts (INPUT guard
  already present). All prior tests stay green; `cargo test` + `npm test -- --run` gate each merge.
