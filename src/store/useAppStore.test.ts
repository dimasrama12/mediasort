import { beforeEach, expect, test } from "vitest";
import { useAppStore } from "./useAppStore";
import type { FileGroup, FileInfo, FolderInfo, TrashItem } from "../lib/types";

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

const mkFolder = (id: string, key: string): FolderInfo => ({
  id,
  name: id,
  path: `C:/base/${id}`,
  key,
  keyCustom: false,
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

const grp = (id: string, fileIds: string[], type: "visual" | "temporal"): FileGroup => ({
  id,
  name: id,
  fileIds,
  similarity: type === "visual" ? 95 : 0,
  timeSpan: type === "temporal" ? "2021-01-01 00:00 – 2021-01-01 01:00" : null,
  groupType: type,
});

test("applyGroups stamps groupId on member files and sets groups + mode", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], groups: [], groupMode: "none" });
  useAppStore.getState().applyGroups([grp("visual-1", ["a", "c"], "visual")], "visual");
  const s = useAppStore.getState();
  expect(s.groupMode).toBe("visual");
  expect(s.groups).toHaveLength(1);
  expect(s.files.find((f) => f.id === "a")!.groupId).toBe("visual-1");
  expect(s.files.find((f) => f.id === "b")!.groupId).toBeNull();
  expect(s.files.find((f) => f.id === "c")!.groupId).toBe("visual-1");
});

test("clearGroups removes indicators and resets mode", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], groups: [], groupMode: "none" });
  useAppStore.getState().applyGroups([grp("temporal-1", ["a", "b"], "temporal")], "temporal");
  useAppStore.getState().clearGroups();
  const s = useAppStore.getState();
  expect(s.groupMode).toBe("none");
  expect(s.groups).toHaveLength(0);
  expect(s.files.every((f) => f.groupId === null)).toBe(true);
});

test("completeRename patches renamed files, moves focus, clears selection, closes panel", () => {
  useAppStore.setState({
    files: [mk("a"), mk("b")],
    focusedId: "a",
    selectedIds: ["a"],
    renameOpen: true,
  });
  const renamed: FileInfo = {
    ...mk("x"),
    id: "c:/x/photo 01.jpg",
    path: "C:/x/Photo 01.jpg",
    name: "Photo 01.jpg",
  };
  useAppStore.getState().completeRename(["a"], [renamed]);
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["c:/x/photo 01.jpg", "b"]);
  expect(s.files[0].name).toBe("Photo 01.jpg");
  expect(s.focusedId).toBe("c:/x/photo 01.jpg");
  expect(s.selectedIds).toEqual([]);
  expect(s.renameOpen).toBe(false);
});

test("setQuery sets the search query and reset clears it", () => {
  useAppStore.getState().setQuery("vac");
  expect(useAppStore.getState().query).toBe("vac");
  useAppStore.getState().reset();
  expect(useAppStore.getState().query).toBe("");
});

test("setSettings replaces settings; open/closeSettings flip the panel", () => {
  useAppStore.getState().openSettings();
  expect(useAppStore.getState().settingsOpen).toBe(true);
  useAppStore.getState().closeSettings();
  expect(useAppStore.getState().settingsOpen).toBe(false);
  const next = { ...useAppStore.getState().settings, similarityThreshold: 55 };
  useAppStore.getState().setSettings(next);
  expect(useAppStore.getState().settings.similarityThreshold).toBe(55);
});

test("loadProjectData hydrates the session and resets transient state", () => {
  useAppStore.setState({
    files: [mk("old")],
    selectedIds: ["old"],
    previewId: "old",
    projectsOpen: true,
    undoStack: [{ kind: "move", folderId: "x", moved: [{ file: mk("old"), fromIndex: 0, toPath: "y" }] }],
  });
  useAppStore.getState().loadProjectData({
    id: "p1",
    name: "Trip",
    savedAt: 1,
    roots: ["C:/x"],
    files: [mk("a"), mk("b")],
    folders: [mkFolder("fam", "1")],
    groups: [{ id: "visual-1", name: "G", fileIds: ["a"], similarity: 90, timeSpan: null, groupType: "visual" }],
  });
  const s = useAppStore.getState();
  expect(s.roots).toEqual(["C:/x"]);
  expect(s.files.map((f) => f.id)).toEqual(["a", "b"]);
  expect(s.folders[0].id).toBe("fam");
  expect(s.groups).toHaveLength(1);
  expect(s.groupMode).toBe("visual");
  expect(s.focusedId).toBe("a");
  expect(s.selectedIds).toEqual([]);
  expect(s.undoStack).toEqual([]);
  expect(s.previewId).toBeNull();
  expect(s.projectsOpen).toBe(false);
});

test("re-applying groups reassigns membership (old indicators drop off)", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], groups: [], groupMode: "none" });
  useAppStore.getState().applyGroups([grp("visual-1", ["a", "b"], "visual")], "visual");
  useAppStore.getState().applyGroups([grp("visual-1", ["b", "c"], "visual")], "visual");
  const s = useAppStore.getState();
  expect(s.files.find((f) => f.id === "a")!.groupId).toBeNull();
  expect(s.files.find((f) => f.id === "b")!.groupId).toBe("visual-1");
  expect(s.files.find((f) => f.id === "c")!.groupId).toBe("visual-1");
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

test("completeMove removes the file, advances focus, bumps count, records one undo op", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], folders: [mkFolder("fam", "1")], focusedId: "a", undoStack: [], redoStack: [] });
  useAppStore.getState().completeMove(0, "fam", "C:/base/fam/a.jpg");
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["b", "c"]);
  expect(s.focusedId).toBe("b");
  expect(s.folders[0].fileCount).toBe(1);
  expect(s.undoStack).toHaveLength(1);
  const op = s.undoStack[0];
  if (op.kind !== "move") throw new Error("expected a move op");
  expect(op.moved[0].fromIndex).toBe(0);
});

test("completeMove on the last file focuses the new last", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [mkFolder("fam", "1")], focusedId: "b", undoStack: [], redoStack: [] });
  useAppStore.getState().completeMove(1, "fam", "C:/base/fam/b.jpg");
  expect(useAppStore.getState().focusedId).toBe("a");
});

test("completeMove emptying the grid clears focus", () => {
  useAppStore.setState({ files: [mk("a")], folders: [mkFolder("fam", "1")], focusedId: "a", undoStack: [], redoStack: [] });
  useAppStore.getState().completeMove(0, "fam", "C:/base/fam/a.jpg");
  expect(useAppStore.getState().focusedId).toBeNull();
});

test("applyUndoMove re-inserts at original index, refocuses, decrements count, fills redo", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], folders: [mkFolder("fam", "1")], focusedId: "a", undoStack: [], redoStack: [] });
  useAppStore.getState().completeMove(0, "fam", "C:/base/fam/a.jpg");
  useAppStore.getState().applyUndoMove(["C:/x/a.jpg"]);
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["a", "b", "c"]);
  expect(s.files[0].path).toBe("C:/x/a.jpg");
  expect(s.focusedId).toBe("a");
  expect(s.folders[0].fileCount).toBe(0);
  expect(s.undoStack).toHaveLength(0);
  expect(s.redoStack).toHaveLength(1);
});

test("applyRedoMove re-applies an undone move and refills undo", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], folders: [mkFolder("fam", "1")], focusedId: "a", undoStack: [], redoStack: [] });
  useAppStore.getState().completeMove(0, "fam", "C:/base/fam/a.jpg");
  useAppStore.getState().applyUndoMove(["a"]);
  useAppStore.getState().applyRedoMove(["C:/base/fam/a.jpg"]);
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["b", "c"]);
  expect(s.folders[0].fileCount).toBe(1);
  expect(s.redoStack).toEqual([]);
  expect(s.undoStack).toHaveLength(1);
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
  expect(useAppStore.getState().anchorId).toBe("b"); // anchor unchanged
  expect(useAppStore.getState().focusedId).toBe("d"); // focus follows the far end
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

test("completeMoveMany moves all selected, records ONE grouped op, carries the cursor to the survivor", () => {
  useAppStore.setState({
    files: [mk("a"), mk("b"), mk("c"), mk("d"), mk("e")],
    folders: [mkFolder("fam", "1")],
    focusedId: "a",
    selectedIds: ["a", "c", "e"],
    undoStack: [],
    redoStack: [],
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
  expect(s.undoStack).toHaveLength(1);
  const op = s.undoStack[0];
  if (op.kind !== "move") throw new Error("expected a move op");
  expect(op.moved).toHaveLength(3);
  expect(s.selectedIds).toEqual(["b"]); // the survivor is selected, ready for the next keystroke
});

test("completeMoveMany + ONE applyUndoMove reconstructs the original array and order (grouped)", () => {
  useAppStore.setState({
    files: [mk("a"), mk("b"), mk("c"), mk("d"), mk("e")],
    folders: [mkFolder("fam", "1")],
    focusedId: "a",
    selectedIds: ["a", "c", "e"],
    undoStack: [],
    redoStack: [],
  });
  useAppStore.getState().completeMoveMany(
    ["a", "c", "e"],
    "fam",
    ["C:/base/fam/a", "C:/base/fam/c", "C:/base/fam/e"],
  );
  useAppStore.getState().applyUndoMove(["a", "c", "e"]); // back-paths in moved (ascending) order
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["a", "b", "c", "d", "e"]);
  expect(s.folders[0].fileCount).toBe(0);
  expect(s.undoStack).toEqual([]);
  expect(s.redoStack).toHaveLength(1);
});

test("upsertFolder replaces by id and stays sorted by key", () => {
  useAppStore.setState({ folders: [] });
  useAppStore.getState().upsertFolder(mkFolder("b", "2"));
  useAppStore.getState().upsertFolder(mkFolder("a", "1"));
  expect(useAppStore.getState().folders.map((f) => f.key)).toEqual(["1", "2"]);
  useAppStore.getState().upsertFolder({ ...mkFolder("a", "1"), fileCount: 5 });
  expect(useAppStore.getState().folders.find((f) => f.id === "a")!.fileCount).toBe(5);
  expect(useAppStore.getState().folders).toHaveLength(2);
});

test("toggleTrash / open / close flip trashOpen", () => {
  useAppStore.setState({ trashOpen: false });
  useAppStore.getState().toggleTrash();
  expect(useAppStore.getState().trashOpen).toBe(true);
  useAppStore.getState().closeTrash();
  expect(useAppStore.getState().trashOpen).toBe(false);
  useAppStore.getState().openTrash();
  expect(useAppStore.getState().trashOpen).toBe(true);
});

test("setTrashItems replaces the list", () => {
  useAppStore.getState().setTrashItems([
    { id: "t1", originalPath: "C:/x/a.jpg", trashPath: "C:/trash/t1", name: "a.jpg", size: 1, deletedAt: 2 },
  ]);
  expect(useAppStore.getState().trashItems.map((t) => t.id)).toEqual(["t1"]);
});

const mkTrash = (id: string, originalPath: string): TrashItem => ({
  id,
  originalPath,
  trashPath: `C:/trash/${id}`,
  name: originalPath,
  size: 1,
  deletedAt: 0,
});

test("completeTrash removes ids, carries the cursor to the survivor, records a trash undo op", () => {
  useAppStore.setState({
    files: [mk("a"), mk("b"), mk("c")],
    folders: [mkFolder("fam", "1")],
    focusedId: "a",
    selectedIds: ["a", "c"],
    undoStack: [],
    redoStack: [],
  });
  useAppStore.getState().completeTrash(["a", "c"], [mkTrash("t-a", "a"), mkTrash("t-c", "c")]);
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["b"]);
  expect(s.focusedId).toBe("b");
  expect(s.selectedIds).toEqual(["b"]);
  expect(s.folders[0].fileCount).toBe(0);
  expect(s.undoStack).toHaveLength(1);
  expect(s.undoStack[0].kind).toBe("trash");
});

// ---- The deletion selection jump (§1) -----------------------------------------------------
// The cursor used to be re-homed with the removed file's index in the raw `files` array. That is
// the scan order; the grid renders the *sorted* order, so trashing the second tile could drop the
// cursor a dozen tiles away. These pin the cursor to the render order the grid publishes.

test("trashing a file lands the cursor on the next file IN RENDER ORDER, not scan order", () => {
  // Scanned a..e; the grid is sorted so it renders e, d, c, b, a.
  useAppStore.setState({
    files: [mk("a"), mk("b"), mk("c"), mk("d"), mk("e")],
    visibleIds: ["e", "d", "c", "b", "a"],
    focusedId: "d",
    selectedIds: ["d"],
    undoStack: [],
    redoStack: [],
  });
  useAppStore.getState().completeTrash(["d"], [mkTrash("t-d", "d")]);
  const s = useAppStore.getState();
  // "d" is rendered 2nd, so the cursor takes the 2nd slot — now "c". The old raw-index maths
  // would have used d's scan index (3) and landed on "e".
  expect(s.focusedId).toBe("c");
  expect(s.selectedIds).toEqual(["c"]);
});

test("trashing the last file in render order steps back to the new last", () => {
  useAppStore.setState({
    files: [mk("a"), mk("b"), mk("c")],
    visibleIds: ["c", "b", "a"],
    focusedId: "a",
    selectedIds: ["a"],
    undoStack: [],
    redoStack: [],
  });
  useAppStore.getState().completeTrash(["a"], [mkTrash("t-a", "a")]);
  const s = useAppStore.getState();
  expect(s.focusedId).toBe("b");
  expect(s.selectedIds).toEqual(["b"]);
});

test("trashing every file leaves no cursor and no selection", () => {
  useAppStore.setState({
    files: [mk("a"), mk("b")],
    visibleIds: ["b", "a"],
    focusedId: "b",
    selectedIds: ["a", "b"],
    undoStack: [],
    redoStack: [],
  });
  useAppStore
    .getState()
    .completeTrash(["a", "b"], [mkTrash("t-a", "a"), mkTrash("t-b", "b")]);
  const s = useAppStore.getState();
  expect(s.focusedId).toBeNull();
  expect(s.selectedIds).toEqual([]);
});

test("moving files to a folder lands the cursor in render order too", () => {
  useAppStore.setState({
    files: [mk("a"), mk("b"), mk("c"), mk("d")],
    folders: [mkFolder("fam", "1")],
    visibleIds: ["d", "c", "b", "a"],
    focusedId: "c",
    selectedIds: ["c"],
    undoStack: [],
    redoStack: [],
  });
  useAppStore.getState().completeMoveMany(["c"], "fam", ["C:/base/fam/c"]);
  const s = useAppStore.getState();
  expect(s.focusedId).toBe("b");
  expect(s.selectedIds).toEqual(["b"]);
});

test("permanently deleting lands the cursor in render order too", () => {
  useAppStore.setState({
    files: [mk("a"), mk("b"), mk("c")],
    visibleIds: ["c", "b", "a"],
    focusedId: "c",
    selectedIds: ["c"],
    scanned: 3,
  });
  useAppStore.getState().completePermanentDelete(["c"]);
  const s = useAppStore.getState();
  expect(s.focusedId).toBe("b");
  expect(s.selectedIds).toEqual(["b"]);
});

test("emptying the trash leaves the grid cursor alone", () => {
  useAppStore.setState({
    files: [mk("a"), mk("b")],
    visibleIds: ["b", "a"],
    focusedId: "a",
    selectedIds: ["a"],
  });
  // Trash paths match nothing in the grid — nothing left the grid, so nothing should move.
  useAppStore.getState().completePermanentDelete(["C:/trash/x", "C:/trash/y"]);
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["a", "b"]);
  expect(s.focusedId).toBe("a");
  expect(s.selectedIds).toEqual(["a"]);
});

test("trashing a file puts it in the trash list at once, and undo takes it back out", () => {
  useAppStore.setState({
    files: [mk("a"), mk("b")],
    visibleIds: ["a", "b"],
    trashItems: [],
    focusedId: "a",
    selectedIds: ["a"],
    undoStack: [],
    redoStack: [],
  });
  useAppStore.getState().completeTrash(["a"], [mkTrash("t-a", "a")]);
  // The corner button's whole content is this number, so it has to be right immediately —
  // not once something else happens to re-read the trash.
  expect(useAppStore.getState().trashItems.map((i) => i.id)).toEqual(["t-a"]);

  useAppStore.getState().applyUndoTrash(["a"]);
  expect(useAppStore.getState().trashItems).toEqual([]);

  useAppStore.getState().applyRedoTrash([mkTrash("t-a2", "a")]);
  expect(useAppStore.getState().trashItems.map((i) => i.id)).toEqual(["t-a2"]);
});

test("newly trashed files go to the front of the list, where the panel shows them", () => {
  useAppStore.setState({
    files: [mk("a")],
    visibleIds: ["a"],
    trashItems: [mkTrash("older", "z")],
    undoStack: [],
    redoStack: [],
  });
  useAppStore.getState().completeTrash(["a"], [mkTrash("t-a", "a")]);
  expect(useAppStore.getState().trashItems.map((i) => i.id)).toEqual(["t-a", "older"]);
});

test("trash undo restores at original indices; redo re-trashes with fresh entries", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], focusedId: "a", selectedIds: ["a", "c"], undoStack: [], redoStack: [] });
  useAppStore.getState().completeTrash(["a", "c"], [mkTrash("t-a", "a"), mkTrash("t-c", "c")]);
  expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]);

  // Undo: a (idx 0) and c (idx 2) go back to their slots.
  useAppStore.getState().applyUndoTrash(["a", "c"]);
  let s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["a", "b", "c"]);
  expect(s.undoStack).toEqual([]);
  expect(s.redoStack).toHaveLength(1);

  // Redo: re-trash both (fresh trash ids threaded onto the op).
  useAppStore.getState().applyRedoTrash([mkTrash("t-a2", "a"), mkTrash("t-c2", "c")]);
  s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["b"]);
  expect(s.redoStack).toEqual([]);
  expect(s.undoStack).toHaveLength(1);
  const op = s.undoStack[0];
  if (op.kind !== "trash") throw new Error("expected a trash op");
  expect(op.trashed.map((t) => t.item.id)).toEqual(["t-a2", "t-c2"]);
});

test("completeRename records a rename undo op; undo reverts names; redo re-applies", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "a", selectedIds: ["a"], renameOpen: true, undoStack: [], redoStack: [] });
  const after: FileInfo = { ...mk("a"), id: "photo 01.jpg", path: "photo 01.jpg", name: "Photo 01.jpg" };
  useAppStore.getState().completeRename(["a"], [after]);
  let s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["photo 01.jpg", "b"]);
  expect(s.focusedId).toBe("photo 01.jpg");
  expect(s.renameOpen).toBe(false);
  expect(s.undoStack).toHaveLength(1);
  expect(s.undoStack[0].kind).toBe("rename");

  useAppStore.getState().applyUndoRename();
  s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["a", "b"]);
  expect(s.focusedId).toBe("a");
  expect(s.undoStack).toEqual([]);
  expect(s.redoStack).toHaveLength(1);

  useAppStore.getState().applyRedoRename();
  s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["photo 01.jpg", "b"]);
  expect(s.redoStack).toEqual([]);
  expect(s.undoStack).toHaveLength(1);
});

test("reset clears trash; startScan keeps it", () => {
  useAppStore.setState({
    trashOpen: true,
    trashItems: [{ id: "t1", originalPath: "", trashPath: "", name: "a", size: 0, deletedAt: 0 }],
  });
  useAppStore.getState().startScan();
  expect(useAppStore.getState().trashItems).toHaveLength(1);
  expect(useAppStore.getState().trashOpen).toBe(true);
  useAppStore.getState().reset();
  expect(useAppStore.getState().trashItems).toEqual([]);
  expect(useAppStore.getState().trashOpen).toBe(false);
});

test("setRoots records; startScan clears folders/history but keeps roots; reset clears roots", () => {
  useAppStore.getState().setRoots(["C:/x"]);
  useAppStore.setState({
    folders: [mkFolder("fam", "1")],
    undoStack: [{ kind: "move", folderId: "fam", moved: [{ file: mk("a"), fromIndex: 0, toPath: "C:/base/fam/a.jpg" }] }],
  });
  useAppStore.getState().startScan();
  expect(useAppStore.getState().roots).toEqual(["C:/x"]);
  expect(useAppStore.getState().folders).toEqual([]);
  expect(useAppStore.getState().undoStack).toEqual([]);
  useAppStore.getState().reset();
  expect(useAppStore.getState().roots).toEqual([]);
});

// ---------------------------------------------------------------- permanent delete (§6)

test("requestPermanentDelete captures ids/paths/names and ignores an empty selection", () => {
  useAppStore.getState().addFiles([mk("a"), mk("b")]);
  useAppStore.getState().requestPermanentDelete([]);
  expect(useAppStore.getState().pendingDelete).toBeNull();
  useAppStore.getState().requestPermanentDelete(useAppStore.getState().files);
  expect(useAppStore.getState().pendingDelete).toEqual({
    kind: "files",
    ids: ["a", "b"],
    paths: ["a", "b"],
    names: ["a", "b"],
  });
});

test("completePermanentDelete drops only the paths the backend actually deleted", () => {
  useAppStore.getState().addFiles([mk("a"), mk("b"), mk("c")]);
  useAppStore.getState().finishScan(3);
  useAppStore.getState().requestPermanentDelete(useAppStore.getState().files);
  // "b" stayed on disk (locked), so the backend reports only a and c.
  useAppStore.getState().completePermanentDelete(["a", "c"]);
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["b"]);
  expect(s.scanned).toBe(1);
  expect(s.pendingDelete).toBeNull();
  expect(s.selectedIds).toEqual(["b"]);
  expect(s.focusedId).toBe("b");
});

test("cancelPermanentDelete leaves every file where it was", () => {
  useAppStore.getState().addFiles([mk("a")]);
  useAppStore.getState().requestPermanentDelete(useAppStore.getState().files);
  useAppStore.getState().cancelPermanentDelete();
  expect(useAppStore.getState().pendingDelete).toBeNull();
  expect(useAppStore.getState().files).toHaveLength(1);
});

test("permanent delete while browsing a folder decrements that folder's count", () => {
  const folder = mkFolder("f1", "1");
  useAppStore.setState({
    folders: [{ ...folder, fileCount: 2 }],
    browseFolder: { ...folder, fileCount: 2 },
    browseFiles: [mk("x"), mk("y")],
  });
  useAppStore.getState().completePermanentDelete(["x"]);
  const s = useAppStore.getState();
  expect(s.browseFiles.map((f) => f.id)).toEqual(["y"]);
  expect(s.folders[0].fileCount).toBe(1);
});

// ------------------------------------------------------------- return to library (§1)

test("completeReturn moves browsed files back into the library under their new paths", () => {
  const folder = mkFolder("f1", "1");
  useAppStore.setState({
    files: [mk("C:/root/keep.jpg")],
    scanned: 1,
    folders: [{ ...folder, fileCount: 2 }],
    browseFolder: { ...folder, fileCount: 2 },
    browseFiles: [mk("C:/base/f1/a.jpg"), mk("C:/base/f1/b.jpg")],
  });
  useAppStore.getState().completeReturn(["C:/base/f1/a.jpg"], ["C:/root/a.jpg"]);
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.path)).toEqual(["C:/root/keep.jpg", "C:/root/a.jpg"]);
  // The id is re-minted from the new path the same way the backend would.
  expect(s.files[1].id).toBe("c:\\root\\a.jpg");
  expect(s.browseFiles.map((f) => f.id)).toEqual(["C:/base/f1/b.jpg"]);
  expect(s.folders[0].fileCount).toBe(1);
  expect(s.scanned).toBe(2);
});

test("completeReturn is a no-op when none of the ids are being browsed", () => {
  useAppStore.setState({ files: [mk("a")], browseFiles: [mk("b")] });
  useAppStore.getState().completeReturn(["nope"], ["C:/root/nope.jpg"]);
  expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["a"]);
  expect(useAppStore.getState().browseFiles.map((f) => f.id)).toEqual(["b"]);
});

// ------------------------------------------------------- rotation + drag state (§2, §3)

test("applyRotation refreshes mtime/size in both the library and the browse list", () => {
  useAppStore.setState({ files: [mk("a")], browseFiles: [mk("a")] });
  useAppStore.getState().applyRotation("a", 1700, 4242);
  expect(useAppStore.getState().files[0]).toMatchObject({ modifiedAt: 1700, size: 4242 });
  expect(useAppStore.getState().browseFiles[0]).toMatchObject({ modifiedAt: 1700, size: 4242 });
});

test("setDraggingIds carries the drag payload for the sidebar drop target", () => {
  useAppStore.getState().setDraggingIds(["a", "b"]);
  expect(useAppStore.getState().draggingIds).toEqual(["a", "b"]);
  useAppStore.getState().setDraggingIds([]);
  expect(useAppStore.getState().draggingIds).toEqual([]);
});

/* ---------------------------------------------------------------------------------------------
 * Trash selection + restore (§2)
 * ------------------------------------------------------------------------------------------- */

const trashItem = (id: string) => ({
  id,
  originalPath: `C:/x/${id}.jpg`,
  trashPath: `C:/trash/${id}`,
  name: `${id}.jpg`,
  size: 1,
  deletedAt: 0,
});

test("trash selection: single, toggle and range walk the listed order", () => {
  const st = useAppStore.getState();
  useAppStore.setState({ trashItems: [trashItem("a"), trashItem("b"), trashItem("c")] });

  st.selectTrashOnly("b");
  expect(useAppStore.getState().trashSelectedIds).toEqual(["b"]);

  st.toggleTrashSelected("c");
  expect(useAppStore.getState().trashSelectedIds).toEqual(["b", "c"]);
  st.toggleTrashSelected("c");
  expect(useAppStore.getState().trashSelectedIds).toEqual(["b"]);

  st.selectTrashOnly("a");
  st.selectTrashRangeTo("c");
  expect(useAppStore.getState().trashSelectedIds).toEqual(["a", "b", "c"]);
});

test("a trash range with a stale anchor degrades to a single item", () => {
  const st = useAppStore.getState();
  useAppStore.setState({
    trashItems: [trashItem("a"), trashItem("b")],
    trashSelectedIds: [],
    trashAnchorId: "gone",
  });
  st.selectTrashRangeTo("b");
  expect(useAppStore.getState().trashSelectedIds).toEqual(["b"]);
});

test("re-listing the trash drops ids that are no longer there", () => {
  const st = useAppStore.getState();
  useAppStore.setState({
    trashItems: [trashItem("a"), trashItem("b")],
    trashSelectedIds: ["a", "b"],
    trashAnchorId: "a",
  });
  st.setTrashItems([trashItem("b")]); // "a" was restored
  expect(useAppStore.getState().trashSelectedIds).toEqual(["b"]);
  expect(useAppStore.getState().trashAnchorId).toBeNull();
});

test("closing the trash clears its selection and any drag in flight", () => {
  const st = useAppStore.getState();
  useAppStore.setState({
    trashOpen: true,
    trashSelectedIds: ["a"],
    trashAnchorId: "a",
    draggingTrashIds: ["a"],
  });
  st.closeTrash();
  const after = useAppStore.getState();
  expect(after.trashOpen).toBe(false);
  expect(after.trashSelectedIds).toEqual([]);
  expect(after.draggingTrashIds).toEqual([]);
});

test("addRestoredFiles puts files back in the grid without duplicating them", () => {
  const st = useAppStore.getState();
  useAppStore.setState({ files: [mk("a")], scanned: 1, focusedId: null });

  st.addRestoredFiles([mk("b"), mk("c")]);
  let after = useAppStore.getState();
  expect(after.files.map((f) => f.id)).toEqual(["a", "b", "c"]);
  expect(after.scanned).toBe(3);
  expect(after.focusedId).toBe("b"); // an empty grid gains a focus

  // Restoring something already listed changes nothing.
  st.addRestoredFiles([mk("b")]);
  after = useAppStore.getState();
  expect(after.files.map((f) => f.id)).toEqual(["a", "b", "c"]);
  expect(after.scanned).toBe(3);
});

/* ---------------------------------------------------------------------------------------------
 * Refresh + modal plumbing (§1, §5, §6)
 * ------------------------------------------------------------------------------------------- */

test("setBrowseFiles swaps a folder's contents and re-homes a stale focus", () => {
  const st = useAppStore.getState();
  useAppStore.setState({
    browseFolder: { id: "fam", name: "fam", path: "C:/base/fam", key: "1", keyCustom: false, fileCount: 2 },
    browseFiles: [mk("old1"), mk("old2")],
    selectedIds: ["old1", "old2"],
    focusedId: "old1",
  });
  st.setBrowseFiles([mk("old2"), mk("new")]);
  const after = useAppStore.getState();
  expect(after.browseFolder?.id).toBe("fam"); // still browsing
  expect(after.browseFiles.map((f) => f.id)).toEqual(["old2", "new"]);
  expect(after.selectedIds).toEqual(["old2"]); // the vanished file leaves the selection
  expect(after.focusedId).toBe("old2");
});

test("setBrowseFiles on an emptied folder leaves nothing focused", () => {
  const st = useAppStore.getState();
  useAppStore.setState({ browseFiles: [mk("a")], focusedId: "a", selectedIds: ["a"] });
  st.setBrowseFiles([]);
  expect(useAppStore.getState().focusedId).toBeNull();
  expect(useAppStore.getState().selectedIds).toEqual([]);
});

test("toggleSettings flips the modal both ways", () => {
  const st = useAppStore.getState();
  useAppStore.setState({ settingsOpen: false });
  st.toggleSettings();
  expect(useAppStore.getState().settingsOpen).toBe(true);
  st.toggleSettings();
  expect(useAppStore.getState().settingsOpen).toBe(false);
});

test("opening the EXIF viewer dismisses the menu that launched it", () => {
  const st = useAppStore.getState();
  useAppStore.setState({ contextMenu: { x: 1, y: 2, fileId: "a" }, exifFileId: null });
  st.openExif("a");
  expect(useAppStore.getState().exifFileId).toBe("a");
  expect(useAppStore.getState().contextMenu).toBeNull();
  st.closeExif();
  expect(useAppStore.getState().exifFileId).toBeNull();
});

test("bumpRefresh only ever counts up", () => {
  const st = useAppStore.getState();
  useAppStore.setState({ refreshNonce: 0 });
  st.bumpRefresh();
  st.bumpRefresh();
  expect(useAppStore.getState().refreshNonce).toBe(2);
});

test("setDateGroupSort records the chosen order", () => {
  const st = useAppStore.getState();
  st.setDateGroupSort("volume");
  expect(useAppStore.getState().dateGroupSort).toBe("volume");
  st.setDateGroupSort("chronological");
  expect(useAppStore.getState().dateGroupSort).toBe("chronological");
});

/* ------------------------------------------------------------------------------------------
 * Folder-to-folder moves (§2). Files being browsed live in `browseFiles`, not `files`, so the
 * library reducer matched nothing against them and left the moved photos on screen in a folder
 * they had already left.
 * ---------------------------------------------------------------------------------------- */

test("completeMoveOut takes the files out of the browsed folder and shifts both counts", () => {
  const a = mk("a");
  const b = mk("b");
  const c = mk("c");
  useAppStore.setState({
    browseFolder: { id: "src", name: "Source", path: "C:/src", key: "1", keyCustom: false, fileCount: 3 },
    browseFiles: [a, b, c],
    folders: [
      { id: "src", name: "Source", path: "C:/src", key: "1", keyCustom: false, fileCount: 3 },
      { id: "dst", name: "Dest", path: "C:/dst", key: "2", keyCustom: false, fileCount: 7 },
    ],
    selectedIds: ["a", "b"],
    focusedId: "a",
  });

  useAppStore.getState().completeMoveOut(["a", "b"], "src", "dst");

  const s = useAppStore.getState();
  expect(s.browseFiles.map((f) => f.id)).toEqual(["c"]);
  expect(s.folders.find((f) => f.id === "src")!.fileCount).toBe(1);
  expect(s.folders.find((f) => f.id === "dst")!.fileCount).toBe(9);
  expect(s.selectedIds).toEqual(["c"]);
  expect(s.focusedId).toBe("c");
});

test("completeMoveOut leaves the scanned library untouched", () => {
  const lib = mk("lib");
  const a = mk("a");
  useAppStore.setState({
    files: [lib],
    browseFolder: { id: "src", name: "Source", path: "C:/src", key: "1", keyCustom: false, fileCount: 1 },
    browseFiles: [a],
    folders: [
      { id: "src", name: "Source", path: "C:/src", key: "1", keyCustom: false, fileCount: 1 },
      { id: "dst", name: "Dest", path: "C:/dst", key: "2", keyCustom: false, fileCount: 0 },
    ],
  });
  useAppStore.getState().completeMoveOut(["a"], "src", "dst");
  expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["lib"]);
});

test("completeMoveOut with ids that are not in the folder changes nothing", () => {
  const a = mk("a");
  useAppStore.setState({
    browseFiles: [a],
    folders: [{ id: "src", name: "S", path: "C:/s", key: "1", keyCustom: false, fileCount: 1 }],
  });
  useAppStore.getState().completeMoveOut(["nope"], "src", "dst");
  expect(useAppStore.getState().browseFiles).toHaveLength(1);
  expect(useAppStore.getState().folders[0].fileCount).toBe(1);
});

test("requestEmptyTrash stages every trashed file, and does nothing on an empty trash", () => {
  useAppStore.setState({ trashItems: [], pendingDelete: null });
  useAppStore.getState().requestEmptyTrash();
  expect(useAppStore.getState().pendingDelete).toBeNull();

  useAppStore.setState({
    trashItems: [
      { id: "t1", originalPath: "C:/x/a.jpg", trashPath: "C:/t/t1", name: "a.jpg", size: 1, deletedAt: 0 },
      { id: "t2", originalPath: "C:/x/b.jpg", trashPath: "C:/t/t2", name: "b.jpg", size: 1, deletedAt: 0 },
    ],
  });
  useAppStore.getState().requestEmptyTrash();
  expect(useAppStore.getState().pendingDelete).toEqual({
    kind: "trash",
    ids: ["t1", "t2"],
    paths: ["C:/t/t1", "C:/t/t2"],
    names: ["a.jpg", "b.jpg"],
  });
});

// ---------------------------------------------------------------------------------------------
// Real-time group counts (§1). The sidebar renders `group.fileIds.length`; these pin that number
// to the files actually in the library, on every path that takes a file out of it or puts one
// back, in every grouping mode.

const anyGrp = (id: string, fileIds: string[], groupType: FileGroup["groupType"]): FileGroup => ({
  id,
  name: id,
  fileIds,
  similarity: 0,
  timeSpan: null,
  groupType,
});

const counts = () => useAppStore.getState().groups.map((g) => g.fileIds.length);

/** Three files in group 1, one in group 2 — the shape every case below starts from. */
const seedGroups = (groupType: FileGroup["groupType"]) => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c"), mk("d")] });
  useAppStore
    .getState()
    .applyGroups(
      [anyGrp("g1", ["a", "b", "c"], groupType), anyGrp("g2", ["d"], groupType)],
      groupType,
    );
};

test.each(["visual", "temporal", "date", "type"] as const)(
  "moving files to a target folder decrements the group count live (%s grouping)",
  (groupType) => {
    seedGroups(groupType);
    expect(counts()).toEqual([3, 1]);
    useAppStore.getState().completeMoveMany(["a", "b"], "f1", ["C:/f1/a", "C:/f1/b"]);
    expect(counts()).toEqual([1, 1]);
    expect(useAppStore.getState().groups[0].fileIds).toEqual(["c"]);
  },
);

test.each(["visual", "temporal", "date", "type"] as const)(
  "emptying a group by moving all of its files reads 0, not the original count (%s grouping)",
  (groupType) => {
    seedGroups(groupType);
    useAppStore.getState().completeMoveMany(["a", "b", "c"], "f1", ["x", "y", "z"]);
    expect(counts()).toEqual([0, 1]);
    // The group stays listed at zero rather than disappearing out from under the cursor.
    expect(useAppStore.getState().groups.map((g) => g.id)).toEqual(["g1", "g2"]);
  },
);

test("a single-file move decrements the group it came from", () => {
  seedGroups("visual");
  useAppStore.getState().completeMove(1, "f1", "C:/f1/b"); // index 1 === "b"
  expect(counts()).toEqual([2, 1]);
});

test("trashing files decrements the count, and undoing it puts them back", () => {
  seedGroups("temporal");
  useAppStore.getState().completeTrash(["a", "b"], [mkTrash("t1", "a"), mkTrash("t2", "b")]);
  expect(counts()).toEqual([1, 1]);
  useAppStore.getState().applyUndoTrash(["a", "b"]);
  expect(counts()).toEqual([3, 1]);
});

test("undoing a move restores the count; redoing it drops it again", () => {
  seedGroups("date");
  useAppStore.getState().completeMoveMany(["a", "c"], "f1", ["x", "y"]);
  expect(counts()).toEqual([1, 1]);
  useAppStore.getState().applyUndoMove(["a", "c"]);
  expect(counts()).toEqual([3, 1]);
  useAppStore.getState().applyRedoMove(["x", "y"]);
  expect(counts()).toEqual([1, 1]);
});

test("permanently deleting files decrements the count", () => {
  seedGroups("type");
  // `mk` uses the id as the path, so these are the paths the backend reports back.
  useAppStore.getState().completePermanentDelete(["a", "d"]);
  expect(counts()).toEqual([2, 0]);
});

test("a group whose files were untouched keeps its identity, so the sidebar row does not re-render", () => {
  seedGroups("visual");
  const before = useAppStore.getState().groups;
  useAppStore.getState().completeMoveMany(["a"], "f1", ["x"]);
  const after = useAppStore.getState().groups;
  expect(after).not.toBe(before);
  expect(after[1]).toBe(before[1]); // g2 lost nothing — same object
});

test("counting the files out of a group never touches the scan", () => {
  seedGroups("visual");
  const { scanned } = useAppStore.getState();
  useAppStore.getState().completeMoveMany(["a", "b"], "f1", ["x", "y"]);
  const s = useAppStore.getState();
  expect(s.scanning).toBe(false); // no backend re-scan was kicked off to refresh a count
  expect(s.scanned).toBe(scanned);
});

test("returning a file from a target folder to the library puts it back in its group", () => {
  seedGroups("visual");
  const moved = useAppStore.getState().files.find((f) => f.id === "b")!;
  useAppStore.getState().completeMoveMany(["b"], "f1", ["C:/f1/b"]);
  expect(counts()).toEqual([2, 1]);
  // Come back through the folder browser, which re-mints the id from the new root path.
  useAppStore.setState({
    browseFolder: { id: "f1", name: "f1", path: "C:/f1", key: "1", keyCustom: false, fileCount: 1 },
    browseFiles: [{ ...moved, id: "C:/f1/b", path: "C:/f1/b" }],
  });
  useAppStore.getState().completeReturn(["C:/f1/b"], ["C:/root/b"]);
  expect(counts()).toEqual([3, 1]);
});

/* --------------------------------------------------------------------------------------------
 * Adding a library to a session that is already running (§2).
 *
 * `startScan` is a fresh start: it wipes files, folders, keys and history. `startAddScan` is the
 * opposite in every respect except one — the grouping goes, because a half-grouped library lies.
 * ------------------------------------------------------------------------------------------ */
test("startAddScan keeps the session and clears only the groups", () => {
  const st = useAppStore.getState();
  st.startScan();
  st.setRoots(["D:/foto"]);
  st.addFiles([mk("a"), mk("b")]);
  st.setFolders([mkFolder("fam", "1")]);
  st.applyGroups(
    [{ id: "g1", name: "G1", fileIds: ["a"], similarity: 90, timeSpan: null, groupType: "visual" }],
    "visual",
  );

  useAppStore.getState().startAddScan(["E:/dcim"]);

  const s = useAppStore.getState();
  expect(s.roots).toEqual(["D:/foto", "E:/dcim"]);
  expect(s.scanning).toBe(true);
  expect(s.files.map((f) => f.id)).toEqual(["a", "b"]);
  expect(s.folders.map((f) => f.key)).toEqual(["1"]);
  expect(s.groups).toEqual([]);
  expect(s.groupMode).toBe("none");
  expect(s.activeGroupId).toBeNull();
  expect(s.files.every((f) => f.groupId === null)).toBe(true);
});

test("startAddScan keeps the undo stack, unlike startScan", () => {
  const st = useAppStore.getState();
  st.startScan();
  st.addFiles([mk("a")]);
  st.setFolders([mkFolder("fam", "1")]);
  st.completeMove(0, "fam", "C:/base/fam/a");
  expect(useAppStore.getState().undoStack).toHaveLength(1);

  useAppStore.getState().startAddScan(["E:/dcim"]);
  expect(useAppStore.getState().undoStack).toHaveLength(1);
});

test("addFiles ignores files already in the library", () => {
  const st = useAppStore.getState();
  st.startScan();
  st.addFiles([mk("a"), mk("b")]);
  st.addFiles([mk("b"), mk("c")]); // b arrives twice: overlapping roots
  expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["a", "b", "c"]);
});

test("scanned accumulates across an added scan instead of resetting", () => {
  const st = useAppStore.getState();
  st.startScan();
  st.addFiles([mk("a"), mk("b")]);
  st.finishScan(2);
  expect(useAppStore.getState().scanned).toBe(2);

  useAppStore.getState().startAddScan(["E:/dcim"]);
  useAppStore.getState().addFiles([mk("c")]);
  useAppStore.getState().finishScan(1);
  expect(useAppStore.getState().scanned).toBe(3);
});

test("a plain startScan still resets everything", () => {
  const st = useAppStore.getState();
  st.startScan();
  st.addFiles([mk("a")]);
  st.setFolders([mkFolder("fam", "1")]);
  st.finishScan(1);

  useAppStore.getState().startScan();
  const s = useAppStore.getState();
  expect(s.files).toHaveLength(0);
  expect(s.folders).toHaveLength(0);
  expect(s.scanned).toBe(0);
});

test("a root added mid-session joins the grouping scope rather than being left out", () => {
  const st = useAppStore.getState();
  st.setRoots(["D:/foto"]);
  st.requestGroupScope("visual");
  expect(useAppStore.getState().groupRoots).toEqual(["D:/foto"]);

  useAppStore.getState().startAddScan(["E:/dcim"]);
  expect(useAppStore.getState().groupRoots).toEqual(["D:/foto", "E:/dcim"]);
});
