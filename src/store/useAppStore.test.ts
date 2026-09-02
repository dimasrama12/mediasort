import { beforeEach, expect, test } from "vitest";
import { useAppStore } from "./useAppStore";
import type { FileInfo, FolderInfo } from "../lib/types";

const mk = (id: string): FileInfo => ({
  id,
  path: id,
  name: id,
  extension: "jpg",
  size: 1,
  modifiedAt: 0,
  dateTaken: null,
  fileType: "image",
  groupId: null,
});

const mkFolder = (id: string, shortcut: number): FolderInfo => ({
  id,
  name: id,
  path: `C:/base/${id}`,
  shortcut,
  fileCount: 0,
});

beforeEach(() => useAppStore.getState().reset());

test("startScan clears files and sets scanning", () => {
  useAppStore.getState().addFiles([mk("a")]);
  useAppStore.getState().startScan();
  expect(useAppStore.getState().scanning).toBe(true);
  expect(useAppStore.getState().files).toHaveLength(0);
});

test("addFiles appends across batches; finishScan stops scanning and records total", () => {
  useAppStore.getState().startScan();
  useAppStore.getState().addFiles([mk("a"), mk("b")]);
  useAppStore.getState().addFiles([mk("c")]);
  useAppStore.getState().finishScan(3);
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["a", "b", "c"]);
  expect(s.scanning).toBe(false);
  expect(s.scanned).toBe(3);
});

test("openPreview sets and closePreview clears previewId", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], previewId: null });
  useAppStore.getState().openPreview("a");
  expect(useAppStore.getState().previewId).toBe("a");
  useAppStore.getState().closePreview();
  expect(useAppStore.getState().previewId).toBeNull();
});

test("previewNext / previewPrev move and clamp at both ends", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], previewId: "a" });
  useAppStore.getState().previewPrev(); // already first -> clamp
  expect(useAppStore.getState().previewId).toBe("a");
  useAppStore.getState().previewNext();
  expect(useAppStore.getState().previewId).toBe("b");
  useAppStore.getState().previewNext();
  expect(useAppStore.getState().previewId).toBe("c");
  useAppStore.getState().previewNext(); // already last -> clamp
  expect(useAppStore.getState().previewId).toBe("c");
});

test("reset clears previewId", () => {
  useAppStore.setState({ files: [mk("a")], previewId: "a" });
  useAppStore.getState().reset();
  expect(useAppStore.getState().previewId).toBeNull();
});

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

test("completeMove removes the file, advances focus, bumps count, records history", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], folders: [mkFolder("fam", 1)], focusedId: "a", moveHistory: [] });
  useAppStore.getState().completeMove(0, "fam", "C:/base/fam/a.jpg");
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["b", "c"]);
  expect(s.focusedId).toBe("b");
  expect(s.folders[0].fileCount).toBe(1);
  expect(s.moveHistory).toHaveLength(1);
  expect(s.moveHistory[0].fromIndex).toBe(0);
});

test("completeMove on the last file focuses the new last", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [mkFolder("fam", 1)], focusedId: "b", moveHistory: [] });
  useAppStore.getState().completeMove(1, "fam", "C:/base/fam/b.jpg");
  expect(useAppStore.getState().focusedId).toBe("a");
});

test("completeMove emptying the grid clears focus", () => {
  useAppStore.setState({ files: [mk("a")], folders: [mkFolder("fam", 1)], focusedId: "a", moveHistory: [] });
  useAppStore.getState().completeMove(0, "fam", "C:/base/fam/a.jpg");
  expect(useAppStore.getState().focusedId).toBeNull();
});

test("completeUndo re-inserts at original index, refocuses, decrements count", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], folders: [mkFolder("fam", 1)], focusedId: "a", moveHistory: [] });
  useAppStore.getState().completeMove(0, "fam", "C:/base/fam/a.jpg");
  useAppStore.getState().completeUndo("C:/x/a.jpg");
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["a", "b", "c"]);
  expect(s.focusedId).toBe("a");
  expect(s.folders[0].fileCount).toBe(0);
  expect(s.moveHistory).toHaveLength(0);
});

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

test("upsertFolder replaces by id and stays sorted by shortcut", () => {
  useAppStore.setState({ folders: [] });
  useAppStore.getState().upsertFolder(mkFolder("b", 2));
  useAppStore.getState().upsertFolder(mkFolder("a", 1));
  expect(useAppStore.getState().folders.map((f) => f.shortcut)).toEqual([1, 2]);
  useAppStore.getState().upsertFolder({ ...mkFolder("a", 1), fileCount: 5 });
  expect(useAppStore.getState().folders.find((f) => f.id === "a")!.fileCount).toBe(5);
  expect(useAppStore.getState().folders).toHaveLength(2);
});

test("setRoots records; startScan clears folders/history but keeps roots; reset clears roots", () => {
  useAppStore.getState().setRoots(["C:/x"]);
  useAppStore.setState({
    folders: [mkFolder("fam", 1)],
    moveHistory: [{ file: mk("a"), folderId: "fam", fromDir: "C:/x", toPath: "C:/base/fam/a.jpg", fromIndex: 0 }],
  });
  useAppStore.getState().startScan();
  expect(useAppStore.getState().roots).toEqual(["C:/x"]);
  expect(useAppStore.getState().folders).toEqual([]);
  expect(useAppStore.getState().moveHistory).toEqual([]);
  useAppStore.getState().reset();
  expect(useAppStore.getState().roots).toEqual([]);
});
