# Multi-Select + Batch Moves (Slice #5d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select several files with the mouse and move the whole selection into a target folder with one 1–9 keypress; with nothing selected, 1–9 keeps moving just the focused file (unchanged #5b behavior).

**Architecture:** Pure frontend slice. Add a `selectedIds` selection model to the Zustand store (distinct from the single `focusedId` cursor) plus a `completeMoveMany` reducer that removes N files, bumps the target count by N, and pushes one `MoveRecord` per file. `FileCard` gains modifier-aware click selection + a selected style; `FileGrid`'s keyboard handler moves the selection (when non-empty) via one `move_files(paths, dest)` call and clears it on `Escape`. **No backend change** — `move_files` already takes a `Vec` of paths for one destination.

**Tech Stack:** React 18 + TypeScript, Zustand store, Vitest + @testing-library/react (jsdom). Tauri `move_files` IPC (unchanged).

**Spec:** `docs/superpowers/specs/2026-09-02-multi-select-moves-design.md`

## Global Constraints

- **No new backend command / no IPC surface added** — forward batch move is one `moveFiles(paths, targetPath)`; per-file undo reuses single-path `moveFiles` back to each file's source dir.
- **Undo stays per-file (v1):** a batch move pushes one `MoveRecord` per file; `Ctrl+Z` undoes one file per press. Every existing #5b store/undo reducer and test stays unchanged. Grouped one-press batch undo is deferred to slice 9.
- **Selection ≠ focus.** Focus (the ring) stays a single cursor and the range anchor; selection is a set with a distinct style. Arrow nav moves focus only and does not disturb an existing selection.
- **1–9 precedence:** selection non-empty → move the whole selection; else move the focused file.
- Tests gate the merge: `npm test -- --run` (frontend). Backend untouched, but `cargo test --manifest-path src-tauri/Cargo.toml` must still pass before merge.
- Selection is mouse-driven for v1: plain click = select-only, Ctrl/Cmd+click = toggle, Shift+click = contiguous range from the focus anchor, `Escape` clears. Keyboard-built selection (Space/Shift+Arrow/Ctrl+A) is deferred.

---

### Task 1: Store selection slice

**Files:**
- Modify: `src/store/useAppStore.ts` (interface + initial state + `startScan`/`reset` + 4 new actions)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: existing `files: FileInfo[]`, `focusedId: string | null`, `dirname()` helper, `MoveRecord`.
- Produces:
  - `selectedIds: string[]`
  - `selectOnly: (id: string) => void` — `selectedIds = [id]`, `focusedId = id`.
  - `toggleSelected: (id: string) => void` — add/remove `id`; `focusedId = id`.
  - `selectRangeTo: (id: string) => void` — inclusive range `files[lo..=hi]` (file order) bracketing the anchor (`focusedId ?? id`) and `id`; focus stays on the anchor.
  - `clearSelection: () => void` — `selectedIds = []`.
  - `selectedIds` is reset to `[]` by `startScan` and `reset`.

- [ ] **Step 1: Write the failing tests**

Add to `src/store/useAppStore.test.ts`:

```ts
test("selectOnly sets a single-item selection and focuses it", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], selectedIds: ["b"], focusedId: null });
  useAppStore.getState().selectOnly("a");
  expect(useAppStore.getState().selectedIds).toEqual(["a"]);
  expect(useAppStore.getState().focusedId).toBe("a");
});

test("toggleSelected adds then removes an id and updates focus", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], selectedIds: ["a"], focusedId: "a" });
  useAppStore.getState().toggleSelected("b");
  expect(useAppStore.getState().selectedIds).toEqual(["a", "b"]);
  expect(useAppStore.getState().focusedId).toBe("b");
  useAppStore.getState().toggleSelected("b");
  expect(useAppStore.getState().selectedIds).toEqual(["a"]);
});

test("selectRangeTo yields the inclusive file-order range from the anchor (both directions)", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c"), mk("d")], selectedIds: [], focusedId: "b" });
  useAppStore.getState().selectRangeTo("d");
  expect(useAppStore.getState().selectedIds).toEqual(["b", "c", "d"]);
  expect(useAppStore.getState().focusedId).toBe("b"); // anchor unchanged
  useAppStore.getState().selectRangeTo("a"); // extend the other way from the same anchor
  expect(useAppStore.getState().selectedIds).toEqual(["a", "b"]);
});

test("clearSelection empties the selection", () => {
  useAppStore.setState({ selectedIds: ["a", "b"] });
  useAppStore.getState().clearSelection();
  expect(useAppStore.getState().selectedIds).toEqual([]);
});

test("startScan and reset clear the selection", () => {
  useAppStore.setState({ selectedIds: ["a"] });
  useAppStore.getState().startScan();
  expect(useAppStore.getState().selectedIds).toEqual([]);
  useAppStore.setState({ selectedIds: ["b"] });
  useAppStore.getState().reset();
  expect(useAppStore.getState().selectedIds).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/store/useAppStore.test.ts`
Expected: FAIL — `selectedIds`/`selectOnly`/etc. undefined.

- [ ] **Step 3: Implement the selection slice**

In `src/store/useAppStore.ts` `AppState` interface, after `focusedId`, add:

```ts
  selectedIds: string[];
```

and in the actions block of the interface, after `setFocus`, add:

```ts
  selectOnly: (id: string) => void;
  toggleSelected: (id: string) => void;
  selectRangeTo: (id: string) => void;
  clearSelection: () => void;
```

In the store body, add `selectedIds: []` to the initial state object (next to `focusedId: null`). Add `selectedIds: []` to the object passed to `set(...)` inside **both** `startScan` and `reset`.

After the `setFocus` action, add:

```ts
  selectOnly: (id) => set({ selectedIds: [id], focusedId: id }),
  toggleSelected: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
      focusedId: id,
    })),
  selectRangeTo: (id) =>
    set((s) => {
      const anchorId = s.focusedId ?? id;
      const ai = s.files.findIndex((f) => f.id === anchorId);
      const bi = s.files.findIndex((f) => f.id === id);
      if (ai < 0 || bi < 0) return {};
      const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
      return {
        selectedIds: s.files.slice(lo, hi + 1).map((f) => f.id),
        focusedId: anchorId,
      };
    }),
  clearSelection: () => set({ selectedIds: [] }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/store/useAppStore.test.ts`
Expected: PASS (new tests + all existing store tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat: store selection slice (selectOnly/toggle/range/clear)"
```

---

### Task 2: Store `completeMoveMany` reducer

**Files:**
- Modify: `src/store/useAppStore.ts` (interface + one new action)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `files`, `folders`, `moveHistory`, `MoveRecord`, `dirname()`, and the existing single-record `completeUndo` (unchanged) for the reconstruction assertion.
- Produces:
  - `completeMoveMany: (ids: string[], folderId: string, toPaths: string[]) => void` — `ids`/`toPaths` order-matched (grid order). Removes all `ids` from `files`; bumps `folders[folderId].fileCount` by `ids.length`; pushes one `MoveRecord` per file; advances `focusedId` to the survivor at the **lowest** removed index (clamped); clears `selectedIds`.

**Undo-order note (correctness override of spec §5/§6 narrative):** the existing single-record `completeUndo` re-inserts at `min(fromIndex, files.length)`, so to reconstruct the exact pre-move array the popped records must be processed **lowest original index first**. Since `completeUndo` pops LIFO (from the end of `moveHistory`), `completeMoveMany` appends the records **newest-first (descending original index)** — lowest index ends up on top of the stack and is undone first. (The spec's prose says "ascending … highest-index-first"; a trace shows that mis-reconstructs — e.g. `[a,b,c,d,e]` minus `{a,c,e}` would undo to `[a,b,d,c,e]`. The reconstruction test below is the source of truth.)

- [ ] **Step 1: Write the failing test**

Add to `src/store/useAppStore.test.ts`:

```ts
test("completeMoveMany moves all selected, records N, advances focus, clears selection", () => {
  useAppStore.setState({
    files: [mk("a"), mk("b"), mk("c"), mk("d"), mk("e")],
    folders: [mkFolder("fam", 1)],
    focusedId: "a",
    selectedIds: ["a", "c", "e"],
    moveHistory: [],
  });
  useAppStore.getState().completeMoveMany(
    ["a", "c", "e"],
    "fam",
    ["C:/base/fam/a", "C:/base/fam/c", "C:/base/fam/e"],
  );
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["b", "d"]);
  expect(s.focusedId).toBe("b"); // survivor at the lowest removed slot (0)
  expect(s.folders[0].fileCount).toBe(3);
  expect(s.moveHistory).toHaveLength(3);
  expect(s.selectedIds).toEqual([]);
});

test("completeMoveMany + repeated completeUndo reconstructs the original array and order", () => {
  useAppStore.setState({
    files: [mk("a"), mk("b"), mk("c"), mk("d"), mk("e")],
    folders: [mkFolder("fam", 1)],
    focusedId: "a",
    selectedIds: ["a", "c", "e"],
    moveHistory: [],
  });
  useAppStore.getState().completeMoveMany(
    ["a", "c", "e"],
    "fam",
    ["C:/base/fam/a", "C:/base/fam/c", "C:/base/fam/e"],
  );
  useAppStore.getState().completeUndo("C:/x/a.jpg");
  useAppStore.getState().completeUndo("C:/x/c.jpg");
  useAppStore.getState().completeUndo("C:/x/e.jpg");
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["a", "b", "c", "d", "e"]);
  expect(s.folders[0].fileCount).toBe(0);
  expect(s.moveHistory).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/store/useAppStore.test.ts`
Expected: FAIL — `completeMoveMany` is not a function.

- [ ] **Step 3: Implement `completeMoveMany`**

In the `AppState` interface, after `completeMove`, add:

```ts
  completeMoveMany: (ids: string[], folderId: string, toPaths: string[]) => void;
```

In the store body, after the `completeMove` action, add:

```ts
  completeMoveMany: (ids, folderId, toPaths) =>
    set((s) => {
      const records: MoveRecord[] = ids
        .map((id, k) => {
          const fromIndex = s.files.findIndex((f) => f.id === id);
          const file = s.files[fromIndex];
          return file
            ? { file, folderId, fromDir: dirname(file.path), toPath: toPaths[k], fromIndex }
            : null;
        })
        .filter((r): r is MoveRecord => r != null)
        .sort((a, b) => a.fromIndex - b.fromIndex);
      if (records.length === 0) return {};
      const idSet = new Set(records.map((r) => r.file.id));
      const files = s.files.filter((f) => !idSet.has(f.id));
      const focusIdx = Math.min(records[0].fromIndex, files.length - 1);
      const focusedId = focusIdx >= 0 ? files[focusIdx].id : null;
      const folders = s.folders.map((f) =>
        f.id === folderId ? { ...f, fileCount: f.fileCount + records.length } : f,
      );
      // Newest-first so per-press Ctrl+Z pops the lowest index first (see plan note).
      const history = [...records].reverse();
      return {
        files,
        focusedId,
        folders,
        selectedIds: [],
        moveHistory: [...s.moveHistory, ...history],
      };
    }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run src/store/useAppStore.test.ts`
Expected: PASS (both new tests + all existing store tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat: completeMoveMany batch-move reducer (per-file undo records)"
```

---

### Task 3: FileCard modifier-aware selection + selected style

**Files:**
- Modify: `src/components/FileCard.tsx`
- Test: `src/components/FileCard.test.tsx`

**Interfaces:**
- Consumes: `selectOnly`, `toggleSelected`, `selectRangeTo` (Task 1), `openPreview`, `useThumbnail`.
- Produces: `FileCard` now accepts `selected?: boolean`; click handler routes plain/Ctrl(Cmd)/Shift clicks; a selected (unfocused) card renders a `bg-sky-500/20` + `border-sky-400` treatment that composes under the focus ring.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/FileCard.test.tsx` (the existing `file` fixture has id `x1`):

```ts
test("plain click selects only this card and focuses it", () => {
  useAppStore.setState({ files: [file], selectedIds: ["other"], focusedId: null });
  render(<FileCard file={file} focused={false} />);
  fireEvent.click(screen.getByRole("button"));
  expect(useAppStore.getState().selectedIds).toEqual(["x1"]);
  expect(useAppStore.getState().focusedId).toBe("x1");
});

test("ctrl+click toggles this card into an existing selection", () => {
  useAppStore.setState({ files: [file], selectedIds: ["other"], focusedId: null });
  render(<FileCard file={file} focused={false} />);
  fireEvent.click(screen.getByRole("button"), { ctrlKey: true });
  expect(useAppStore.getState().selectedIds).toEqual(["other", "x1"]);
});

test("shift+click selects the file-order range from the focus anchor", () => {
  const a = { ...file, id: "a" };
  const b = { ...file, id: "b" };
  const c = { ...file, id: "c" };
  useAppStore.setState({ files: [a, b, c], selectedIds: [], focusedId: "a" });
  render(<FileCard file={c} focused={false} />);
  fireEvent.click(screen.getByRole("button"), { shiftKey: true });
  expect(useAppStore.getState().selectedIds).toEqual(["a", "b", "c"]);
});

test("a selected card renders a selected style", () => {
  render(<FileCard file={file} selected />);
  expect(screen.getByRole("button").className).toContain("sky");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run src/components/FileCard.test.tsx`
Expected: FAIL — plain click currently only sets focus (no `selectedIds`); no `selected` prop / `sky` class.

- [ ] **Step 3: Implement the selection wiring + style**

Replace the body of `src/components/FileCard.tsx` with:

```tsx
import type { MouseEvent } from "react";
import type { FileInfo } from "../lib/types";
import { useThumbnail } from "../lib/useThumbnail";
import { useAppStore } from "../store/useAppStore";

export function FileCard({
  file,
  focused = false,
  selected = false,
}: {
  file: FileInfo;
  focused?: boolean;
  selected?: boolean;
}) {
  const { url, status } = useThumbnail(file);
  const selectOnly = useAppStore((s) => s.selectOnly);
  const toggleSelected = useAppStore((s) => s.toggleSelected);
  const selectRangeTo = useAppStore((s) => s.selectRangeTo);
  const openPreview = useAppStore((s) => s.openPreview);

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.shiftKey) selectRangeTo(file.id);
    else if (e.ctrlKey || e.metaKey) toggleSelected(file.id);
    else selectOnly(file.id);
  };

  const border = focused
    ? "border-blue-500 ring-2 ring-blue-500"
    : selected
      ? "border-sky-400"
      : "border-neutral-700";
  const bg = selected ? "bg-sky-500/20" : "bg-neutral-800";

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={() => openPreview(file.id)}
      className={`w-[152px] h-[150px] rounded ${bg} border overflow-hidden relative flex items-end text-left ${border}`}
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run src/components/FileCard.test.tsx`
Expected: PASS (new tests + existing focus-ring / double-click / plain-click tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/FileCard.tsx src/components/FileCard.test.tsx
git commit -m "feat: FileCard modifier-click selection + selected style"
```

---

### Task 4: FileGrid batch move + Escape-clears-selection

**Files:**
- Modify: `src/components/FileGrid.tsx`
- Test: `src/components/FileGrid.test.tsx`

**Interfaces:**
- Consumes: `completeMoveMany`, `clearSelection`, `selectedIds` (Tasks 1–2), existing `completeMove`/`completeUndo`, `moveFiles`.
- Produces: 1–9 moves the whole selection (grid order) via one `moveFiles(paths, dest)` when `selectedIds` is non-empty, else the focused file (unchanged); `Escape` clears a non-empty selection; each `FileCard` receives `selected`.

- [ ] **Step 1: Write the failing tests + widen the mock**

In `src/components/FileGrid.test.tsx`, change the `moveFiles` mock to return one path **per input** and add `selectedIds` to the `beforeEach` reset:

```ts
vi.mock("../lib/commands", () => ({
  moveFiles: vi.fn(async (paths: string[], dest: string) =>
    paths.map((p) => `${dest}/${p.split(/[\\/]/).pop()}`),
  ),
}));
```

```ts
beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ files: [], focusedId: null, previewId: null, folders: [], moveHistory: [], selectedIds: [] });
});
```

Add these tests:

```ts
test("with a selection, a mapped digit moves the whole selection (grid order) and clears it", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], folders: [fam], focusedId: "b", selectedIds: ["a", "c"] });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() =>
    expect(moveFiles).toHaveBeenCalledWith(["C:/x/a.jpg", "C:/x/c.jpg"], "C:/base/fam"),
  );
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  expect(useAppStore.getState().folders[0].fileCount).toBe(2);
  expect(useAppStore.getState().selectedIds).toEqual([]);
});

test("Escape clears a non-empty selection", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "a", previewId: null, selectedIds: ["a", "b"] });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(useAppStore.getState().selectedIds).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run src/components/FileGrid.test.tsx`
Expected: FAIL — a mapped digit currently moves only the focused file; `Escape` is unhandled.

- [ ] **Step 3: Implement selection-aware digit move + Escape + pass `selected`**

In `src/components/FileGrid.tsx`:

Add store subscriptions near the existing ones (after `completeMove`):

```ts
  const completeMoveMany = useAppStore((s) => s.completeMoveMany);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const selectedIds = useAppStore((s) => s.selectedIds);
```

In the `onKey` handler, add `selectedIds` to the destructure:

```ts
      const { files, focusedId, previewId, folders, moveHistory, selectedIds } = useAppStore.getState();
```

Immediately after the `Ctrl+Z` undo block (before `if (files.length === 0) return;`), add:

```ts
      // Clear the selection (Escape). Preview already consumed Esc via the previewId guard.
      if (e.key === "Escape") {
        if (selectedIds.length > 0) {
          e.preventDefault();
          clearSelection();
        }
        return;
      }
```

Replace the existing bare-digit block with a selection-aware version:

```ts
      // Move to target folder N (bare 1–9): the whole selection if any, else the focused file.
      if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
        const folder = folders.find((f) => f.shortcut === Number(e.key));
        if (!folder) return;
        if (selectedIds.length > 0) {
          const sel = files.filter((f) => selectedIds.includes(f.id)); // grid order
          if (sel.length > 0) {
            e.preventDefault();
            const ids = sel.map((f) => f.id);
            const paths = sel.map((f) => f.path);
            void moveFiles(paths, folder.path)
              .then((newPaths) => completeMoveMany(ids, folder.id, newPaths))
              .catch(() => {});
          }
          return;
        }
        const index = files.findIndex((f) => f.id === focusedId);
        if (index >= 0) {
          e.preventDefault();
          const path = files[index].path;
          void moveFiles([path], folder.path)
            .then(([newPath]) => completeMove(index, folder.id, newPath))
            .catch(() => {});
        }
        return;
      }
```

Add `completeMoveMany` and `clearSelection` to the keyboard `useEffect` dependency array:

```ts
  }, [setFocus, openPreview, completeMove, completeUndo, completeMoveMany, clearSelection]);
```

Pass `selected` to each card in the render:

```tsx
              {cells.map((f) => (
                <FileCard
                  key={f.id}
                  file={f}
                  focused={f.id === focusedId}
                  selected={selectedIds.includes(f.id)}
                />
              ))}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run src/components/FileGrid.test.tsx`
Expected: PASS (new batch + Escape tests, and all existing single-focus move / unmapped / Ctrl+Z / preview-guard tests still green with the widened mock).

- [ ] **Step 5: Full frontend suite + commit**

Run: `npm test -- --run`
Expected: PASS (whole suite).

```bash
git add src/components/FileGrid.tsx src/components/FileGrid.test.tsx
git commit -m "feat: FileGrid batch-move selection on 1-9 + Escape clears selection"
```

---

## Self-Review

**Spec coverage:**
- §3 store selection slice → Task 1. `completeMoveMany` → Task 2. FileCard wiring/style → Task 3. FileGrid digit/Escape/`selected` → Task 4. ✔
- §4 data model (all five signatures) → Tasks 1–2. ✔
- §5 behaviors (select, batch move, fallback) → Tasks 3–4 tests. ✔
- §6 selection semantics (anchor = focus, ascending-index records) → Task 1 `selectRangeTo` + Task 2 records; undo order corrected to guarantee exact reconstruction (documented in Task 2 note). ✔
- §7 visuals (compose selected + focus ring) → Task 3. ✔
- §9 testing (store, FileCard, FileGrid, mock returns one path per input) → all tasks. ✔
- §8 security (no new IPC) → Global Constraints; no backend touched. ✔

**Placeholder scan:** none — every step has concrete code and exact run commands.

**Type consistency:** `completeMoveMany(ids, folderId, toPaths)` signature identical in interface (Task 2), store note, and FileGrid call (Task 4). `selected?: boolean` prop consistent between FileCard (Task 3) and FileGrid pass-down (Task 4). `MoveRecord` shape reused unchanged.

**Manual acceptance (post-merge, informal):** scan → Ctrl+click three → press a target key → all three move, count +3, selection clears, focus sensible → Ctrl+Z ×3 returns them → Shift+click a run → move → Escape clears.
