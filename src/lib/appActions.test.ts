import { beforeEach, expect, test, vi } from "vitest";

vi.mock("./commands", () => ({
  pickFolders: vi.fn(async () => ["D:/Pinterest"]),
  scanFolders: vi.fn(async () => {}),
  clearTargetFolders: vi.fn(async () => {}),
  cancelScan: vi.fn(async () => {}),
  loadProject: vi.fn(async () => ({})),
  adoptSession: vi.fn(async () => []),
}));
vi.mock("./useThumbnail", () => ({ clearThumbnailMemo: vi.fn() }));

import { abortScan, addScanFlow, openProject, scanFlow } from "./appActions";
import * as commands from "./commands";
import {
  adoptSession,
  cancelScan,
  clearTargetFolders,
  loadProject,
  pickFolders,
  scanFolders,
} from "./commands";
import { clearThumbnailMemo } from "./useThumbnail";
import { useAppStore } from "../store/useAppStore";

const folder = (id: string, key: string) => ({
  id,
  name: id,
  path: `D:/Screenshots/${id}`,
  key,
  keyCustom: false,
  fileCount: 12,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.getState().reset();
});

/* --------------------------------------------------------------------------------------------
 * Scanning a new root starts a new sorting session (§2).
 *
 * The target folders belong to the library they were made for: their keys point at directories
 * under the *previous* root, so carrying them into a new scan means those keys silently file
 * photos into somebody else's folders. Clearing the store was only half of it —
 * the backend registry kept holding them, so the very next Ctrl+R (which re-lists the folders
 * from the backend) brought every one of them straight back.
 * ------------------------------------------------------------------------------------------ */

test("scanning a new root clears the previous session's target folders on both sides", async () => {
  useAppStore.setState({
    roots: ["D:/Screenshots"],
    folders: [folder("Keep", "1"), folder("Toss", "2")],
    files: [],
  });

  await scanFlow();

  expect(clearTargetFolders).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState().folders).toEqual([]);
  expect(useAppStore.getState().roots).toEqual(["D:/Pinterest"]);
  expect(scanFolders).toHaveBeenCalledWith(["D:/Pinterest"]);
});

test("the backend is cleared before the scan starts, not after", async () => {
  const order: string[] = [];
  vi.mocked(clearTargetFolders).mockImplementation(async () => {
    order.push("clear");
  });
  vi.mocked(scanFolders).mockImplementation(async () => {
    order.push("scan");
  });
  await scanFlow();
  expect(order).toEqual(["clear", "scan"]);
});

test("cancelling the folder picker leaves the session completely alone", async () => {
  vi.mocked(pickFolders).mockResolvedValueOnce(null);
  useAppStore.setState({ roots: ["D:/Screenshots"], folders: [folder("Keep", "1")] });

  await scanFlow();

  expect(clearTargetFolders).not.toHaveBeenCalled();
  expect(scanFolders).not.toHaveBeenCalled();
  expect(useAppStore.getState().folders).toHaveLength(1);
  expect(useAppStore.getState().roots).toEqual(["D:/Screenshots"]);
});

test("a new scan drops cached thumbnails so a reused path cannot show the old picture", async () => {
  await scanFlow();
  expect(clearThumbnailMemo).toHaveBeenCalled();
});

test("a backend that refuses to clear does not stop the scan", async () => {
  vi.mocked(clearTargetFolders).mockRejectedValueOnce(new Error("locked"));
  await scanFlow();
  expect(scanFolders).toHaveBeenCalledWith(["D:/Pinterest"]);
});

test("abortScan asks the backend to stop, and never throws at the caller", async () => {
  await abortScan();
  expect(cancelScan).toHaveBeenCalledTimes(1);

  vi.mocked(cancelScan).mockRejectedValueOnce(new Error("no scan running"));
  await expect(abortScan()).resolves.toBeUndefined();
});

/* --------------------------------------------------------------------------------------------
 * ...but re-scanning the *same* library is not a new session.
 *
 * The backend prunes registered target folders out of the walk, which is what stops a target
 * living inside the scanned root ("random/contoh 1") handing every already-filed photo back to
 * the library grid. Clearing the registry unconditionally meant that on the one scan where the
 * exclusion mattered — the re-scan after filing — there was nothing left to exclude.
 * ------------------------------------------------------------------------------------------ */

test("re-scanning the same root keeps the target folders, so the backend can exclude them", async () => {
  vi.mocked(pickFolders).mockResolvedValueOnce(["D:/Screenshots"]);
  const keep = [folder("Keep", "1"), folder("Toss", "2")];
  useAppStore.setState({ roots: ["D:/Screenshots"], folders: keep });

  await scanFlow();

  expect(clearTargetFolders).not.toHaveBeenCalled();
  expect(useAppStore.getState().folders).toEqual(keep);
  expect(scanFolders).toHaveBeenCalledWith(["D:/Screenshots"]);
});

test("re-picking the same roots in a different order is still the same library", async () => {
  vi.mocked(pickFolders).mockResolvedValueOnce(["D:/B", "D:/A"]);
  const keep = [folder("Keep", "1")];
  useAppStore.setState({ roots: ["D:/A", "D:/B"], folders: keep });

  await scanFlow();

  expect(clearTargetFolders).not.toHaveBeenCalled();
  expect(useAppStore.getState().folders).toEqual(keep);
});

test("scanning a superset of the previous roots is a new session", async () => {
  vi.mocked(pickFolders).mockResolvedValueOnce(["D:/A", "D:/B"]);
  useAppStore.setState({ roots: ["D:/A"], folders: [folder("Keep", "1")] });

  await scanFlow();

  expect(clearTargetFolders).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState().folders).toEqual([]);
});

test("the very first scan of a session has nothing to keep and nothing to clear", async () => {
  await scanFlow();
  expect(clearTargetFolders).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState().folders).toEqual([]);
});


/* --------------------------------------------------------------------------------------------
 * Loading a project has to rebuild the *session*, not just the screen.
 *
 * `loadProject().then(loadProjectData)` filled the store and told the backend nothing, so the
 * target-folder registry stayed empty and the access scope had never heard of the roots. The
 * first folder key was refused as "outside this session's folders", and the `syncFolders` that
 * follows every move re-listed the empty registry over the sidebar — the keys were gone for the
 * rest of the run.
 * ------------------------------------------------------------------------------------------ */

const project = {
  id: "p1",
  name: "Holiday",
  savedAt: 0,
  roots: ["D:/random"],
  files: [],
  folders: [folder("Two", "2"), folder("One", "1")],
  groups: [],
};

test("loading a project re-registers its roots and target folders with the backend", async () => {
  vi.mocked(loadProject).mockResolvedValueOnce(project as never);
  const live = [folder("One", "1"), folder("Two", "2")];
  vi.mocked(adoptSession).mockResolvedValueOnce(live as never);

  await openProject("p1");

  // Folders go over in key order, so the backend hands back the same keys they were saved with.
  expect(adoptSession).toHaveBeenCalledWith(["D:/random"], [
    "D:/Screenshots/One",
    "D:/Screenshots/Two",
  ]);
  expect(useAppStore.getState().roots).toEqual(["D:/random"]);
  expect(useAppStore.getState().folders).toEqual(live);
});

test("a project whose folders the backend cannot adopt still opens", async () => {
  vi.mocked(loadProject).mockResolvedValueOnce(project as never);
  vi.mocked(adoptSession).mockRejectedValueOnce(new Error("registry locked"));

  await expect(openProject("p1")).resolves.toBeUndefined();
  // The saved list is a worse answer than the live one, and a far better answer than none.
  expect(useAppStore.getState().folders).toHaveLength(2);
});

test("a project with no target folders still adopts its roots", async () => {
  vi.mocked(loadProject).mockResolvedValueOnce({ ...project, folders: [] } as never);
  vi.mocked(adoptSession).mockResolvedValueOnce([] as never);
  await openProject("p1");
  expect(adoptSession).toHaveBeenCalledWith(["D:/random"], []);
});

/* --------------------------------------------------------------------------------------------
 * Adding a library without ending the session (§2).
 * ------------------------------------------------------------------------------------------ */
const mk = (id: string) => ({
  id,
  path: `D:/foto/${id}.jpg`,
  name: `${id}.jpg`,
  extension: "jpg",
  size: 1,
  modifiedAt: 0,
  dateTaken: null,
  fileType: "image" as const,
  groupId: null,
});

test("addScanFlow appends the root and keeps the session", async () => {
  const st = useAppStore.getState();
  st.startScan();
  st.setRoots(["D:/foto"]);
  st.addFiles([mk("a")]);
  st.setFolders([folder("fam", "1")]);
  st.finishScan(1);
  vi.mocked(commands.pickFolders).mockResolvedValueOnce(["E:/dcim"]);

  await addScanFlow();

  const s = useAppStore.getState();
  expect(s.roots).toEqual(["D:/foto", "E:/dcim"]);
  expect(s.files).toHaveLength(1);
  expect(s.folders).toHaveLength(1);
  expect(clearTargetFolders).not.toHaveBeenCalled();
  expect(scanFolders).toHaveBeenCalledWith(["E:/dcim"]);
});

test("addScanFlow scans only the roots that are new", async () => {
  const st = useAppStore.getState();
  st.setRoots(["D:/foto"]);
  vi.mocked(commands.pickFolders).mockResolvedValueOnce(["D:\\FOTO", "E:/dcim"]);

  await addScanFlow();

  // D:\FOTO is D:/foto in different clothes — same folder, already scanned.
  expect(scanFolders).toHaveBeenCalledWith(["E:/dcim"]);
  expect(useAppStore.getState().roots).toEqual(["D:/foto", "E:/dcim"]);
});

test("addScanFlow says so and scans nothing when every pick is already scanned", async () => {
  const st = useAppStore.getState();
  st.setRoots(["D:/foto"]);
  vi.mocked(commands.pickFolders).mockResolvedValueOnce(["D:/foto"]);

  await addScanFlow();

  expect(scanFolders).not.toHaveBeenCalled();
  expect(useAppStore.getState().notice).toMatch(/already/i);
  expect(useAppStore.getState().scanning).toBe(false);
});

test("addScanFlow does nothing when the picker is cancelled", async () => {
  vi.mocked(commands.pickFolders).mockResolvedValueOnce(null);
  await addScanFlow();
  expect(scanFolders).not.toHaveBeenCalled();
  expect(useAppStore.getState().scanning).toBe(false);
});

test("openProject adopts folders in key order, and a legacy project in saved order", async () => {
  vi.mocked(commands.loadProject).mockResolvedValueOnce({
    id: "p1",
    name: "P1",
    savedAt: 0,
    roots: ["D:/foto"],
    files: [],
    groups: [],
    folders: [
      { id: "c", name: "C", path: "D:/foto/c", key: "F", keyCustom: true, fileCount: 0 },
      { id: "a", name: "A", path: "D:/foto/a", key: "1", keyCustom: false, fileCount: 0 },
      { id: "b", name: "B", path: "D:/foto/b", key: "2", keyCustom: false, fileCount: 0 },
    ],
  });
  await openProject("p1");
  // "1", "2" are pool keys and sort first; the hand-set "F" is outside the pool and goes last.
  expect(adoptSession).toHaveBeenCalledWith(["D:/foto"], ["D:/foto/a", "D:/foto/b", "D:/foto/c"]);
});
