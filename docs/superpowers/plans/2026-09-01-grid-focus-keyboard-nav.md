# Grid Focus + Keyboard Navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a keyboard-driven focused cell to the grid — arrows move focus (highlighted + scrolled into view), and F/Enter/double-click open the focused file in the fullscreen Preview — the foundation for move-on-keypress sorting.

**Architecture:** A pure `nextFocusIndex` helper does the 2-D arrow math; the store holds `focusedId` + `setFocus`; `FileGrid` owns a window `keydown` handler (guarded so it's inert while the Preview is open), default-first-focus, and scroll-into-view; `FileCard` takes a `focused` prop for the ring and maps click→focus, double-click→open.

**Tech Stack:** React 19 + TypeScript, Zustand, TanStack Virtual, Vitest + `@testing-library/react`. Frontend-only — no Rust/cargo changes.

**Spec:** [`../specs/2026-09-01-grid-focus-keyboard-nav-design.md`](../specs/2026-09-01-grid-focus-keyboard-nav-design.md) — the plan argues from the spec; executors read both.

## Global Constraints

- **Frontend-only slice** — no backend, no `cargo` changes. Verify every task with Vitest: `npm test -- --run [file]`.
- **Keyboard:** `ArrowRight`/`j` → next (+1, clamp at last); `ArrowLeft`/`k` → prev (−1, clamp at first); `ArrowDown`/`ArrowUp` → ±one row, staying put at the top/bottom edge; no wrap. `f`/`F`/`Enter` → open the focused file in the Preview; **double-click** also opens.
- **Grid keys are inert while the Preview is open** (`previewId != null`) — the Preview owns Esc / ←/→.
- **Click focuses** a cell (a deliberate change from slice #4, where click opened the Preview).
- **Focus defaults to the first file** once results exist; cleared on `startScan` and `reset`.
- **Identity:** `focusedId` uses `FileInfo.id` (already `normalize_path(path)`). `CARD` cell size stays `160`.
- **Tests:** Vitest. A task isn't done until its tests pass; the final task (Task 5) is the manual run.

---

## File Structure

**Created:**
- `src/lib/gridNav.ts` — pure `nextFocusIndex` arrow math.
- `src/lib/gridNav.test.ts` — Vitest for the math.
- `src/components/FileGrid.test.tsx` — Vitest for the grid's keyboard wiring.

**Modified:**
- `src/store/useAppStore.ts` — add `focusedId` + `setFocus`; clear on `startScan`/`reset`.
- `src/store/useAppStore.test.ts` — tests for focus state.
- `src/components/FileGrid.tsx` — keyboard handler, default focus, scroll-into-view, pass `focused`.
- `src/components/FileCard.tsx` — `focused` prop + ring; click→focus, double-click→open.
- `src/components/FileCard.test.tsx` — updated for the new click/double-click/ring behavior.

---

## Task 1: `gridNav.ts` — focus arithmetic (TDD)

**Files:**
- Create: `src/lib/gridNav.ts`, `src/lib/gridNav.test.ts`

**Interfaces:**
- Produces: `nextFocusIndex(current: number, key: string, columns: number, count: number): number`.

- [ ] **Step 1: Write the failing test** — `src/lib/gridNav.test.ts`

```ts
import { expect, test } from "vitest";
import { nextFocusIndex } from "./gridNav";

// Reason about a 10-item, 4-column grid: rows [0..3] [4..7] [8..9].
test("right/j moves by one and clamps at the last item", () => {
  expect(nextFocusIndex(0, "ArrowRight", 4, 10)).toBe(1);
  expect(nextFocusIndex(0, "j", 4, 10)).toBe(1);
  expect(nextFocusIndex(9, "ArrowRight", 4, 10)).toBe(9);
});

test("left/k moves by one and clamps at the first item", () => {
  expect(nextFocusIndex(5, "ArrowLeft", 4, 10)).toBe(4);
  expect(nextFocusIndex(5, "k", 4, 10)).toBe(4);
  expect(nextFocusIndex(0, "ArrowLeft", 4, 10)).toBe(0);
});

test("down moves by a row, staying put when no row below", () => {
  expect(nextFocusIndex(1, "ArrowDown", 4, 10)).toBe(5);
  expect(nextFocusIndex(8, "ArrowDown", 4, 10)).toBe(8); // 8+4=12 out of range
});

test("up moves by a row, staying put when no row above", () => {
  expect(nextFocusIndex(5, "ArrowUp", 4, 10)).toBe(1);
  expect(nextFocusIndex(1, "ArrowUp", 4, 10)).toBe(1); // 1-4=-3 out of range
});

test("no focus (-1) selects the first item; empty grid yields -1", () => {
  expect(nextFocusIndex(-1, "ArrowDown", 4, 10)).toBe(0);
  expect(nextFocusIndex(-1, "ArrowRight", 4, 0)).toBe(-1);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- --run src/lib/gridNav.test.ts`
Expected: FAIL (`gridNav` does not exist).

- [ ] **Step 3: Create `src/lib/gridNav.ts`**

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

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- --run src/lib/gridNav.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gridNav.ts src/lib/gridNav.test.ts
git commit -m "feat: nextFocusIndex grid navigation math with tests"
```

---

## Task 2: Store focus state (TDD)

**Files:**
- Modify: `src/store/useAppStore.ts`, `src/store/useAppStore.test.ts`

**Interfaces:**
- Produces: `focusedId: string | null`; `setFocus(id: string | null): void`. Cleared by `startScan`/`reset`.

- [ ] **Step 1: Append failing tests to `src/store/useAppStore.test.ts`** (reuses the file's existing `mk` helper and vitest imports)

```ts
test("setFocus sets and clears focusedId", () => {
  useAppStore.setState({ focusedId: null });
  useAppStore.getState().setFocus("a");
  expect(useAppStore.getState().focusedId).toBe("a");
  useAppStore.getState().setFocus(null);
  expect(useAppStore.getState().focusedId).toBeNull();
});

test("startScan and reset clear focusedId", () => {
  useAppStore.setState({ focusedId: "a" });
  useAppStore.getState().startScan();
  expect(useAppStore.getState().focusedId).toBeNull();
  useAppStore.setState({ focusedId: "b" });
  useAppStore.getState().reset();
  expect(useAppStore.getState().focusedId).toBeNull();
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- --run src/store/useAppStore.test.ts`
Expected: FAIL (`setFocus` is not a function).

- [ ] **Step 3: Edit `src/store/useAppStore.ts`**

Add to the `AppState` interface (near `previewId`):
```ts
  focusedId: string | null;
  setFocus: (id: string | null) => void;
```
In the store factory: add `focusedId: null,` to the initial state and to the `set({...})` objects in **both** `startScan` and `reset` (i.e. `previewId: null, focusedId: null`), and add the action:
```ts
  setFocus: (id) => set({ focusedId: id }),
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- --run src/store/useAppStore.test.ts`
Expected: all green (existing store + preview tests plus the 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat: store focusedId + setFocus (cleared on scan/reset)"
```

---

## Task 3: `FileCard` focus + click/double-click (TDD)

**Files:**
- Modify: `src/components/FileCard.tsx`, `src/components/FileCard.test.tsx`

**Interfaces:**
- Consumes: `useAppStore` (`setFocus`, `openPreview`).
- Produces: `FileCard({ file, focused }: { file: FileInfo; focused?: boolean })` — click focuses, double-click opens, ring when `focused`.

- [ ] **Step 1: Replace `src/components/FileCard.test.tsx`** (the slice-#4 test asserted click-opens; that behavior is changing)

```tsx
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../lib/useThumbnail", () => ({
  useThumbnail: () => ({ url: null, status: "placeholder" }),
}));

import { FileCard } from "./FileCard";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const file: FileInfo = {
  id: "x1", path: "C:/x/a.jpg", name: "a.jpg", extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
};

afterEach(cleanup);

test("clicking a card focuses it (does not open the preview)", () => {
  useAppStore.setState({ focusedId: null, previewId: null });
  render(<FileCard file={file} focused={false} />);
  fireEvent.click(screen.getByRole("button"));
  expect(useAppStore.getState().focusedId).toBe("x1");
  expect(useAppStore.getState().previewId).toBeNull();
});

test("double-clicking a card opens its preview", () => {
  useAppStore.setState({ previewId: null });
  render(<FileCard file={file} focused={false} />);
  fireEvent.doubleClick(screen.getByRole("button"));
  expect(useAppStore.getState().previewId).toBe("x1");
});

test("a focused card renders a focus ring", () => {
  render(<FileCard file={file} focused={true} />);
  expect(screen.getByRole("button").className).toContain("ring-2");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- --run src/components/FileCard.test.tsx`
Expected: FAIL (click still opens; no ring; `focused` prop unused).

- [ ] **Step 3: Replace `src/components/FileCard.tsx`**

```tsx
import type { FileInfo } from "../lib/types";
import { useThumbnail } from "../lib/useThumbnail";
import { useAppStore } from "../store/useAppStore";

export function FileCard({ file, focused = false }: { file: FileInfo; focused?: boolean }) {
  const { url, status } = useThumbnail(file);
  const setFocus = useAppStore((s) => s.setFocus);
  const openPreview = useAppStore((s) => s.openPreview);
  return (
    <button
      type="button"
      onClick={() => setFocus(file.id)}
      onDoubleClick={() => openPreview(file.id)}
      className={`w-[152px] h-[150px] rounded bg-neutral-800 border overflow-hidden relative flex items-end text-left ${
        focused ? "border-blue-500 ring-2 ring-blue-500" : "border-neutral-700"
      }`}
      title={file.path}
    >
      {status === "ready" && url && (
        <img src={url} alt={file.name} className="absolute inset-0 w-full h-full object-cover" />
      )}
      {status === "loading" && <div className="absolute inset-0 animate-pulse bg-neutral-700/40" />}
      <span className="relative z-10 w-full truncate p-1 text-[11px] text-neutral-200 bg-gradient-to-t from-black/70 to-transparent">
        {file.name}
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- --run src/components/FileCard.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/FileCard.tsx src/components/FileCard.test.tsx
git commit -m "feat: FileCard click-to-focus, double-click-to-open, focus ring"
```

---

## Task 4: `FileGrid` keyboard nav + default focus + scroll (TDD)

**Files:**
- Modify: `src/components/FileGrid.tsx`
- Create: `src/components/FileGrid.test.tsx`

**Interfaces:**
- Consumes: `useAppStore` (`files`, `focusedId`, `previewId`, `setFocus`, `openPreview`); `nextFocusIndex` (`../lib/gridNav`); `FileCard` `focused` prop.
- Produces: keyboard-driven focus over the grid (no new exported symbols).

- [ ] **Step 1: Write failing tests** — `src/components/FileGrid.test.tsx`

```tsx
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

vi.mock("../lib/useThumbnail", () => ({
  useThumbnail: () => ({ url: null, status: "placeholder" }),
}));

import { FileGrid } from "./FileGrid";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const mk = (id: string): FileInfo => ({
  id, path: `C:/x/${id}.jpg`, name: `${id}.jpg`, extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
});

beforeEach(() => useAppStore.setState({ files: [], focusedId: null, previewId: null }));
afterEach(cleanup);

test("defaults focus to the first file on mount", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: null });
  render(<FileGrid />);
  expect(useAppStore.getState().focusedId).toBe("a");
});

test("arrows move focus when the preview is closed (one column under jsdom)", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], focusedId: "a", previewId: null });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(useAppStore.getState().focusedId).toBe("b");
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(useAppStore.getState().focusedId).toBe("c");
});

test("F opens the focused file in the preview", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "b", previewId: null });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "f" });
  expect(useAppStore.getState().previewId).toBe("b");
});

test("arrows are inert while the preview is open", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "a", previewId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(useAppStore.getState().focusedId).toBe("a");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- --run src/components/FileGrid.test.tsx`
Expected: FAIL (no default focus / no keyboard handling yet).

- [ ] **Step 3: Replace `src/components/FileGrid.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../store/useAppStore";
import { FileCard } from "./FileCard";
import { nextFocusIndex } from "../lib/gridNav";

const CARD = 160; // px cell size

export function FileGrid() {
  const files = useAppStore((s) => s.files);
  const focusedId = useAppStore((s) => s.focusedId);
  const setFocus = useAppStore((s) => s.setFocus);
  const openPreview = useAppStore((s) => s.openPreview);
  const parentRef = useRef<HTMLDivElement>(null);
  const columns = Math.max(1, Math.floor((parentRef.current?.clientWidth ?? 1200) / CARD));
  const rows = Math.ceil(files.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD,
    overscan: 6,
  });

  // Default focus to the first file once results exist.
  useEffect(() => {
    if (files.length > 0 && useAppStore.getState().focusedId == null) {
      setFocus(files[0].id);
    }
  }, [files, setFocus]);

  // Keyboard navigation — inert while the Preview owns the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { files, focusedId, previewId } = useAppStore.getState();
      if (previewId != null || files.length === 0) return;
      if (e.key === "f" || e.key === "F" || e.key === "Enter") {
        if (focusedId != null) {
          openPreview(focusedId);
          e.preventDefault();
        }
        return;
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "j", "k"].includes(e.key)) {
        const cols = Math.max(1, Math.floor((parentRef.current?.clientWidth ?? 0) / CARD));
        const cur = files.findIndex((f) => f.id === focusedId);
        const next = nextFocusIndex(cur, e.key, cols, files.length);
        if (next >= 0 && files[next]) setFocus(files[next].id);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFocus, openPreview]);

  // Keep the focused cell in view.
  useEffect(() => {
    if (focusedId == null) return;
    const idx = files.findIndex((f) => f.id === focusedId);
    if (idx < 0) return;
    const cols = Math.max(1, Math.floor((parentRef.current?.clientWidth ?? 0) / CARD));
    try {
      rowVirtualizer.scrollToIndex(Math.floor(idx / cols));
    } catch {
      // virtualizer not laid out yet (e.g. jsdom) — scroll is best-effort
    }
  }, [focusedId, files, rowVirtualizer]);

  return (
    <div ref={parentRef} className="flex-1 overflow-auto">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((vr) => {
          const start = vr.index * columns;
          const cells = files.slice(start, start + columns);
          return (
            <div
              key={vr.key}
              className="absolute left-0 flex gap-2 px-2"
              style={{ top: vr.start, height: CARD, width: "100%" }}
            >
              {cells.map((f) => (
                <FileCard key={f.id} file={f} focused={f.id === focusedId} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- --run src/components/FileGrid.test.tsx`
Expected: 4 passed.

- [ ] **Step 5: Run the full frontend suite — expect PASS**

Run: `npm test -- --run`
Expected: all green — the App/store/thumbnail/preview suites plus the new focus tests. (App renders an empty grid, so default-focus is a no-op there and the window key listener sits idle.)

- [ ] **Step 6: Commit**

```bash
git add src/components/FileGrid.tsx src/components/FileGrid.test.tsx
git commit -m "feat: keyboard focus navigation in the grid (arrows/F/Enter, scroll-into-view)"
```

---

## Task 5: Manual run + acceptance

**Files:** none (verification only).

- [ ] **Step 1: Confirm the suite is green**

Run: `npm test -- --run`
Expected: all green.

- [ ] **Step 2: Run the app**

Run: `npm run tauri dev`

- [ ] **Step 3: Verify manually**

- Scan a folder → the **first cell is ringed**.
- Arrow keys move the ring **left/right by one and up/down by a row**; the grid **scrolls to keep the ring visible** when you pass the fold; `j`/`k` also step next/prev.
- **Click** a cell → the ring jumps to it (the fullscreen preview does **not** open).
- **F / Enter / double-click** → the fullscreen Preview opens on the focused file.
- With the Preview open, its **←/→ still navigate** and grid arrows don't fight it; close it and grid arrows resume.

- [ ] **Step 4: Commit (only if the run needed tweaks)**

```bash
git add -A && git commit -m "chore: grid focus slice manual-run verification"
```

---

## Self-Review

**Spec coverage (spec §§2–5):**
- `focusedId` view-state + ring → Task 2 (store) + Task 3 (`FileCard` ring). ✓
- Arrow nav ←/→/k/j by one, ↑/↓ by a row, clamp/stay, no wrap → Task 1 (`nextFocusIndex`) + Task 4 (wiring). ✓
- Default-first-focus; cleared on scan/reset → Task 2 (clear) + Task 4 (default). ✓
- Auto-scroll focused into view → Task 4 (scroll effect). ✓
- Click focuses; double-click / F / Enter open → Task 3 (click/dblclick) + Task 4 (F/Enter). ✓
- Grid keys inert while Preview open → Task 4 (`previewId` guard). ✓
- Testing: gridNav math, store, card, grid wiring, manual run → Tasks 1–5. ✓
- Deferred (multi-select, target folders/moves, grid-list toggle, zoom) → not implemented, by design. ✓

**Placeholder scan:** no TBD/TODO; every code step is complete. The Task-4 `scrollToIndex` try/catch is a deliberate best-effort guard (auto-scroll must never crash pre-layout / under jsdom), not a placeholder. ✓

**Type consistency:** `nextFocusIndex(current, key, columns, count)` (Task 1) called with that exact signature in Task 4; store `focusedId`/`setFocus` (Task 2) consumed unchanged in Tasks 3–4; `FileCard`'s `focused?: boolean` prop (Task 3) supplied by Task 4; `FileInfo.id`/`fileType` match `src/lib/types.ts`; `previewId`/`openPreview` reused from slice #4 unchanged. ✓
