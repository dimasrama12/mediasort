import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/commands", () => ({
  createFolder: vi.fn(async (_base: string, name: string) => ({
    id: name.toLowerCase(),
    name,
    path: `C:/base/${name}`,
    shortcut: 1,
    fileCount: 0,
  })),
  renameFolder: vi.fn(async (_id: string, name: string) => [
    { id: name.toLowerCase(), name, path: `C:/base/${name}`, shortcut: 1, fileCount: 0 },
  ]),
  deleteFolder: vi.fn(async (_id: string) => []),
  addExistingFolders: vi.fn(async (paths: string[]) =>
    paths.map((path, i) => ({
      id: path.toLowerCase(),
      name: path.split("/").pop()!,
      path,
      shortcut: i + 1,
      fileCount: 0,
    })),
  ),
  pickFolders: vi.fn(async () => ["C:/x", "C:/y"]),
  moveFiles: vi.fn(async (paths: string[], dest: string) =>
    paths.map((p) => `${dest}/${p.split("/").pop()}`),
  ),
  listFolderFiles: vi.fn(async () => [
    {
      id: "moved", path: "C:/base/fam/moved.jpg", name: "moved.jpg", extension: "jpg",
      size: 10, modifiedAt: 0, dateTaken: null, fileType: "image" as const, groupId: null,
    },
  ]),
  // The sidebar now owns the Trash button (with its live count), and every move re-reads the
  // folder list so the counts next to each folder are the ones on disk.
  listTrash: vi.fn(async () => []),
  listTargetFolders: vi.fn(async () => useAppStore.getState().folders),
  trashFiles: vi.fn(async () => []),
}));

import { Sidebar } from "./Sidebar";
import {
  createFolder,
  renameFolder,
  deleteFolder,
  listFolderFiles,
  addExistingFolders,
  pickFolders,
  moveFiles,
} from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import type { FileGroup, FolderInfo } from "../lib/types";

const mkFolder = (id: string, shortcut: number): FolderInfo => ({
  id,
  name: id,
  path: `C:/base/${id}`,
  shortcut,
  fileCount: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    groups: [],
    activeGroupId: null,
    browseFolder: null,
    browseFiles: [],
    draggingIds: [],
    files: [],
  });
});
afterEach(cleanup);

test("renders the 1-9 legend from the store", () => {
  useAppStore.setState({ folders: [mkFolder("fam", 1), mkFolder("work", 2)], roots: ["C:/base"] });
  render(<Sidebar />);
  expect(screen.getByText("fam")).toBeInTheDocument();
  expect(screen.getByText("work")).toBeInTheDocument();
});

test("New folder creates via command and adds it to the store", async () => {
  useAppStore.setState({ folders: [], roots: ["C:/base"] });
  render(<Sidebar />);
  fireEvent.click(screen.getByText("New folder"));
  fireEvent.change(screen.getByPlaceholderText("Folder name"), { target: { value: "Keep" } });
  fireEvent.keyDown(screen.getByPlaceholderText("Folder name"), { key: "Enter" });
  await waitFor(() => expect(createFolder).toHaveBeenCalledWith("C:/base", "Keep"));
  await waitFor(() => expect(useAppStore.getState().folders.map((f) => f.name)).toContain("Keep"));
});

test("New folder is disabled once nine folders exist", () => {
  const nine = Array.from({ length: 9 }, (_, i) => mkFolder(`f${i}`, i + 1));
  useAppStore.setState({ folders: nine, roots: ["C:/base"] });
  render(<Sidebar />);
  expect(screen.getByText("All 9 keys used")).toBeDisabled();
});

test("delete button removes the folder via command and updates the store", async () => {
  useAppStore.setState({ folders: [mkFolder("fam", 1)], roots: ["C:/base"] });
  render(<Sidebar />);
  fireEvent.click(screen.getByLabelText("Delete fam"));
  await waitFor(() => expect(deleteFolder).toHaveBeenCalledWith("fam"));
  await waitFor(() => expect(useAppStore.getState().folders).toHaveLength(0));
});

test("the rename button renames the folder via command", async () => {
  useAppStore.setState({ folders: [mkFolder("fam", 1)], roots: ["C:/base"] });
  render(<Sidebar />);
  fireEvent.click(screen.getByLabelText("Rename fam"));
  const input = screen.getByDisplayValue("fam");
  fireEvent.change(input, { target: { value: "Family" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(renameFolder).toHaveBeenCalledWith("fam", "Family"));
  await waitFor(() => expect(useAppStore.getState().folders[0].name).toBe("Family"));
});

const mkGroup = (id: string, name: string): FileGroup => ({
  id,
  name,
  fileIds: ["a", "b"],
  similarity: 92,
  timeSpan: null,
  groupType: "visual",
});

test("clicking a group narrows the view to it, and clicking it again returns to All", () => {
  useAppStore.setState({
    folders: [], roots: ["C:/base"], groups: [mkGroup("visual-1", "Group 1")], activeGroupId: null,
  });
  render(<Sidebar />);
  expect(screen.getByText("Groups (1)")).toBeTruthy();
  fireEvent.click(screen.getByText("Group 1"));
  expect(useAppStore.getState().activeGroupId).toBe("visual-1");
  fireEvent.click(screen.getByText("Group 1"));
  expect(useAppStore.getState().activeGroupId).toBeNull();
});

test("the All entry clears the active group", () => {
  useAppStore.setState({
    folders: [], roots: ["C:/base"], groups: [mkGroup("visual-1", "Group 1")], activeGroupId: "visual-1",
  });
  render(<Sidebar />);
  fireEvent.click(screen.getByText("All"));
  expect(useAppStore.getState().activeGroupId).toBeNull();
});

test("each group gets its own badge colour, cycling after seven", () => {
  const groups = Array.from({ length: 9 }, (_, i) => mkGroup(`g${i}`, `Group ${i}`));
  useAppStore.setState({ folders: [], roots: ["C:/base"], groups, activeGroupId: null });
  render(<Sidebar />);
  const dots = screen.getAllByTestId("group-color");
  expect(dots).toHaveLength(9);
  const color = (i: number) => dots[i].getAttribute("style");
  expect(color(0)).not.toBe(color(1));
  expect(color(7)).toBe(color(0)); // 7 colours, then it wraps
  expect(color(8)).toBe(color(1));
});

test("clicking a target folder browses its contents", async () => {
  useAppStore.setState({ folders: [mkFolder("fam", 1)], roots: ["C:/base"], browseFolder: null });
  render(<Sidebar />);
  fireEvent.click(screen.getByLabelText("Open fam"));
  await waitFor(() => expect(listFolderFiles).toHaveBeenCalledWith("C:/base/fam"));
  await waitFor(() => expect(useAppStore.getState().browseFolder?.id).toBe("fam"));
  expect(useAppStore.getState().browseFiles.map((f) => f.name)).toEqual(["moved.jpg"]);
});

// ------------------------------------------------------- multi-folder add + drop (§2)

const mkFile = (id: string, path: string) => ({
  id,
  path,
  name: path.split("/").pop()!,
  extension: "jpg",
  size: 10,
  modifiedAt: 0,
  dateTaken: null,
  fileType: "image" as const,
  groupId: null,
});

test("Add existing folders registers every folder returned by a multi-select pick", async () => {
  useAppStore.setState({ folders: [], roots: ["C:/base"] });
  render(<Sidebar />);
  fireEvent.click(screen.getByText("Add existing folders…"));
  await waitFor(() => expect(pickFolders).toHaveBeenCalled());
  await waitFor(() => expect(addExistingFolders).toHaveBeenCalledWith(["C:/x", "C:/y"]));
  await waitFor(() =>
    expect(useAppStore.getState().folders.map((f) => f.path)).toEqual(["C:/x", "C:/y"]),
  );
});

test("Add existing folders says so when more folders were picked than slots remain", async () => {
  const nine = Array.from({ length: 9 }, (_, i) => mkFolder(`f${i}`, i + 1));
  useAppStore.setState({ folders: nine, roots: ["C:/base"] });
  render(<Sidebar />);
  // With all nine slots used the control is disabled, so pick is never even offered.
  expect(screen.getByText("Add existing folders…").closest("button")).toBeDisabled();
});

test("dropping a dragged selection on a folder moves those files into it", async () => {
  useAppStore.setState({
    folders: [mkFolder("fam", 1)],
    roots: ["C:/base"],
    files: [mkFile("a", "C:/base/a.jpg"), mkFile("b", "C:/base/b.jpg")],
    draggingIds: ["a", "b"],
  });
  render(<Sidebar />);
  const row = screen.getByText("fam").closest("li")!;
  fireEvent.dragOver(row, { dataTransfer: { dropEffect: "" } });
  fireEvent.drop(row, { dataTransfer: {} });
  await waitFor(() =>
    expect(moveFiles).toHaveBeenCalledWith(["C:/base/a.jpg", "C:/base/b.jpg"], "C:/base/fam"),
  );
  // The grid empties and the folder's count catches up.
  await waitFor(() => expect(useAppStore.getState().files).toHaveLength(0));
  expect(useAppStore.getState().folders[0].fileCount).toBe(2);
  expect(useAppStore.getState().draggingIds).toEqual([]);
});

test("a drop with nothing being dragged does not call the backend", async () => {
  useAppStore.setState({ folders: [mkFolder("fam", 1)], roots: ["C:/base"], draggingIds: [] });
  render(<Sidebar />);
  const row = screen.getByText("fam").closest("li")!;
  fireEvent.drop(row, { dataTransfer: {} });
  await waitFor(() => expect(moveFiles).not.toHaveBeenCalled());
});

test("a drag in flight is announced by the folders, not by a banner over them", () => {
  useAppStore.setState({ folders: [mkFolder("fam", 1)], roots: ["C:/base"], draggingIds: ["a"] });
  render(<Sidebar />);
  // The "drop on a folder to move N files" strip is gone: the folder that lights up under the
  // cursor already says where the files are going, and says it in the right place.
  expect(screen.queryByText(/Drop on a folder to move/)).toBeNull();
});

test("the folder under the cursor turns solid accent, and back when the drag leaves", () => {
  useAppStore.setState({ folders: [mkFolder("fam", 1)], roots: ["C:/base"], draggingIds: ["a"] });
  render(<Sidebar />);
  const row = screen.getByRole("listitem");
  expect(row.className).not.toContain("bg-[var(--accent)]");
  fireEvent.dragOver(row, { dataTransfer: { dropEffect: "" } });
  expect(row.className).toContain("bg-[var(--accent)]");
  fireEvent.dragLeave(row);
  expect(row.className).not.toContain("bg-[var(--accent)]");
});

test("dropping onto another folder while browsing one moves the files between them (§2)", async () => {
  const inFolder = {
    id: "a", path: "C:/base/one/a.jpg", name: "a.jpg", extension: "jpg",
    size: 10, modifiedAt: 0, dateTaken: null, fileType: "image" as const, groupId: null,
  };
  const one = { id: "one", name: "One", path: "C:/base/one", shortcut: 1, fileCount: 1 };
  const two = { id: "two", name: "Two", path: "C:/base/two", shortcut: 2, fileCount: 0 };
  useAppStore.setState({
    roots: ["C:/base"],
    folders: [one, two],
    browseFolder: one,
    browseFiles: [inFolder],
    files: [],
    draggingIds: ["a"],
  });
  render(<Sidebar />);

  const row = screen.getByRole("button", { name: "Open Two" }).closest("li")!;
  fireEvent.dragOver(row, { dataTransfer: { dropEffect: "" } });
  fireEvent.drop(row, { dataTransfer: { dropEffect: "" } });

  await waitFor(() => expect(moveFiles).toHaveBeenCalledWith(["C:/base/one/a.jpg"], "C:/base/two"));
  // The file leaves the folder being browsed — the half that used to silently do nothing.
  await waitFor(() => expect(useAppStore.getState().browseFiles).toHaveLength(0));
});

test("dropping a folder onto itself is not a move", async () => {
  const one = { id: "one", name: "One", path: "C:/base/one", shortcut: 1, fileCount: 1 };
  useAppStore.setState({
    roots: ["C:/base"],
    folders: [one],
    browseFolder: one,
    browseFiles: [{
      id: "a", path: "C:/base/one/a.jpg", name: "a.jpg", extension: "jpg",
      size: 10, modifiedAt: 0, dateTaken: null, fileType: "image" as const, groupId: null,
    }],
    draggingIds: ["a"],
  });
  render(<Sidebar />);
  const row = screen.getByRole("button", { name: "Open One" }).closest("li")!;
  fireEvent.drop(row, { dataTransfer: { dropEffect: "" } });
  await waitFor(() => expect(useAppStore.getState().draggingIds).toEqual([]));
  expect(moveFiles).not.toHaveBeenCalled();
});

test("a folder's count comes from the backend listing, not a running tally", async () => {
  // The Ctrl+R bug: the sidebar showed whatever the frontend had counted since the scan, and a
  // refresh (which re-lists from a backend that tracked nothing) reset every folder to 0.
  useAppStore.setState({
    roots: ["C:/base"],
    folders: [{ id: "one", name: "One", path: "C:/base/one", shortcut: 1, fileCount: 42 }],
  });
  render(<Sidebar />);
  expect(await screen.findByTitle("42 items in this folder")).toBeTruthy();
});

// The reported bug, at the level it was reported: move a group's files out and the number beside
// that group in the sidebar keeps reading 99 until the app is refreshed. `act` is what stands in
// for "without a refresh" — the assertion runs against the same mounted tree.
test.each(["visual", "temporal", "date", "type"] as const)(
  "the group's count in the sidebar drops the moment its files are moved (%s grouping)",
  async (groupType) => {
    const files = ["a", "b", "c", "d"].map((id) => ({
      id, path: `C:/base/${id}.jpg`, name: `${id}.jpg`, extension: "jpg",
      size: 10, modifiedAt: 0, dateTaken: null, fileType: "image" as const, groupId: null,
    }));
    useAppStore.setState({ roots: ["C:/base"], folders: [], files });
    useAppStore.getState().applyGroups(
      [
        { id: "g1", name: "Group 1", fileIds: ["a", "b", "c"], similarity: 90, timeSpan: null, groupType },
        { id: "g2", name: "Group 2", fileIds: ["d"], similarity: 90, timeSpan: null, groupType },
      ],
      groupType,
    );
    render(<Sidebar />);
    const row = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
    expect(row("Group 1").textContent).toContain("3");
    expect(row("All").textContent).toContain("4");

    await act(async () => {
      useAppStore.getState().completeMoveMany(["a", "b"], "f1", ["C:/f1/a.jpg", "C:/f1/b.jpg"]);
    });
    expect(row("Group 1").textContent).toContain("1");
    expect(row("Group 2").textContent).toContain("1");
    expect(row("All").textContent).toContain("2");

    // ...and all the way to zero, where the row stays visible rather than silently vanishing.
    await act(async () => {
      useAppStore.getState().completeMoveMany(["c"], "f1", ["C:/f1/c.jpg"]);
    });
    expect(row("Group 1").textContent).toContain("0");
    expect(screen.getByText("Groups (2)")).toBeInTheDocument();
  },
);
