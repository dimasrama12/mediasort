import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/useThumbnail", () => ({
  useThumbnail: () => ({ url: null, status: "placeholder" }),
}));

vi.mock("../lib/commands", () => ({
  revealInExplorer: vi.fn(async () => {}),
  moveFiles: vi.fn(async (paths: string[], dest: string) =>
    paths.map((p) => `${dest}/${p.split(/[\\/]/).pop()}`),
  ),
  trashFiles: vi.fn(async (paths: string[]) =>
    paths.map((p, i) => ({
      id: `t${i}`,
      originalPath: p,
      trashPath: `C:/trash/t${i}`,
      name: p.split(/[\\/]/).pop() ?? "",
      size: 1,
      deletedAt: 0,
    })),
  ),
  restoreFromTrash: vi.fn(async (_id: string, dest: string) => dest),
  // Every move now re-reads the folder list so the sidebar counts stay honest.
  listTargetFolders: vi.fn(async () => useAppStore.getState().folders),
}));

vi.mock("../lib/appActions", () => ({
  scanFlow: vi.fn(async () => {}),
  addScanFlow: vi.fn(async () => {}),
  exitApp: vi.fn(async () => {}),
}));

import { FileGrid, folderName } from "./FileGrid";
import * as appActions from "../lib/appActions";
import { moveFiles, trashFiles } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const mk = (id: string): FileInfo => ({
  id, path: `C:/x/${id}.jpg`, name: `${id}.jpg`, extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
});

const fam = { id: "fam", name: "fam", path: "C:/base/fam", key: "1", keyCustom: false, fileCount: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ files: [], focusedId: null, previewId: null, folders: [], undoStack: [], redoStack: [], selectedIds: [], visibleIds: [], anchorId: null, trashOpen: false, renameOpen: false, settingsOpen: false, projectsOpen: false, query: "", viewMode: "grid", sortBy: "name", sortDir: "asc", sidebarCollapsed: false, groups: [], activeGroupId: null, hiddenBuckets: [], browseFolder: null, browseFiles: [], searchRequested: 0, pendingDelete: null, draggingIds: [] });
});
afterEach(cleanup);

test("defaults focus to the first file on mount", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: null });
  render(<FileGrid />);
  expect(useAppStore.getState().focusedId).toBe("a");
});

test("arrows move focus when the preview is closed", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], focusedId: "a", previewId: null });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(useAppStore.getState().focusedId).toBe("b");
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(useAppStore.getState().focusedId).toBe("a");
});

test("ArrowDown jumps a full row — 9 columns with the sidebar open, 10 with it closed", () => {
  const files = Array.from({ length: 25 }, (_, i) => mk(`f${i}`));
  useAppStore.setState({ files, focusedId: "f0", sidebarCollapsed: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(useAppStore.getState().focusedId).toBe("f9");

  cleanup();
  useAppStore.setState({ focusedId: "f0", sidebarCollapsed: true });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(useAppStore.getState().focusedId).toBe("f10");
});

test("Shift+Arrow grows the selection in visible (sorted) order", () => {
  useAppStore.setState({
    files: [mk("c"), mk("a"), mk("b")], // scan order, deliberately unsorted
    focusedId: "a",
    selectedIds: [],
    anchorId: "a",
    sortBy: "name",
    sortDir: "asc",
  });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
  expect(useAppStore.getState().selectedIds).toEqual(["a", "b"]);
  fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
  expect(useAppStore.getState().selectedIds).toEqual(["a", "b", "c"]);
  // ...and shrinking back works because the anchor stayed put.
  fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true });
  expect(useAppStore.getState().selectedIds).toEqual(["a", "b"]);
});

test("Ctrl+F asks the toolbar to focus its search box", () => {
  useAppStore.setState({ files: [mk("a")], focusedId: "a", searchRequested: 0 });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "f", ctrlKey: true });
  expect(useAppStore.getState().searchRequested).toBe(1);
});

test("only the active group's files render when a group is selected", () => {
  const files = [
    { ...mk("a"), groupId: "g1" },
    { ...mk("b"), groupId: "g2" },
    { ...mk("c"), groupId: "g1" },
  ];
  const groups = [
    { id: "g1", name: "G1", fileIds: ["a", "c"], similarity: 0, timeSpan: null, groupType: "visual" as const },
    { id: "g2", name: "G2", fileIds: ["b"], similarity: 0, timeSpan: null, groupType: "visual" as const },
  ];
  useAppStore.setState({ files, groups, activeGroupId: "g2", focusedId: null });
  render(<FileGrid />);
  expect(useAppStore.getState().visibleIds).toEqual(["b"]);
});

test("\"All\" shows every file ordered group 1, then group 2, then the ungrouped", () => {
  const files = [
    { ...mk("b"), groupId: "g2" },
    { ...mk("z"), groupId: null },
    { ...mk("a"), groupId: "g1" },
  ];
  const groups = [
    { id: "g1", name: "G1", fileIds: ["a"], similarity: 0, timeSpan: null, groupType: "visual" as const },
    { id: "g2", name: "G2", fileIds: ["b"], similarity: 0, timeSpan: null, groupType: "visual" as const },
  ];
  useAppStore.setState({ files, groups, activeGroupId: null, focusedId: null });
  render(<FileGrid />);
  expect(useAppStore.getState().visibleIds).toEqual(["a", "b", "z"]);
});

test("hidden type buckets drop out of the visible set while sorting by type", () => {
  const files = [
    { ...mk("a") },
    { ...mk("b"), extension: "png", name: "b.png" },
  ];
  useAppStore.setState({ files, sortBy: "type", hiddenBuckets: ["type:png"], focusedId: null });
  render(<FileGrid />);
  expect(useAppStore.getState().visibleIds).toEqual(["a"]);
});

/* ---------------------------------------------------------------------------------------------
 * Marquee selection (§3). jsdom gives every element a 0x0 rectangle, so each test lays out the
 * tiles itself: `offsetWidth`/`offsetHeight` so the virtualizer renders rows at all, and a
 * `getBoundingClientRect` keyed on the tile's file id so the band has something to intersect.
 * ------------------------------------------------------------------------------------------- */

/** Place tile "a" at x 0-50, "b" at 60-110, "c" at 120-170, all on one 50px row. */
function layOutTiles() {
  const w = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(900);
  const h = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(700);
  const at: Record<string, [number, number]> = { a: [0, 50], b: [60, 110], c: [120, 170] };
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const id = this.dataset?.fileId;
      const [left, right] = id ? (at[id] ?? [0, 0]) : [0, 900];
      return { left, right, top: 0, bottom: 50, width: right - left, height: 50, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
    });
  return () => {
    w.mockRestore();
    h.mockRestore();
    rect.mockRestore();
  };
}

/** The scroll container the marquee handler is attached to. */
const gridEl = (container: HTMLElement) =>
  container.querySelector(".overflow-auto") as HTMLElement;

test("dragging across empty space selects the tiles the band covers", () => {
  const restore = layOutTiles();
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], selectedIds: [] });
  const { container } = render(<FileGrid />);

  const grid = gridEl(container);
  fireEvent.mouseDown(grid, { button: 0, clientX: 5, clientY: 5 });
  expect(container.querySelector("[data-testid=marquee]")).toBeNull(); // not a drag yet

  fireEvent.mouseMove(window, { clientX: 100, clientY: 40 });
  expect(container.querySelector("[data-testid=marquee]")).not.toBeNull();
  expect(useAppStore.getState().selectedIds).toEqual(["a", "b"]);

  fireEvent.mouseUp(window);
  expect(container.querySelector("[data-testid=marquee]")).toBeNull(); // band goes away
  expect(useAppStore.getState().selectedIds).toEqual(["a", "b"]); // selection stays
  restore();
});

test("the band tracks backwards drags and keeps up as it shrinks", () => {
  const restore = layOutTiles();
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], selectedIds: [] });
  const { container } = render(<FileGrid />);

  const grid = gridEl(container);
  fireEvent.mouseDown(grid, { button: 0, clientX: 165, clientY: 45 });
  fireEvent.mouseMove(window, { clientX: 5, clientY: 5 }); // up and to the left, over everything
  expect(useAppStore.getState().selectedIds).toEqual(["a", "b", "c"]);

  fireEvent.mouseMove(window, { clientX: 115, clientY: 5 }); // pull back off a and b
  expect(useAppStore.getState().selectedIds).toEqual(["c"]);
  fireEvent.mouseUp(window);
  restore();
});

test("Ctrl+drag adds to the existing selection instead of replacing it", () => {
  const restore = layOutTiles();
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], selectedIds: ["c"] });
  const { container } = render(<FileGrid />);

  fireEvent.mouseDown(gridEl(container), { button: 0, clientX: 5, clientY: 5, ctrlKey: true });
  fireEvent.mouseMove(window, { clientX: 100, clientY: 40, ctrlKey: true });
  expect(useAppStore.getState().selectedIds).toEqual(["c", "a", "b"]);
  fireEvent.mouseUp(window);
  restore();
});

test("a plain click on empty space clears the selection", () => {
  const restore = layOutTiles();
  useAppStore.setState({ files: [mk("a"), mk("b")], selectedIds: ["a", "b"] });
  const { container } = render(<FileGrid />);

  fireEvent.mouseDown(gridEl(container), { button: 0, clientX: 400, clientY: 300 });
  fireEvent.mouseUp(window);
  expect(useAppStore.getState().selectedIds).toEqual([]);
  restore();
});

test("a press on a tile starts no band — that gesture is a drag-to-folder", () => {
  const restore = layOutTiles();
  useAppStore.setState({ files: [mk("a"), mk("b")], selectedIds: ["b"] });
  const { container } = render(<FileGrid />);

  const tile = container.querySelector("[data-file-id=a]") as HTMLElement;
  fireEvent.mouseDown(tile, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.mouseMove(window, { clientX: 100, clientY: 40 });
  expect(container.querySelector("[data-testid=marquee]")).toBeNull();
  expect(useAppStore.getState().selectedIds).toEqual(["b"]); // untouched by the gesture
  fireEvent.mouseUp(window);
  restore();
});

test("a right-click press never starts a band (it opens the menu)", () => {
  const restore = layOutTiles();
  useAppStore.setState({ files: [mk("a"), mk("b")], selectedIds: [] });
  const { container } = render(<FileGrid />);

  fireEvent.mouseDown(gridEl(container), { button: 2, clientX: 5, clientY: 5 });
  fireEvent.mouseMove(window, { clientX: 100, clientY: 40 });
  expect(container.querySelector("[data-testid=marquee]")).toBeNull();
  restore();
});

test("Space no longer opens the preview (\u00a71 removed the binding)", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "b", previewId: null });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: " " });
  expect(useAppStore.getState().previewId).toBeNull();
});

test("arrows are inert while the preview is open", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "a", previewId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(useAppStore.getState().focusedId).toBe("a");
});

test("a mapped digit moves the focused file to that folder", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], folders: [fam], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() => expect(moveFiles).toHaveBeenCalledWith(["C:/x/a.jpg"], "C:/base/fam"));
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b", "c"]));
  expect(useAppStore.getState().focusedId).toBe("b");
  expect(useAppStore.getState().folders[0].fileCount).toBe(1);
});

test("an unmapped digit does nothing", () => {
  useAppStore.setState({ files: [mk("a")], folders: [], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "5" });
  expect(moveFiles).not.toHaveBeenCalled();
  expect(useAppStore.getState().files).toHaveLength(1);
});

test("Ctrl+Z moves the last-moved file back", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [fam], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["a", "b"]));
  expect(useAppStore.getState().focusedId).toBe("a");
});

test("Ctrl+Y redoes an undone move", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [fam], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["a", "b"]));
  fireEvent.keyDown(window, { key: "y", ctrlKey: true });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  expect(useAppStore.getState().redoStack).toHaveLength(0);
  expect(useAppStore.getState().undoStack).toHaveLength(1);
});

test("with a selection, a mapped digit moves the whole selection (grid order) and lands on the survivor", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], folders: [fam], focusedId: "b", selectedIds: ["a", "c"] });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() =>
    expect(moveFiles).toHaveBeenCalledWith(["C:/x/a.jpg", "C:/x/c.jpg"], "C:/base/fam"),
  );
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  expect(useAppStore.getState().folders[0].fileCount).toBe(2);
  // The survivor takes the cursor and the selection, so the next digit files it straight away.
  expect(useAppStore.getState().selectedIds).toEqual(["b"]);
});

test("Escape clears a non-empty selection", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "a", previewId: null, selectedIds: ["a", "b"] });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(useAppStore.getState().selectedIds).toEqual([]);
});

test("Del trashes the selection and removes those files", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], focusedId: "b", selectedIds: ["a", "c"], trashOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Delete" });
  await waitFor(() => expect(trashFiles).toHaveBeenCalledWith(["C:/x/a.jpg", "C:/x/c.jpg"]));
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  // The survivor takes the cursor and the selection, so a second Del bins it straight away.
  expect(useAppStore.getState().selectedIds).toEqual(["b"]);
});

test("Del with no selection trashes the focused file", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "a", selectedIds: [], trashOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Delete" });
  await waitFor(() => expect(trashFiles).toHaveBeenCalledWith(["C:/x/a.jpg"]));
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
});

test("Ctrl+Z after Del restores the trashed file (undoable trash)", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "a", selectedIds: [], trashOpen: false, undoStack: [], redoStack: [] });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Delete" });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["a", "b"]));
});

test("T toggles the trash panel (works with an empty grid)", () => {
  useAppStore.setState({ files: [], focusedId: null, trashOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "t" });
  expect(useAppStore.getState().trashOpen).toBe(true);
});

test("grid keys are inert while the trash panel is open", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [fam], focusedId: "a", selectedIds: [], trashOpen: true });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  expect(moveFiles).not.toHaveBeenCalled();
});

test("digits are inert while the preview is open", () => {
  useAppStore.setState({ files: [mk("a")], folders: [fam], focusedId: "a", previewId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  expect(moveFiles).not.toHaveBeenCalled();
});

test("search narrows keyboard navigation to the visible files", () => {
  useAppStore.setState({
    files: [
      { ...mk("a"), name: "keep-1.jpg" },
      { ...mk("b"), name: "skip.jpg" },
      { ...mk("c"), name: "keep-2.jpg" },
    ],
    focusedId: "a",
    query: "keep",
  });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(useAppStore.getState().focusedId).toBe("c"); // skipped the hidden "skip.jpg"
});

test("Shift+R opens the rename panel when files exist (default binding)", () => {
  useAppStore.setState({ files: [mk("a")], focusedId: "a", renameOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "R", shiftKey: true });
  expect(useAppStore.getState().renameOpen).toBe(true);
});

test("bare R does nothing in the grid (rotate is preview-only)", () => {
  useAppStore.setState({ files: [mk("a")], focusedId: "a", renameOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "r" });
  expect(useAppStore.getState().renameOpen).toBe(false);
});

test("B trashes the focused file (default trash alias)", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "a", selectedIds: [], trashOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "b" });
  await waitFor(() => expect(trashFiles).toHaveBeenCalledWith(["C:/x/a.jpg"]));
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
});

test("Ctrl+A selects every visible file", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], focusedId: "a", selectedIds: [] });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "a", ctrlKey: true });
  expect(useAppStore.getState().selectedIds).toEqual(["a", "b", "c"]);
});

test("] switches to list view and [ back to grid (per spec)", () => {
  useAppStore.setState({ files: [mk("a")], focusedId: "a", viewMode: "grid" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "]" });
  expect(useAppStore.getState().viewMode).toBe("list");
  fireEvent.keyDown(window, { key: "[" });
  expect(useAppStore.getState().viewMode).toBe("grid");
});

test("Ctrl+, opens settings", () => {
  useAppStore.setState({ files: [], settingsOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: ",", ctrlKey: true });
  expect(useAppStore.getState().settingsOpen).toBe(true);
});

test("Ctrl+H toggles the sidebar", () => {
  useAppStore.setState({ files: [], sidebarCollapsed: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "h", ctrlKey: true });
  expect(useAppStore.getState().sidebarCollapsed).toBe(true);
});

test("grid keys are inert while the rename panel is open", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [fam], focusedId: "a", renameOpen: true });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  expect(moveFiles).not.toHaveBeenCalled();
});

// ---------------------------------------------- new shortcuts + drag source (§1, §2, §6)

test("Shift+Delete opens the permanent-delete confirmation instead of trashing", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], selectedIds: ["a", "b"], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Delete", shiftKey: true });
  expect(useAppStore.getState().pendingDelete).toEqual({
    kind: "files",
    ids: ["a", "b"],
    paths: ["C:/x/a.jpg", "C:/x/b.jpg"],
    names: ["a.jpg", "b.jpg"],
  });
  expect(trashFiles).not.toHaveBeenCalled();
});

test("Shift+Delete falls back to the focused file when nothing is selected", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], selectedIds: [], focusedId: "b" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Delete", shiftKey: true });
  expect(useAppStore.getState().pendingDelete!.ids).toEqual(["b"]);
});

test("a pending confirmation owns the keyboard", () => {
  useAppStore.setState({
    files: [mk("a")],
    selectedIds: ["a"],
    focusedId: "a",
    pendingDelete: { ids: ["a"], paths: ["C:/x/a.jpg"], names: ["a.jpg"], kind: "files" },
  });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Delete" });
  expect(trashFiles).not.toHaveBeenCalled();
});

test("the backtick returns the selected files to the library while browsing a folder", async () => {
  useAppStore.setState({
    roots: ["C:/base"],
    folders: [{ ...fam, fileCount: 1 }],
    browseFolder: { ...fam, fileCount: 1 },
    browseFiles: [mk("a")],
    selectedIds: ["a"],
    focusedId: "a",
  });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "`" });
  await waitFor(() => expect(moveFiles).toHaveBeenCalledWith(["C:/x/a.jpg"], "C:/base"));
  await waitFor(() => expect(useAppStore.getState().browseFiles).toHaveLength(0));
  expect(useAppStore.getState().files.map((f) => f.path)).toEqual(["C:/base/a.jpg"]);
});

test("the backtick does nothing in the library, where files are already home", () => {
  useAppStore.setState({ roots: ["C:/base"], files: [mk("a")], selectedIds: ["a"], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "`" });
  expect(moveFiles).not.toHaveBeenCalled();
});

test("dragging an unselected tile selects it, dragging a selected one takes the whole selection", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], selectedIds: ["a", "b"] });
  // jsdom reports every element as 0x0, and the virtualizer sizes its viewport from
  // offsetWidth/offsetHeight — so without this it renders no rows at all.
  const w = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(900);
  const h = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(700);
  const { container } = render(<FileGrid />);
  const tiles = container.querySelectorAll("[draggable]");
  expect(tiles.length).toBe(3);
  const dt = { effectAllowed: "", setData: vi.fn() };
  fireEvent.dragStart(tiles[0], { dataTransfer: dt });
  expect(useAppStore.getState().draggingIds).toEqual(["a", "b"]);
  fireEvent.dragEnd(tiles[0], { dataTransfer: dt });
  expect(useAppStore.getState().draggingIds).toEqual([]);
  fireEvent.dragStart(tiles[2], { dataTransfer: dt });
  expect(useAppStore.getState().selectedIds).toEqual(["c"]);
  expect(useAppStore.getState().draggingIds).toEqual(["c"]);
  w.mockRestore();
  h.mockRestore();
});

/* ------------------------------------------------------------------------------------------
 * Selection counter, keyboard preview, and keyboard folder-to-folder filing (§2, §4).
 * ---------------------------------------------------------------------------------------- */

test("the selection counter says how many files the next keystroke will act on (§4)", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], selectedIds: [] });
  const { rerender } = render(<FileGrid />);
  expect(screen.queryByText(/items selected/i)).toBeNull();

  useAppStore.setState({ selectedIds: ["a", "b"] });
  rerender(<FileGrid />);
  expect(screen.getByText("2 items selected")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /clear/i }));
  expect(useAppStore.getState().selectedIds).toEqual([]);
});

test("Enter opens the focused file in the preview", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "b", previewId: null });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Enter" });
  expect(useAppStore.getState().previewId).toBe("b");
});

test("a digit files the selection into another target folder while browsing one (§2)", async () => {
  const inFolder = { ...mk("a"), path: "C:/base/one/a.jpg" };
  const one = { id: "one", name: "One", path: "C:/base/one", key: "1", keyCustom: false, fileCount: 1 };
  const two = { id: "two", name: "Two", path: "C:/base/two", key: "2", keyCustom: false, fileCount: 0 };
  useAppStore.setState({
    files: [],
    folders: [one, two],
    browseFolder: one,
    browseFiles: [inFolder],
    selectedIds: ["a"],
    focusedId: "a",
  });
  render(<FileGrid />);

  fireEvent.keyDown(window, { key: "2" });
  await waitFor(() => expect(moveFiles).toHaveBeenCalledWith(["C:/base/one/a.jpg"], "C:/base/two"));
  await waitFor(() => expect(useAppStore.getState().browseFiles).toHaveLength(0));
});

test("pressing the digit of the folder you are already inside does nothing", () => {
  const one = { id: "one", name: "One", path: "C:/base/one", key: "1", keyCustom: false, fileCount: 1 };
  useAppStore.setState({
    files: [],
    folders: [one],
    browseFolder: one,
    browseFiles: [{ ...mk("a"), path: "C:/base/one/a.jpg" }],
    selectedIds: ["a"],
    focusedId: "a",
  });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  expect(moveFiles).not.toHaveBeenCalled();
});

test("the grid exposes grid semantics and marks what is selected", () => {
  const restore = layOutTiles(); // the rows are virtualized; jsdom needs the geometry faked
  useAppStore.setState({ files: [mk("a"), mk("b")], selectedIds: ["b"] });
  const { container } = render(<FileGrid />);
  // A screen reader was told nothing at all before this: a long undifferentiated run of buttons,
  // with no way to know which of them were picked.
  expect(screen.getByRole("grid").getAttribute("aria-multiselectable")).toBe("true");
  // Queried through the DOM rather than the a11y tree: the rows are virtualized, so which of
  // them exist at any moment depends on a layout jsdom does not perform.
  const cells = [...container.querySelectorAll("[role=gridcell]")];
  expect(cells.length).toBeGreaterThan(0);
  for (const cell of cells) {
    const id = (cell as HTMLElement).dataset.fileId;
    expect(cell.getAttribute("aria-selected")).toBe(String(id === "b"));
  }
  restore();
});

/* ------------------------------------------------------------------------------------------
 * The folder header (§6). The name, the count and the total size used to live in the top-right
 * corner of the toolbar — diagonally opposite the first tile they were describing.
 * ---------------------------------------------------------------------------------------- */

test("folderName takes the last segment of a path, either slash", () => {
  expect(folderName("D:\\photos\\contoh 2")).toBe("contoh 2");
  expect(folderName("D:\\photos\\contoh 2\\")).toBe("contoh 2");
  expect(folderName("C:/base/fam")).toBe("fam");
  expect(folderName("C:/base/fam/")).toBe("fam");
});

test("the header names the scanned folder and totals what is in it", () => {
  const big = { ...mk("a"), size: 10 * 1024 * 1024 };
  const small = { ...mk("b"), size: 9 * 1024 * 1024 };
  useAppStore.setState({ files: [big, small], roots: ["D:/photos/contoh 2"], scanned: 2 });
  render(<FileGrid />);
  const header = screen.getByText("contoh 2").parentElement!;
  expect(header.textContent).toContain("2 items");
  expect(header.textContent).toContain("19 MB");
});

test("a filter says how many of how many, so the folder total is never lost", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], roots: ["C:/base"], query: "a" });
  render(<FileGrid />);
  expect(screen.getByText("1 of 3 items")).toBeTruthy();
});

test("browsing a target folder re-points the same header at that folder", () => {
  useAppStore.setState({
    files: [mk("a")],
    roots: ["C:/base"],
    browseFolder: fam,
    browseFiles: [mk("z"), mk("y")],
  });
  render(<FileGrid />);
  expect(screen.getByText("fam")).toBeTruthy();
  expect(screen.getByText("2 items")).toBeTruthy();
  // ...and the way back out is still on it.
  expect(screen.getByRole("button", { name: /back to library/i })).toBeTruthy();
});

test("with nothing scanned there is no header to show", () => {
  useAppStore.setState({ files: [], roots: [], browseFolder: null });
  render(<FileGrid />);
  expect(screen.queryByText("📂")).toBeNull();
});

/* --------------------------------------------------------------------------------------------
 * A move that fails must say so (§ "fails silently").
 *
 * `void moveToFolder(...).catch(() => {})` discarded every error the backend could raise — a path
 * outside the session's folders, a locked file, a full disk. The grid kept the file, the folder
 * count never moved, and nothing on screen changed, so the shortcut read as simply not working.
 * ------------------------------------------------------------------------------------------ */

test("a move the backend refuses is reported instead of vanishing", async () => {
  vi.mocked(moveFiles).mockRejectedValueOnce(new Error("outside this session's folders"));
  useAppStore.setState({ files: [mk("a")], folders: [fam], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });

  expect(await screen.findByRole("alert")).toHaveTextContent(/outside this session's folders/);
  // ...and the file is still in the grid, because it is still on disk.
  expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["a"]);
});

test("the next successful move clears the failure notice", async () => {
  vi.mocked(moveFiles).mockRejectedValueOnce(new Error("locked"));
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [fam], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  expect(await screen.findByRole("alert")).toBeDefined();

  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

/* ---------------------------------------------- folder keys beyond the digits, and the blue + */

test("a folder's custom key files the focused file into it", async () => {
  const lama = { id: "lama", name: "Foto Lama", path: "C:/base/lama", key: "F", keyCustom: true, fileCount: 0 };
  useAppStore.setState({ files: [mk("a")], folders: [lama], focusedId: "a", selectedIds: [] });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "f" }); // lower case: normalizeKey upper-cases it
  await waitFor(() => expect(moveFiles).toHaveBeenCalledWith(["C:/x/a.jpg"], "C:/base/lama"));
});

test("digits still file, so nothing regressed for existing users", async () => {
  useAppStore.setState({ files: [mk("a")], folders: [fam], focusedId: "a", selectedIds: [] });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() => expect(moveFiles).toHaveBeenCalledWith(["C:/x/a.jpg"], "C:/base/fam"));
});

test("an app shortcut wins over a folder that was somehow given the same key", async () => {
  // The registry should never allow this, but the grid must not depend on that being true.
  const bad = { id: "bad", name: "Bad", path: "C:/base/bad", key: "T", keyCustom: true, fileCount: 0 };
  useAppStore.setState({ files: [mk("a")], folders: [bad], focusedId: "a", selectedIds: [] });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "t" }); // T = open trash
  expect(useAppStore.getState().trashOpen).toBe(true);
  expect(moveFiles).not.toHaveBeenCalled();
});

test("a keyless folder is never matched", async () => {
  const none = { id: "none", name: "None", path: "C:/base/none", key: "", keyCustom: false, fileCount: 0 };
  useAppStore.setState({ files: [mk("a")], folders: [none], focusedId: "a", selectedIds: [] });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Dead" });
  expect(moveFiles).not.toHaveBeenCalled();
});

test("Ctrl+Shift+O adds a folder to the scan", async () => {
  useAppStore.setState({ files: [mk("a")], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "O", ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(appActions.addScanFlow).toHaveBeenCalled());
});

test("the blue + adds a folder to the scan and hides while scanning", async () => {
  render(<FileGrid />);
  fireEvent.click(screen.getByRole("button", { name: /add folder to the scan/i }));
  expect(appActions.addScanFlow).toHaveBeenCalled();

  act(() => useAppStore.setState({ scanning: true }));
  expect(screen.queryByRole("button", { name: /add folder to the scan/i })).toBeNull();
});

test("the selection bar names the keys that exist, not a fixed 1-9 range", () => {
  const lama = { id: "lama", name: "Foto Lama", path: "C:/base/lama", key: "F", keyCustom: true, fileCount: 0 };
  useAppStore.setState({
    files: [mk("a")],
    folders: [fam, lama],
    focusedId: "a",
    selectedIds: ["a"],
  });
  render(<FileGrid />);
  const bar = screen.getByRole("status");
  expect(bar.textContent).toContain("1");
  expect(bar.textContent).toContain("F");
  expect(bar.textContent).toContain("to file them");
});

test("the selection bar offers no key hint when no folder has a key", () => {
  const none = { id: "none", name: "None", path: "C:/base/none", key: "", keyCustom: false, fileCount: 0 };
  useAppStore.setState({
    files: [mk("a")],
    folders: [none],
    focusedId: "a",
    selectedIds: ["a"],
  });
  render(<FileGrid />);
  expect(screen.getByRole("status").textContent).not.toContain("to file them");
});
