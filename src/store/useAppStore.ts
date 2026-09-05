import { create } from "zustand";
import type { StateCreator } from "zustand";
import type {
  AppSettings,
  FileGroup,
  FileInfo,
  FolderInfo,
  Project,
  TrashItem,
} from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";
import { normalizePath } from "../lib/paths";
import { focusAfterRemoval } from "../lib/afterRemoval";
import { syncGroupMembership } from "../lib/groupMembership";
import type { SortBy, SortDir } from "../lib/sort";

export type GroupMode = "none" | "visual" | "temporal" | "date" | "type";
/** How the Date groups are ordered: oldest→newest, or most files first (§4). */
export type DateGroupSort = "chronological" | "volume";
export type ViewMode = "grid" | "list";

interface MovedFile {
  file: FileInfo; // as it was BEFORE the move (path = source path)
  fromIndex: number; // its index in `files` before removal
  toPath: string; // where it landed
}

interface TrashedFile {
  file: FileInfo; // as it was before being trashed
  fromIndex: number; // its index in `files` before removal
  item: TrashItem; // the trash entry (id + originalPath) needed to restore it
}

interface RenamedFile {
  before: FileInfo; // the file before the rename
  after: FileInfo; // the same file after (new path/name/id)
  fromIndex: number; // its index in `files` at rename time
}

/** A grouped, reversible operation on the undo/redo stacks (move / trash / rename). */
export type HistoryOp =
  | { kind: "move"; folderId: string; moved: MovedFile[] }
  | { kind: "trash"; trashed: TrashedFile[] }
  | { kind: "rename"; renamed: RenamedFile[] };

interface AppState {
  files: FileInfo[];
  scanning: boolean;
  scanned: number;
  /** True while a grouping run is in flight. Lives in the store (not the Toolbar) so the
   *  window-level Esc handler can see it and abort without reaching into a component. */
  grouping: boolean;
  /** Live hashing progress for the active grouping run; null when nothing is running. */
  groupProgress: { done: number; total: number } | null;
  previewId: string | null;
  focusedId: string | null;
  selectedIds: string[];
  /** The ids the grid is actually rendering, in render order (filter → sort → group view).
   *  Every range/extend selection walks this, so selection always matches what you see (§4). */
  visibleIds: string[];
  /** Where the current range selection started; Shift+click and Shift+Arrow extend from here. */
  anchorId: string | null;
  folders: FolderInfo[];
  roots: string[];
  undoStack: HistoryOp[];
  redoStack: HistoryOp[];
  trashOpen: boolean;
  trashItems: TrashItem[];
  /** Trash ids the user has picked, for the panel's Restore button and its drag-out (§2). */
  trashSelectedIds: string[];
  /** Where a Shift+click range inside the Trash started. */
  trashAnchorId: string | null;
  /** Trash ids currently being dragged toward the grid; [] when no trash drag is in flight. */
  draggingTrashIds: string[];
  groups: FileGroup[];
  groupMode: GroupMode;
  /** null = "All" (every file, ordered group 1, 2, 3…); otherwise only that group (§5). */
  activeGroupId: string | null;
  /** Order of the Date groups: chronological (default) or biggest-day-first (§4). */
  dateGroupSort: DateGroupSort;
  /** Namespaced bucket keys hidden from the grid, e.g. "type:png" (§5). */
  hiddenBuckets: string[];
  query: string;
  renameOpen: boolean;
  /** File whose name the single-file rename dialog is editing, or null. */
  renameFileId: string | null;
  settings: AppSettings;
  settingsOpen: boolean;
  projectsOpen: boolean;
  viewMode: ViewMode;
  sortBy: SortBy;
  sortDir: SortDir;
  sidebarCollapsed: boolean;
  /** The target folder whose contents are being browsed, or null for the scanned library (§3). */
  browseFolder: FolderInfo | null;
  browseFiles: FileInfo[];
  /** File ids currently being dragged onto a sidebar folder; [] when no drag is in flight. */
  draggingIds: string[];
  /** Pending irreversible deletion awaiting confirmation. `kind` says which one:
   *  `"files"` = Shift+Delete on a selection, `"trash"` = Empty Trash. Emptying the trash is
   *  strictly *more* destructive than deleting one file, and used to be a single unguarded
   *  click; both now go through the same dialog. */
  pendingDelete: {
    ids: string[];
    paths: string[];
    names: string[];
    kind: "files" | "trash";
  } | null;
  /** Right-click menu position + the file it was opened on (null = closed) (§5). */
  contextMenu: { x: number; y: number; fileId: string | null } | null;
  /** File whose EXIF metadata the viewer is showing (§6); null = closed. */
  exifFileId: string | null;
  newFolderRequested: number; // bumped to ask the Sidebar to open its "new folder" input (Ctrl+N)
  searchRequested: number; // bumped to ask the Toolbar to focus its search box (Ctrl+F)
  refreshNonce: number; // bumped by Ctrl+R so views re-read what they derive from disk (§5)
  /** The one thing that went wrong that the user has not seen yet, or null. */
  notice: string | null;
  startScan: () => void;
  addFiles: (batch: FileInfo[]) => void;
  finishScan: (total: number) => void;
  reset: () => void;
  openPreview: (id: string) => void;
  closePreview: () => void;
  previewNext: () => void;
  previewPrev: () => void;
  setFocus: (id: string | null) => void;
  selectOnly: (id: string) => void;
  toggleSelected: (id: string) => void;
  selectRangeTo: (id: string) => void;
  setVisibleIds: (ids: string[]) => void;
  clearSelection: () => void;
  setRoots: (roots: string[]) => void;
  setFolders: (folders: FolderInfo[]) => void;
  upsertFolder: (f: FolderInfo) => void;
  completeMove: (index: number, folderId: string, toPath: string) => void;
  completeMoveMany: (ids: string[], folderId: string, toPaths: string[]) => void;
  applyUndoMove: (backPaths: string[]) => void;
  applyRedoMove: (newPaths: string[]) => void;
  applyUndoTrash: (restoredPaths: string[]) => void;
  applyRedoTrash: (items: TrashItem[]) => void;
  applyUndoRename: () => void;
  applyRedoRename: () => void;
  openTrash: () => void;
  closeTrash: () => void;
  toggleTrash: () => void;
  setTrashItems: (items: TrashItem[]) => void;
  setTrashSelection: (ids: string[]) => void;
  selectTrashOnly: (id: string) => void;
  toggleTrashSelected: (id: string) => void;
  selectTrashRangeTo: (id: string) => void;
  clearTrashSelection: () => void;
  setDraggingTrashIds: (ids: string[]) => void;
  addRestoredFiles: (files: FileInfo[]) => void;
  completeTrash: (ids: string[], items: TrashItem[]) => void;
  applyGroups: (groups: FileGroup[], mode: Exclude<GroupMode, "none">) => void;
  clearGroups: () => void;
  setQuery: (query: string) => void;
  openRename: () => void;
  closeRename: () => void;
  openRenameFile: (id: string) => void;
  closeRenameFile: () => void;
  completeRename: (originalIds: string[], newFiles: FileInfo[]) => void;
  setSettings: (settings: AppSettings) => void;
  openSettings: () => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  openProjects: () => void;
  closeProjects: () => void;
  loadProjectData: (project: Project) => void;
  setViewMode: (v: ViewMode) => void;
  setSort: (by: SortBy, dir?: SortDir) => void;
  setSidebarCollapsed: (b: boolean) => void;
  toggleSidebar: () => void;
  requestNewFolder: () => void;
  requestSearchFocus: () => void;
  setGrouping: (grouping: boolean) => void;
  setGroupProgress: (p: { done: number; total: number } | null) => void;
  completeMoveOut: (ids: string[], fromFolderId: string, toFolderId: string) => void;
  setSelection: (ids: string[]) => void;
  setActiveGroup: (id: string | null) => void;
  toggleBucket: (key: string) => void;
  showAllBuckets: () => void;
  openFolderBrowse: (folder: FolderInfo, files: FileInfo[]) => void;
  closeFolderBrowse: () => void;
  setBrowseFiles: (files: FileInfo[]) => void;
  setDateGroupSort: (order: DateGroupSort) => void;
  openContextMenu: (x: number, y: number, fileId: string | null) => void;
  closeContextMenu: () => void;
  openExif: (id: string) => void;
  closeExif: () => void;
  bumpRefresh: () => void;
  setNotice: (message: string | null) => void;
  setDraggingIds: (ids: string[]) => void;
  applyRotation: (id: string, modifiedAt: number, size: number) => void;
  requestPermanentDelete: (files: FileInfo[]) => void;
  requestEmptyTrash: () => void;
  cancelPermanentDelete: () => void;
  completePermanentDelete: (paths: string[]) => void;
  completeReturn: (ids: string[], newPaths: string[]) => void;
}

/** The id sequence the preview steps through: what the grid is rendering when it has told us
 *  (so ←/→ follows the active sort, filter and group view), else the raw file order. */
function previewOrder(s: { visibleIds: string[]; files: FileInfo[]; browseFiles: FileInfo[]; browseFolder: FolderInfo | null }): string[] {
  if (s.visibleIds.length > 0) return s.visibleIds;
  return (s.browseFolder ? s.browseFiles : s.files).map((f) => f.id);
}

/**
 * The cursor + selection patch every "these files left the grid" reducer returns.
 *
 * The file that slides into the first removed slot **in the order the grid is rendering** takes
 * both the focus and the selection, so trashing tile 2 leaves you sitting on the new tile 2 with
 * it selected and the next keystroke aimed at it. Doing this in render order is the whole point:
 * the removed file's index in the raw `files` array is the scan order, which under Name / Date /
 * Type / Size sorting points somewhere else entirely — that was the selection jump.
 *
 * `fallbackIndex` is that old raw-array index, still used for the one case the render order
 * cannot answer: nothing has published a `visibleIds` yet (the first frames, headless tests).
 *
 * `visibleIds` is deliberately left alone — the grid republishes it on the render this update
 * triggers, and `focusAfterRemoval` already steps over ids that are no longer there.
 */
function cursorAfterRemoval(
  s: { visibleIds: string[] },
  removedIds: string[],
  remaining: FileInfo[],
  fallbackIndex: number,
): { focusedId: string | null; anchorId: string | null; selectedIds: string[] } {
  const alive = new Set(remaining.map((f) => f.id));
  const found = focusAfterRemoval(s.visibleIds, removedIds, (id) => alive.has(id));
  const at = Math.min(fallbackIndex, remaining.length - 1);
  const focusedId = found !== undefined ? found : at >= 0 ? remaining[at].id : null;
  return { focusedId, anchorId: focusedId, selectedIds: focusedId ? [focusedId] : [] };
}

/**
 * Keeps `groups[].fileIds` — what the sidebar counts — agreeing with the live `files` array.
 *
 * Group membership lives in two places: the `fileIds` list on each group, and `groupId` on each
 * file. Only the second one maintains itself: `groupId` is a field of the file record, so it is
 * carried out of the library when a reducer filters the file away and carried back in when an
 * undo re-inserts it. `fileIds` has to be told, and no reducer was telling it — move 99 files
 * from a group to a target folder and the sidebar still read 99.
 *
 * Patching each of the ~8 reducers that add or remove files would fix today's bug and leave the
 * next reducer free to reintroduce it, so the reconcile happens here instead, once, on the way
 * into the store. Every mode is covered for the same reason — Similar, Time, Date and Type all
 * produce the same `FileGroup[]` and all flow through this `set`.
 *
 * Cost is one pass over `files`, and only on updates that actually replace the array. Grouping is
 * cleared whenever a scan starts, so the streaming-scan path lands on the `groups.length === 0`
 * early return and pays nothing.
 */
const reconcileGroups =
  (config: StateCreator<AppState>): StateCreator<AppState> =>
  (set, get, api) =>
    config(
      (partial, replace) =>
        (set as (p: unknown, r?: boolean) => void)((s: AppState) => {
          const patch = typeof partial === "function" ? partial(s) : partial;
          // `undefined` = this reducer said nothing about files; identical = it said "unchanged".
          if (patch.files === undefined || patch.files === s.files) return patch;
          const before = patch.groups ?? s.groups;
          const groups = syncGroupMembership(before, patch.files);
          return groups === before ? patch : { ...patch, groups };
        }, replace),
      get,
      api,
    );

export const useAppStore = create<AppState>()(reconcileGroups((set, get) => ({
  files: [],
  scanning: false,
  scanned: 0,
  grouping: false,
  groupProgress: null,
  previewId: null,
  focusedId: null,
  selectedIds: [],
  visibleIds: [],
  anchorId: null,
  folders: [],
  roots: [],
  undoStack: [],
  redoStack: [],
  trashOpen: false,
  trashItems: [],
  trashSelectedIds: [],
  trashAnchorId: null,
  draggingTrashIds: [],
  groups: [],
  groupMode: "none",
  activeGroupId: null,
  dateGroupSort: "chronological",
  hiddenBuckets: [],
  query: "",
  renameOpen: false,
  renameFileId: null,
  settings: DEFAULT_SETTINGS,
  settingsOpen: false,
  projectsOpen: false,
  viewMode: "grid",
  sortBy: "name",
  sortDir: "asc",
  sidebarCollapsed: false,
  browseFolder: null,
  browseFiles: [],
  draggingIds: [],
  pendingDelete: null,
  contextMenu: null,
  exifFileId: null,
  newFolderRequested: 0,
  searchRequested: 0,
  refreshNonce: 0,
  notice: null,
  startScan: () =>
    set({
      scanning: true,
      files: [],
      scanned: 0,
      grouping: false,
      groupProgress: null,
      previewId: null,
      focusedId: null,
      selectedIds: [],
      visibleIds: [],
      anchorId: null,
      folders: [],
      undoStack: [],
      redoStack: [],
      groups: [],
      groupMode: "none",
      activeGroupId: null,
      hiddenBuckets: [],
      browseFolder: null,
      browseFiles: [],
      draggingIds: [],
      pendingDelete: null,
      contextMenu: null,
      exifFileId: null,
      query: "",
    }),
  addFiles: (batch) => set((s) => ({ files: [...s.files, ...batch] })),
  finishScan: (total) => set({ scanning: false, scanned: total }),
  reset: () =>
    set({
      files: [],
      scanning: false,
      scanned: 0,
      grouping: false,
      groupProgress: null,
      previewId: null,
      focusedId: null,
      selectedIds: [],
      visibleIds: [],
      anchorId: null,
      folders: [],
      roots: [],
      undoStack: [],
      redoStack: [],
      trashOpen: false,
      trashItems: [],
      trashSelectedIds: [],
      trashAnchorId: null,
      draggingTrashIds: [],
      groups: [],
      groupMode: "none",
      activeGroupId: null,
      hiddenBuckets: [],
      browseFolder: null,
      browseFiles: [],
      draggingIds: [],
      pendingDelete: null,
      contextMenu: null,
      exifFileId: null,
      query: "",
      renameOpen: false,
      renameFileId: null,
      settingsOpen: false,
      projectsOpen: false,
      notice: null,
    }),
  openPreview: (id) => set({ previewId: id }),
  closePreview: () => set({ previewId: null }),
  previewNext: () => {
    const { previewId } = get();
    const order = previewOrder(get());
    const i = order.indexOf(previewId ?? "");
    if (i < 0 || i >= order.length - 1) return;
    set({ previewId: order[i + 1] });
  },
  previewPrev: () => {
    const { previewId } = get();
    const order = previewOrder(get());
    const i = order.indexOf(previewId ?? "");
    if (i <= 0) return;
    set({ previewId: order[i - 1] });
  },
  // Plain focus movement also re-anchors: a subsequent Shift+Arrow / Shift+click extends from
  // wherever you last landed, which is what every file manager does.
  setFocus: (id) => set({ focusedId: id, anchorId: id }),
  selectOnly: (id) => set({ selectedIds: [id], focusedId: id, anchorId: id }),
  toggleSelected: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
      focusedId: id,
      anchorId: id,
    })),
  // Shift+click / Shift+Arrow: select everything between the anchor and `id` **in the order the
  // grid is showing** (§4), so the range never scrambles when the sort changes. The anchor stays
  // put so widening and narrowing the range both work.
  selectRangeTo: (id) =>
    set((s) => {
      const order = s.visibleIds.length > 0 ? s.visibleIds : s.files.map((f) => f.id);
      const bi = order.indexOf(id);
      if (bi < 0) return {};
      // The anchor can go stale — its file was moved, trashed, filtered out or hidden by a group
      // switch since the range started. Degrade to the focused file, then to a single-item range,
      // rather than making Shift+click quietly do nothing.
      const candidates = [s.anchorId, s.focusedId, id];
      const anchorId = candidates.find((c) => c != null && order.includes(c)) ?? id;
      const ai = order.indexOf(anchorId);
      if (ai < 0) return {};
      const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
      return {
        selectedIds: order.slice(lo, hi + 1),
        focusedId: id,
        anchorId,
      };
    }),
  setVisibleIds: (visibleIds) =>
    set((s) =>
      s.visibleIds.length === visibleIds.length && s.visibleIds.every((v, i) => v === visibleIds[i])
        ? {}
        : { visibleIds },
    ),
  clearSelection: () => set({ selectedIds: [] }),
  openTrash: () => set({ trashOpen: true }),
  // Leaving the panel drops the picking state with it, so reopening starts clean rather than
  // acting on a selection the user made minutes ago and can no longer see.
  closeTrash: () => set({ trashOpen: false, trashSelectedIds: [], trashAnchorId: null, draggingTrashIds: [] }),
  toggleTrash: () =>
    set((s) =>
      s.trashOpen
        ? { trashOpen: false, trashSelectedIds: [], trashAnchorId: null, draggingTrashIds: [] }
        : { trashOpen: true },
    ),
  // Re-listing the trash (after a restore or an empty) must not leave ids selected that no
  // longer exist, or Restore would fire at nothing.
  setTrashItems: (items) =>
    set((s) => {
      const live = new Set(items.map((i) => i.id));
      return {
        trashItems: items,
        trashSelectedIds: s.trashSelectedIds.filter((id) => live.has(id)),
        trashAnchorId: s.trashAnchorId != null && live.has(s.trashAnchorId) ? s.trashAnchorId : null,
      };
    }),
  setTrashSelection: (trashSelectedIds) => set({ trashSelectedIds }),
  selectTrashOnly: (id) => set({ trashSelectedIds: [id], trashAnchorId: id }),
  toggleTrashSelected: (id) =>
    set((s) => ({
      trashSelectedIds: s.trashSelectedIds.includes(id)
        ? s.trashSelectedIds.filter((x) => x !== id)
        : [...s.trashSelectedIds, id],
      trashAnchorId: id,
    })),
  // Shift+click inside the Trash, walking the list exactly as rendered (newest first).
  selectTrashRangeTo: (id) =>
    set((s) => {
      const order = s.trashItems.map((i) => i.id);
      const bi = order.indexOf(id);
      if (bi < 0) return {};
      const anchorId =
        s.trashAnchorId != null && order.includes(s.trashAnchorId) ? s.trashAnchorId : id;
      const ai = order.indexOf(anchorId);
      const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
      return { trashSelectedIds: order.slice(lo, hi + 1), trashAnchorId: anchorId };
    }),
  clearTrashSelection: () => set({ trashSelectedIds: [], trashAnchorId: null }),
  setDraggingTrashIds: (draggingTrashIds) => set({ draggingTrashIds }),

  // Files restored out of the trash rejoin the library grid immediately (§2) — a restore that
  // only emptied a row out of the trash panel left the user with no evidence anything came back.
  // Keyed on id so restoring a file that is somehow already listed updates it instead of
  // duplicating the tile.
  addRestoredFiles: (restored) =>
    set((s) => {
      const known = new Set(s.files.map((f) => f.id));
      const fresh = restored.filter((f) => !known.has(f.id));
      if (fresh.length === 0) return {};
      return {
        files: [...s.files, ...fresh],
        scanned: s.scanned + fresh.length,
        focusedId: s.focusedId ?? fresh[0].id,
      };
    }),
  completeTrash: (ids, items) =>
    set((s) => {
      // Pair each id with its file (+ index) and the trash entry it produced (matched by the
      // original path, robust to the backend skipping a missing file). Only files that were
      // actually trashed leave the grid and go on the undo stack.
      const byPath = new Map(items.map((it) => [it.originalPath, it]));
      const trashed: TrashedFile[] = ids
        .map((id) => {
          const fromIndex = s.files.findIndex((f) => f.id === id);
          const file = s.files[fromIndex];
          const item = file ? byPath.get(file.path) : undefined;
          return file && item ? { file, fromIndex, item } : null;
        })
        .filter((t): t is TrashedFile => t != null)
        .sort((a, b) => a.fromIndex - b.fromIndex);
      if (trashed.length === 0) return {};
      const idSet = new Set(trashed.map((t) => t.file.id));
      const files = s.files.filter((f) => !idSet.has(f.id));
      const op: HistoryOp = { kind: "trash", trashed };
      // Fold the new entries straight into `trashItems`, newest first, the way the panel lists
      // them. Optimistic, like the folder counts: the panel re-reads the real trash whenever it
      // opens. Without this the corner button — whose whole content is that number — sat on a
      // stale count until something else happened to refresh it.
      return {
        files,
        trashItems: [...trashed.map((t) => t.item), ...s.trashItems],
        ...cursorAfterRemoval(s, ids, files, trashed[0].fromIndex),
        undoStack: [...s.undoStack, op],
        redoStack: [],
      };
    }),
  applyUndoTrash: (restoredPaths) =>
    set((s) => {
      const op = s.undoStack[s.undoStack.length - 1];
      if (!op || op.kind !== "trash") return {};
      // Reinsert each restored file at its original index (ascending, like applyUndoMove); patch
      // the path to where it actually landed (usually the original, `_restored_N` on collision).
      const pairs = op.trashed
        .map((t, k) => ({ at: t.fromIndex, file: { ...t.file, path: restoredPaths[k] ?? t.file.path } }))
        .sort((a, b) => a.at - b.at);
      let files = [...s.files];
      for (const p of pairs) {
        const at = Math.min(p.at, files.length);
        files = [...files.slice(0, at), p.file, ...files.slice(at)];
      }
      const gone = new Set(op.trashed.map((t) => t.item.id));
      return {
        files,
        trashItems: s.trashItems.filter((i) => !gone.has(i.id)),
        focusedId: pairs[0]?.file.id ?? s.focusedId,
        selectedIds: [],
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, op],
      };
    }),
  applyRedoTrash: (items) =>
    set((s) => {
      const op = s.redoStack[s.redoStack.length - 1];
      if (!op || op.kind !== "trash") return {};
      const idSet = new Set(op.trashed.map((t) => t.file.id));
      const files = s.files.filter((f) => !idSet.has(f.id));
      // Re-trashing produced fresh entries (new ids); thread them back so a later undo restores
      // from the right ones.
      const byPath = new Map(items.map((it) => [it.originalPath, it]));
      const trashed = op.trashed.map((t) => ({ ...t, item: byPath.get(t.file.path) ?? t.item }));
      return {
        files,
        trashItems: [...trashed.map((t) => t.item), ...s.trashItems],
        ...cursorAfterRemoval(s, [...idSet], files, op.trashed[0].fromIndex),
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, { ...op, trashed }],
      };
    }),
  setRoots: (roots) => set({ roots }),
  setFolders: (folders) => set({ folders }),
  upsertFolder: (f) =>
    set((s) => ({
      folders: [...s.folders.filter((x) => x.id !== f.id), f].sort(
        (a, b) => a.shortcut - b.shortcut,
      ),
    })),
  completeMove: (index, folderId, toPath) =>
    set((s) => {
      const file = s.files[index];
      if (!file) return {};
      const files = s.files.filter((_, i) => i !== index);
      const folders = s.folders.map((f) =>
        f.id === folderId ? { ...f, fileCount: f.fileCount + 1 } : f,
      );
      const op: HistoryOp = {
        kind: "move",
        folderId,
        moved: [{ file, fromIndex: index, toPath }],
      };
      return {
        files,
        folders,
        ...cursorAfterRemoval(s, [file.id], files, index),
        undoStack: [...s.undoStack, op],
        redoStack: [],
      };
    }),
  completeMoveMany: (ids, folderId, toPaths) =>
    set((s) => {
      const moved: MovedFile[] = ids
        .map((id, k) => {
          const fromIndex = s.files.findIndex((f) => f.id === id);
          const file = s.files[fromIndex];
          return file ? { file, fromIndex, toPath: toPaths[k] } : null;
        })
        .filter((m): m is MovedFile => m != null)
        .sort((a, b) => a.fromIndex - b.fromIndex);
      if (moved.length === 0) return {};
      const idSet = new Set(moved.map((m) => m.file.id));
      const files = s.files.filter((f) => !idSet.has(f.id));
      const folders = s.folders.map((f) =>
        f.id === folderId ? { ...f, fileCount: f.fileCount + moved.length } : f,
      );
      // One grouped op so a single Ctrl+Z undoes the whole batch (fixes #5d deferral).
      const op: HistoryOp = { kind: "move", folderId, moved };
      return {
        files,
        folders,
        ...cursorAfterRemoval(s, ids, files, moved[0].fromIndex),
        undoStack: [...s.undoStack, op],
        redoStack: [],
      };
    }),
  applyUndoMove: (backPaths) =>
    set((s) => {
      const op = s.undoStack[s.undoStack.length - 1];
      if (!op || op.kind !== "move") return {};
      // Reinsert each moved file at its original index; ascending order reconstructs
      // the exact pre-move array (lower slots filled first as the array grows).
      const pairs = op.moved
        .map((m, k) => ({ at: m.fromIndex, file: { ...m.file, path: backPaths[k] ?? m.file.path } }))
        .sort((a, b) => a.at - b.at);
      let files = [...s.files];
      for (const p of pairs) {
        const at = Math.min(p.at, files.length);
        files = [...files.slice(0, at), p.file, ...files.slice(at)];
      }
      const folders = s.folders.map((f) =>
        f.id === op.folderId ? { ...f, fileCount: Math.max(0, f.fileCount - op.moved.length) } : f,
      );
      return {
        files,
        folders,
        focusedId: pairs[0]?.file.id ?? s.focusedId,
        selectedIds: [],
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, op],
      };
    }),
  applyRedoMove: (newPaths) =>
    set((s) => {
      const op = s.redoStack[s.redoStack.length - 1];
      if (!op || op.kind !== "move") return {};
      const idSet = new Set(op.moved.map((m) => m.file.id));
      const files = s.files.filter((f) => !idSet.has(f.id));
      const moved = op.moved.map((m, k) => ({ ...m, toPath: newPaths[k] ?? m.toPath }));
      const folders = s.folders.map((f) =>
        f.id === op.folderId ? { ...f, fileCount: f.fileCount + op.moved.length } : f,
      );
      return {
        files,
        folders,
        ...cursorAfterRemoval(s, [...idSet], files, op.moved[0].fromIndex),
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, { ...op, moved }],
      };
    }),
  applyGroups: (groups, mode) =>
    set((s) => {
      const idToGroup = new Map<string, string>();
      for (const g of groups) for (const fid of g.fileIds) idToGroup.set(fid, g.id);
      const files = s.files.map((f) => {
        const gid = idToGroup.get(f.id) ?? null;
        return f.groupId === gid ? f : { ...f, groupId: gid };
      });
      return { files, groups, groupMode: mode, activeGroupId: null };
    }),
  clearGroups: () =>
    set((s) => ({
      files: s.files.map((f) => (f.groupId == null ? f : { ...f, groupId: null })),
      groups: [],
      groupMode: "none",
      activeGroupId: null,
    })),
  setQuery: (query) => set({ query }),
  openRename: () => set({ renameOpen: true }),
  closeRename: () => set({ renameOpen: false }),
  // The right-click menu's "Rename" — one file, its own dialog. Closes the context menu with
  // it, so the menu is never left hanging over the box the user is about to type into.
  openRenameFile: (id) => set({ renameFileId: id, contextMenu: null }),
  closeRenameFile: () => set({ renameFileId: null }),
  completeRename: (originalIds, newFiles) =>
    set((s) => {
      // Capture before→after per file so the rename can be reversed on the undo stack.
      const renamed: RenamedFile[] = originalIds
        .map((id, i) => {
          const fromIndex = s.files.findIndex((f) => f.id === id);
          const before = s.files[fromIndex];
          const after = newFiles[i];
          return before && after ? { before, after, fromIndex } : null;
        })
        .filter((r): r is RenamedFile => r != null);
      if (renamed.length === 0) return {};
      const map = new Map(renamed.map((r) => [r.before.id, r.after]));
      const files = s.files.map((f) => map.get(f.id) ?? f);
      const focusedId =
        s.focusedId != null && map.has(s.focusedId) ? map.get(s.focusedId)!.id : s.focusedId;
      const op: HistoryOp = { kind: "rename", renamed };
      return {
        files,
        focusedId,
        selectedIds: [],
        renameOpen: false,
        renameFileId: null,
        undoStack: [...s.undoStack, op],
        redoStack: [],
      };
    }),
  applyUndoRename: () =>
    set((s) => {
      const op = s.undoStack[s.undoStack.length - 1];
      if (!op || op.kind !== "rename") return {};
      const map = new Map(op.renamed.map((r) => [r.after.id, r.before])); // after → before
      const files = s.files.map((f) => map.get(f.id) ?? f);
      const focusedId =
        s.focusedId != null && map.has(s.focusedId) ? map.get(s.focusedId)!.id : s.focusedId;
      return {
        files,
        focusedId,
        selectedIds: [],
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, op],
      };
    }),
  applyRedoRename: () =>
    set((s) => {
      const op = s.redoStack[s.redoStack.length - 1];
      if (!op || op.kind !== "rename") return {};
      const map = new Map(op.renamed.map((r) => [r.before.id, r.after])); // before → after
      const files = s.files.map((f) => map.get(f.id) ?? f);
      const focusedId =
        s.focusedId != null && map.has(s.focusedId) ? map.get(s.focusedId)!.id : s.focusedId;
      return {
        files,
        focusedId,
        selectedIds: [],
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, op],
      };
    }),
  setSettings: (settings) => set({ settings }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  openProjects: () => set({ projectsOpen: true }),
  closeProjects: () => set({ projectsOpen: false }),
  loadProjectData: (project) =>
    set({
      roots: project.roots,
      files: project.files,
      folders: project.folders,
      groups: project.groups,
      groupMode: project.groups.length > 0 ? project.groups[0].groupType : "none",
      activeGroupId: null,
      hiddenBuckets: [],
      browseFolder: null,
      browseFiles: [],
      scanned: project.files.length,
      scanning: false,
      focusedId: project.files[0]?.id ?? null,
      selectedIds: [],
      visibleIds: [],
      anchorId: null,
      previewId: null,
      undoStack: [],
      redoStack: [],
      query: "",
      projectsOpen: false,
    }),
  setViewMode: (viewMode) => set({ viewMode }),
  setSort: (sortBy, sortDir) => set((s) => ({ sortBy, sortDir: sortDir ?? s.sortDir })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  requestNewFolder: () => set((s) => ({ newFolderRequested: s.newFolderRequested + 1 })),
  requestSearchFocus: () => set((s) => ({ searchRequested: s.searchRequested + 1 })),
  setGrouping: (grouping) => set(grouping ? { grouping } : { grouping, groupProgress: null }),
  setGroupProgress: (groupProgress) => set({ groupProgress }),

  // Files dragged from the target folder currently being browsed into a *different* target
  // folder (§2). They live in `browseFiles`, so the library reducer (`completeMoveMany`)
  // matched nothing and left them on screen in a folder they had already left.
  //
  // Deliberately off the undo stack, exactly like `completeReturn`: the inverse is the same one
  // gesture in the other direction, and the files are plainly gone from the open folder. The
  // counts moved here are optimistic; `syncFolders` re-reads both folders straight after.
  completeMoveOut: (ids, fromFolderId, toFolderId) =>
    set((s) => {
      const idSet = new Set(ids);
      const at = s.browseFiles.findIndex((f) => idSet.has(f.id));
      const gone = s.browseFiles.filter((f) => idSet.has(f.id)).length;
      if (gone === 0) return {};
      const browseFiles = s.browseFiles.filter((f) => !idSet.has(f.id));
      const folders = s.folders.map((f) => {
        if (f.id === fromFolderId) return { ...f, fileCount: Math.max(0, f.fileCount - gone) };
        if (f.id === toFolderId) return { ...f, fileCount: f.fileCount + gone };
        return f;
      });
      return {
        browseFiles,
        folders,
        draggingIds: [],
        previewId: null,
        ...cursorAfterRemoval(s, ids, browseFiles, at),
      };
    }),
  setSelection: (selectedIds) => set({ selectedIds }),
  setActiveGroup: (activeGroupId) => set({ activeGroupId, selectedIds: [] }),
  toggleBucket: (key) =>
    set((s) => ({
      hiddenBuckets: s.hiddenBuckets.includes(key)
        ? s.hiddenBuckets.filter((k) => k !== key)
        : [...s.hiddenBuckets, key],
    })),
  showAllBuckets: () => set({ hiddenBuckets: [] }),
  // Browsing a target folder swaps what the grid renders without touching the scanned library,
  // so leaving the browse restores the session exactly as it was.
  openFolderBrowse: (browseFolder, browseFiles) =>
    set({
      browseFolder,
      browseFiles,
      selectedIds: [],
      visibleIds: [],
      anchorId: null,
      focusedId: browseFiles[0]?.id ?? null,
      previewId: null,
    }),
  closeFolderBrowse: () =>
    set((s) => ({
      browseFolder: null,
      browseFiles: [],
      selectedIds: [],
      visibleIds: [],
      anchorId: null,
      focusedId: s.files[0]?.id ?? null,
      previewId: null,
    })),
  // Re-reading a browsed folder from disk (Ctrl+R) swaps its contents without leaving browse
  // mode — the whole point of the refresh is that the open folder stays open (§5).
  setBrowseFiles: (browseFiles) =>
    set((s) => {
      const live = new Set(browseFiles.map((f) => f.id));
      return {
        browseFiles,
        selectedIds: s.selectedIds.filter((id) => live.has(id)),
        focusedId: s.focusedId != null && live.has(s.focusedId) ? s.focusedId : browseFiles[0]?.id ?? null,
      };
    }),
  setDateGroupSort: (dateGroupSort) => set({ dateGroupSort }),
  openContextMenu: (x, y, fileId) => set({ contextMenu: { x, y, fileId } }),
  closeContextMenu: () => set({ contextMenu: null }),
  openExif: (id) => set({ exifFileId: id, contextMenu: null }),
  closeExif: () => set({ exifFileId: null }),
  bumpRefresh: () => set((s) => ({ refreshNonce: s.refreshNonce + 1 })),
  // Failure is the only thing worth interrupting the user for here; success is already
  // visible (the tile leaves the grid and the folder's count goes up).
  setNotice: (notice) => set({ notice }),
  setDraggingIds: (draggingIds) => set({ draggingIds }),

  // Rotation rewrites the file, so its mtime and size change. Storing them back is what makes
  // the stale thumbnail and the stale preview refresh: both caches are keyed on those values.
  applyRotation: (id, modifiedAt, size) =>
    set((s) => {
      const patch = (f: FileInfo) => (f.id === id ? { ...f, modifiedAt, size } : f);
      return { files: s.files.map(patch), browseFiles: s.browseFiles.map(patch) };
    }),

  requestPermanentDelete: (files) =>
    set(
      files.length === 0
        ? {}
        : {
            pendingDelete: {
              ids: files.map((f) => f.id),
              paths: files.map((f) => f.path),
              names: files.map((f) => f.name),
              kind: "files",
            },
          },
    ),
  requestEmptyTrash: () =>
    set((s) =>
      s.trashItems.length === 0
        ? {}
        : {
            pendingDelete: {
              ids: s.trashItems.map((i) => i.id),
              paths: s.trashItems.map((i) => i.trashPath),
              names: s.trashItems.map((i) => i.name),
              kind: "trash",
            },
          },
    ),
  cancelPermanentDelete: () => set({ pendingDelete: null }),

  // Removal is keyed on path, not id: the backend reports exactly which files it managed to
  // delete, so a locked file stays in the grid instead of vanishing while still on disk.
  completePermanentDelete: (paths) =>
    set((s) => {
      const gone = new Set(paths);
      if (gone.size === 0) return { pendingDelete: null };
      const source = s.browseFolder ? s.browseFiles : s.files;
      const removedIds = source.filter((f) => gone.has(f.path)).map((f) => f.id);
      const removedAt = source.findIndex((f) => gone.has(f.path));
      const inLibrary = s.files.filter((f) => gone.has(f.path)).length;
      const files = s.files.filter((f) => !gone.has(f.path));
      const browseFiles = s.browseFiles.filter((f) => !gone.has(f.path));
      const remaining = s.browseFolder ? browseFiles : files;
      const folders = s.browseFolder
        ? s.folders.map((f) =>
            f.id === s.browseFolder!.id
              ? { ...f, fileCount: Math.max(0, f.fileCount - (s.browseFiles.length - browseFiles.length)) }
              : f,
          )
        : s.folders;
      return {
        files,
        browseFiles,
        folders,
        scanned: Math.max(0, s.scanned - inLibrary),
        previewId: null,
        pendingDelete: null,
        // Emptying the trash comes through here too, with trash paths that match nothing in the
        // grid — then there is no removal to step over and the cursor stays exactly where it is.
        ...(removedIds.length > 0 ? cursorAfterRemoval(s, removedIds, remaining, removedAt) : {}),
      };
    }),

  // "Return to library": the files leave the target folder and rejoin the scanned set at their
  // new (root) paths. Not on the undo stack — the inverse is one keystroke away (press the
  // folder's digit again), and the files are plainly back in the grid.
  completeReturn: (ids, newPaths) =>
    set((s) => {
      const idSet = new Set(ids);
      const returned = s.browseFiles
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => idSet.has(f.id))
        .map(({ f }) => {
          const path = newPaths[ids.indexOf(f.id)] ?? f.path;
          // Mint the id the same way the backend would, so it stays the file's stable key.
          return { ...f, path, id: normalizePath(path) };
        });
      if (returned.length === 0) return {};
      const at = s.browseFiles.findIndex((f) => idSet.has(f.id));
      const browseFiles = s.browseFiles.filter((f) => !idSet.has(f.id));
      const folders = s.browseFolder
        ? s.folders.map((f) =>
            f.id === s.browseFolder!.id
              ? { ...f, fileCount: Math.max(0, f.fileCount - returned.length) }
              : f,
          )
        : s.folders;
      return {
        files: [...s.files, ...returned],
        browseFiles,
        folders,
        scanned: s.scanned + returned.length,
        previewId: null,
        ...cursorAfterRemoval(s, ids, browseFiles, at),
      };
    }),
})));
