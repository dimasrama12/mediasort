# MediaSort v2 — Slice #5a: Grid Focus + Keyboard Navigation — Design Spec

**Date:** 2026-09-01
**Status:** Draft for plan
**Grounded in:** `DESIGN.md` §5 (frontend owns view state — selection/focus — in Zustand slices; grid has a "focused-item highlight"), §10 keyboard baseline (→/← or J/K navigate, F/Enter fullscreen); `PRD-MediaSort-v2.md` §5 (focused-item highlight, smooth at 5,000+), §5.1 (Next/previous → / ← or J/K; Fullscreen F or Enter). Foundation for roadmap step 5 (target folders + keys 1–9 move-on-keypress) and back-fills slice #4's deferred F/Enter-to-open.

**Scoping note:** The sorting feature (roadmap #5) decomposes into **[this slice: focus + keyboard nav] → [target folders + move-on-keypress] → [folder rename / multi-select / undo / trash]**. This slice is the frontend-only "which file am I acting on" spine — no backend, no file moves, no folders.

---

## 1. Goal

A **focused cell** the user drives by keyboard: arrows move focus through the virtualized grid (focused cell highlighted and scrolled into view), and **F/Enter or double-click** open the focused file in the fullscreen Preview. This is the interaction spine the move-on-keypress slice builds on, and it makes keyboard-open (deferred in slice #4) real.

## 2. Scope

**In:**
- `focusedId` view-state in the store; a visible ring on the focused cell.
- Keyboard navigation over the grid: **←/→ (and k/j)** by one; **↑/↓** by a full row; clamped at edges, no wrap.
- Focus **defaults to the first file** when results arrive; cleared on scan start / reset.
- The focused cell **auto-scrolls into view** as focus moves (usable on a 10k grid).
- **Click focuses** a cell; **double-click and F/Enter open** it in the Preview.
- Grid key handling is **inert while the Preview is open** (Preview owns Esc / ←/→ then).

**Out — later slices:**
- Multi-select (Ctrl/Shift-click, range) → the move/sorting slices.
- Target folders, keys 1–9, file moves → slice #5b.
- Grid/list toggle, thumbnail-size zoom.

## 3. Success criteria

1. After a scan the first cell is focused; arrow keys move the ring in all four directions and the grid scrolls to keep it visible on a 1,000+ grid.
2. ←/→ and k/j move by one (clamped at first/last); ↑/↓ move by a row and stay put when there is no row above/below.
3. Clicking a cell focuses it; **F/Enter or double-click** open the focused file in the Preview.
4. While the Preview is open, grid arrows do **not** move focus (Preview navigation is unaffected).
5. Vitest suite green (nav math, store, card, grid wiring).

## 4. Frontend

### 4.1 `src/lib/gridNav.ts` (new)

The one piece with real logic — pure, fully unit-tested:

```ts
/** Next focus index for an arrow/vim key in a `columns`-wide grid of `count`
 * items. Left/right (k/j) move by one and clamp to the ends; up/down move by a
 * row and stay put when there is no neighboring row. `current < 0` (no focus)
 * focuses the first item; an empty grid yields -1. */
export function nextFocusIndex(
  current: number,
  key: string,
  columns: number,
  count: number,
): number {
  if (count === 0) return -1;
  if (current < 0) return 0;
  switch (key) {
    case "ArrowRight":
    case "j":
      return Math.min(current + 1, count - 1);
    case "ArrowLeft":
    case "k":
      return Math.max(current - 1, 0);
    case "ArrowDown": {
      const t = current + columns;
      return t <= count - 1 ? t : current;
    }
    case "ArrowUp": {
      const t = current - columns;
      return t >= 0 ? t : current;
    }
    default:
      return current;
  }
}
```

### 4.2 `src/store/useAppStore.ts`

Add view-state:
```ts
  focusedId: string | null;          // in AppState
  setFocus: (id: string | null) => void;
```
`focusedId: null` initially; `setFocus: (id) => set({ focusedId: id })`; and add `focusedId: null` to the `set({...})` in both `startScan` and `reset`.

### 4.3 `src/components/FileGrid.tsx`

Subscribe to `focusedId`, `previewId`, `setFocus`, `openPreview` (alongside `files`). Add:
- **Default focus:** an effect — `if (files.length && focusedId == null) setFocus(files[0].id)`.
- **Keydown handler** (window listener; reads live state via `useAppStore.getState()` so the listener never goes stale and re-subscribes only on the stable actions):
  - If `previewId != null` → return (Preview owns keys).
  - `f`/`F`/`Enter` → if a file is focused, `openPreview(focusedId)` + `preventDefault`.
  - Arrow/`j`/`k` → compute `columns = max(1, floor(clientWidth / CARD))` from the live `parentRef`, `cur = files.findIndex(id===focusedId)`, `next = nextFocusIndex(cur, key, columns, files.length)`, `setFocus(files[next].id)` + `preventDefault`.
- **Scroll into view:** an effect on `focusedId` — compute the focused row (`floor(index / columns)`) and `rowVirtualizer.scrollToIndex(row)`.
- Pass `focused={f.id === focusedId}` to each `<FileCard>`.

`CARD` stays 160.

### 4.4 `src/components/FileCard.tsx`

Signature becomes `{ file, focused }: { file: FileInfo; focused: boolean }`. Subscribe to `setFocus` and `openPreview`. On the card button: `onClick={() => setFocus(file.id)}`, `onDoubleClick={() => openPreview(file.id)}`, and append a focus ring to the className when `focused` (e.g. `ring-2 ring-blue-500`). Thumbnail/placeholder/filename children unchanged.

## 5. Testing

**Vitest:**
- `gridNav.ts`: `nextFocusIndex` for every key — right/j and left/k clamp at the ends; down/up move by `columns` and stay put at the grid's top/bottom edge; `current < 0` → 0; `count === 0` → -1.
- `useAppStore`: `setFocus` sets/clears `focusedId`; `startScan` and `reset` clear it.
- `FileCard`: click calls `setFocus(id)` (not open); double-click calls `openPreview(id)`; a `focused` card renders the ring class.
- `FileGrid`: with the Preview closed, `ArrowDown`/`ArrowRight` move `focusedId`; `f`/`Enter` open the focused file; with a `previewId` set, arrows leave `focusedId` unchanged; mounting with files and no focus defaults focus to the first file. (jsdom yields one column, so these exercise linear nav; 2-D correctness is in the `gridNav` unit test.)

**Manual (run the app):** scan a folder → first cell ringed; arrow around → ring moves and the grid scrolls to follow; click a cell → ring jumps to it; F/Enter/double-click → fullscreen Preview opens on the focused file; open the Preview → its own ←/→ still navigate and the grid keys stay quiet.

## 6. Risks / open items

- **jsdom collapses the grid to one column** (`clientWidth` 0 → `columns` 1), so `FileGrid` tests exercise linear nav only; the 2-D math is covered by the `gridNav` unit test. Consistent with not unit-testing the virtualizer's layout.
- **Virtualizer under test:** `App.test.tsx` already renders `FileGrid` in jsdom, so a direct `FileGrid` render should mount; if it needs a `ResizeObserver` shim, add one to the Vitest setup.
- **`scrollToIndex`** is the TanStack Virtual call for scroll-into-view; the exact signature (index, optional `{ align }`) is confirmed when wiring — a mis-call only affects auto-scroll, caught by the manual run.

## 7. Deferred (explicitly not in this slice)

Multi-select / range selection, target folders + keys 1–9 + file moves, grid/list toggle, thumbnail-size zoom.
