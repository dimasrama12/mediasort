import { beforeEach, expect, test, vi } from "vitest";

vi.mock("./commands", () => ({
  listTargetFolders: vi.fn(async () => [
    { id: "fam", name: "fam", path: "C:/base/fam", shortcut: 1, fileCount: 7 },
  ]),
  listFolderFiles: vi.fn(async () => [
    {
      id: "c:/base/fam/new.jpg",
      path: "C:/base/fam/new.jpg",
      name: "new.jpg",
      extension: "jpg",
      size: 1,
      modifiedAt: 0,
      dateTaken: null,
      fileType: "image" as const,
      groupId: null,
    },
  ]),
  listTrash: vi.fn(async () => [
    {
      id: "t1",
      originalPath: "C:/x/a.jpg",
      trashPath: "C:/trash/t1",
      name: "a.jpg",
      size: 1,
      deletedAt: 0,
    },
  ]),
  ensureThumbnail: vi.fn(async () => "asset://thumb"),
}));

import { refreshApp } from "./refresh";
import { listFolderFiles, listTargetFolders, listTrash } from "./commands";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "./types";

const mk = (id: string): FileInfo => ({
  id,
  path: `C:/x/${id}.jpg`,
  name: `${id}.jpg`,
  extension: "jpg",
  size: 1,
  modifiedAt: 0,
  dateTaken: null,
  fileType: "image",
  groupId: null,
});

const fam = { id: "fam", name: "fam", path: "C:/base/fam", shortcut: 1, fileCount: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    files: [mk("a"), mk("b")],
    scanned: 2,
    roots: ["C:/x"],
    folders: [],
    browseFolder: null,
    browseFiles: [],
    trashOpen: false,
    trashItems: [],
    selectedIds: [],
    focusedId: "a",
    refreshNonce: 0,
    contextMenu: { x: 1, y: 1, fileId: "a" },
  });
});

test("refresh keeps the scanned library intact (§5)", async () => {
  await refreshApp();
  const st = useAppStore.getState();
  expect(st.files.map((f) => f.id)).toEqual(["a", "b"]);
  expect(st.scanned).toBe(2);
  expect(st.roots).toEqual(["C:/x"]);
  expect(st.refreshNonce).toBe(1);
});

test("refresh re-reads the target folders and dismisses the context menu", async () => {
  await refreshApp();
  expect(listTargetFolders).toHaveBeenCalled();
  expect(useAppStore.getState().folders[0].fileCount).toBe(7);
  expect(useAppStore.getState().contextMenu).toBeNull();
});

test("the folder being browsed stays open, with its contents re-read", async () => {
  useAppStore.setState({ browseFolder: fam, browseFiles: [mk("old")], focusedId: "old" });
  await refreshApp();
  const st = useAppStore.getState();
  expect(st.browseFolder).toEqual(fam); // still browsing — the whole point of the change
  expect(listFolderFiles).toHaveBeenCalledWith("C:/base/fam");
  expect(st.browseFiles.map((f) => f.name)).toEqual(["new.jpg"]);
  // The old focus is gone from the folder, so it re-homes rather than pointing at nothing.
  expect(st.focusedId).toBe("c:/base/fam/new.jpg");
});

test("the trash is only re-listed while its panel is open", async () => {
  await refreshApp();
  expect(listTrash).not.toHaveBeenCalled();

  useAppStore.setState({ trashOpen: true });
  await refreshApp();
  expect(listTrash).toHaveBeenCalled();
  expect(useAppStore.getState().trashItems).toHaveLength(1);
});

test("a folder that has since been deleted doesn't sink the whole refresh", async () => {
  vi.mocked(listFolderFiles).mockRejectedValueOnce(new Error("no such directory"));
  useAppStore.setState({ browseFolder: fam, browseFiles: [mk("old")] });
  await expect(refreshApp()).resolves.toBeUndefined();
  const st = useAppStore.getState();
  expect(st.folders[0].fileCount).toBe(7); // the other reads still landed
  expect(st.browseFiles.map((f) => f.id)).toEqual(["old"]); // left as it was
  expect(st.refreshNonce).toBe(1);
});

/* ------------------------------------------------------------------------------------------
 * The Ctrl+R counter bug: refreshing re-listed the target folders from a backend that had never
 * counted anything, so every folder's count snapped back to 0 and the user lost the only record
 * of how much they had filed. The backend counts on disk now, and the refresh adopts that.
 * ---------------------------------------------------------------------------------------- */

test("a refresh replaces the folder counts with what the backend read off disk", async () => {
  useAppStore.setState({
    // A stale, optimistically-maintained count from before the refresh.
    folders: [{ id: "fam", name: "fam", path: "C:/base/fam", shortcut: 1, fileCount: 0 }],
    browseFolder: null,
    trashOpen: false,
  });

  await refreshApp();

  expect(listTargetFolders).toHaveBeenCalled();
  expect(useAppStore.getState().folders).toEqual([
    { id: "fam", name: "fam", path: "C:/base/fam", shortcut: 1, fileCount: 7 },
  ]);
});

test("a folder count survives a refresh instead of resetting to zero", async () => {
  useAppStore.setState({ folders: [], browseFolder: null, trashOpen: false });
  await refreshApp();
  const count = useAppStore.getState().folders[0]?.fileCount;
  expect(count).toBe(7);
  await refreshApp(); // ...and again: it is read every time, not accumulated
  expect(useAppStore.getState().folders[0]?.fileCount).toBe(7);
});
