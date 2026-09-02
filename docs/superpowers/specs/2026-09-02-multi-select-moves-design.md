# MediaSort v2 — Slice #5d: Multi-Select + Batch Moves — Design Spec

**Date:** 2026-09-02
**Status:** Draft for plan
**Grounded in:** `DESIGN.md` §2 (Rust owns FS truth; store owns view state; UI glue verified by running), §6.6 (`move_files(paths, dest)` already takes a `Vec` — batch-ready), §12 slice 5 ("Target folders + keys 1–9 — create/rename/delete, path-dedup, **move on keypress**"); `PRD-MediaSort-v2.md` §3.3/§5.1 (select multiple files, move the selection to a target with 1–9). Builds on #5a (focus nav), #5b (single-file move-on-keypress + Ctrl+Z), #5c (folder rename/delete).

**Scoping note:** Slice 4 shipped preview/fullscreen/video but **no multi-select** — the store today has only a single `focusedId`. #5d introduces the selection model *and* wires it to the 1–9 batch move, completing the "move on keypress" story for slice 5. The backend needs **no change**: `move_files` already accepts many paths for one destination.

---

## 1. Goal

Select several files (mouse-driven) and move them **all** into a target folder with one 1–9 keypress. With nothing selected, 1–9 keeps moving just the focused file (unchanged #5b behavior).

## 2. Brainstorm / decisions (defaulted to lean "option 1")

- **Selection is mouse-driven for v1**: plain click = select-only, **Ctrl/Cmd+click** = toggle, **Shift+click** = contiguous range from the focus anchor. `Escape` clears the selection. *(Keyboard-built selection — Space-toggle, Shift+Arrow, Ctrl+A — deferred; not needed to prove the batch-move value.)*
- **Selection ≠ focus.** Focus (the ring, #5a) stays a single cursor and the range anchor; selection is a set drawn with a distinct style. Arrow nav moves focus only and does **not** disturb an existing selection.
- **1–9 precedence:** if the selection is non-empty, move the **whole selection**; else move the focused file. Selection is moved even if the focused file isn't in it.
- **Undo stays per-file (v1).** A batch move pushes one `MoveRecord` per file onto the existing history; `Ctrl+Z` undoes one file per press (most-recent first). **Grouped single-press batch undo is deferred to slice 9** (full command-pattern `undo_stack`/`redo_stack`). This keeps every #5b store/undo reducer and its tests unchanged — lowest-risk path.
- **No new backend command.** Forward batch move is one `move_files(paths, targetPath)` call (all to one dest). Per-file undo reuses the existing single-path `move_files` back to each file's own source dir.

## 3. Scope

**In:**
- Store selection slice: `selectedIds: string[]` + `selectOnly(id)`, `toggleSelected(id)`, `selectRangeTo(id)`, `clearSelection()`; cleared on `startScan`/`reset`.
- Store `completeMoveMany(ids, folderId, toPaths)`: remove all selected files, bump the folder's `fileCount` by N, push one `MoveRecord` per file (ascending original index), advance focus to the nearest survivor, clear the selection.
- `FileCard`: click / Ctrl+click / Shift+click selection wiring + a distinct **selected** style; keeps double-click → preview.
- `FileGrid`: pass `selected` to cards; 1–9 moves the selection (batch) when non-empty, else the focused file; `Escape` clears the selection.

**Out — deferred:**
- Keyboard-driven selection (Space / Shift+Arrow / Ctrl+A), grouped one-press batch undo + redo (slice 9), drag-select marquee, "invert/select all" affordances, moving the selection via drag-and-drop.

## 4. Data model (store additions)

```ts
selectedIds: string[];                 // ids of selected files (subset of files)
selectOnly: (id: string) => void;      // plain click: selection = [id], focus = id
toggleSelected: (id: string) => void;  // ctrl/cmd click: add/remove id; focus = id
selectRangeTo: (id: string) => void;   // shift click: inclusive range focus-anchor..id (file order)
clearSelection: () => void;
completeMoveMany: (ids: string[], folderId: string, toPaths: string[]) => void; // ids & toPaths order-matched (grid order)
```

`MoveRecord` (unchanged) already carries per-file `fromDir`/`fromIndex`/`toPath`, so per-press undo of a batched move Just Works.

## 5. Behavior

**Select:** click A → `{A}`, focus A. Ctrl+click C → `{A,C}`. Shift+click E (anchor = focus A) → `{A,B,C,D,E}`. `Escape` → `{}`.

**Batch move:** with `{A,C,E}` selected, press `2` → `move_files([A,C,E], target2)`; A/C/E leave the grid; `target2.fileCount += 3`; focus lands on the survivor at A's old slot; selection clears. `Ctrl+Z` ×3 returns E, then C, then A (each to its own source dir, at its original index).

**Fallback:** nothing selected, focus on B, press `2` → moves B only (#5b path, untouched).

## 6. Selection semantics

- `selectRangeTo`: anchor = current `focusedId` (or the clicked id if focus is null); range = `files[lo..=hi]` ids where `lo/hi` bracket the anchor and clicked indices. Focus stays on the anchor so repeated shift-clicks re-extend from the same origin.
- `completeMoveMany` builds records in **ascending original index** so that undoing them (from the end of history, i.e. highest index first) re-inserts each at its original slot and reconstructs the pre-move order exactly.

## 7. Visuals
Selected cells get a distinct treatment (e.g. `border-sky-400` + faint `bg-sky-500/20`) that composes with the focus ring (blue) so a cell can be both focused and selected. Focus ring keeps priority for the border color.

## 8. Security / capabilities
None new — moves stay in `move_files` (Rust `std::fs`), destinations under the asset-scoped scan root. No IPC surface added.

## 9. Testing

**Vitest — store (`useAppStore.test.ts`):**
- `selectOnly` sets `[id]` + focus; `toggleSelected` adds then removes + sets focus; `selectRangeTo` yields the inclusive range in file order (both directions); `clearSelection` empties.
- `completeMoveMany` removes all selected, bumps count by N, pushes N records (ascending index), advances focus, clears selection; repeated `completeUndo` reconstructs the original files array and order.
- `startScan` and `reset` clear `selectedIds`.

**Vitest — `FileCard.test.tsx` (new):** plain click → `selectOnly`; Ctrl+click → toggle onto an existing selection; Shift+click → range.

**Vitest — `FileGrid.test.tsx`:** with a selection, a mapped digit calls `moveFiles` with **all** selected paths (grid order), removes them, bumps count by N, and clears the selection; `Escape` clears the selection; the existing single-focus move / unmapped / Ctrl+Z / preview-guard tests stay green (mock updated to return one path per input).

**Manual acceptance:** scan → Ctrl+click three files → press a target key → all three move, count +3, selection clears, focus sensible → Ctrl+Z three times returns them → Shift+click selects a run → move works → Escape clears.

## 10. Deferred (explicitly not in this slice)
Keyboard selection (Space/Shift+Arrow/Ctrl+A), grouped one-press batch undo + redo (slice 9), marquee/drag select, drag-and-drop move.
