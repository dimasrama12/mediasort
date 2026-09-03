import { create } from "zustand";
import type {
  AppSettings,
  FileGroup,
  FileInfo,
  FolderInfo,
  Project,
  TrashItem,
} from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";

export type GroupMode = "none" | "visual" | "temporal";

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
  previewId: string | null;
  focusedId: string | null;
  selectedIds: string[];
  folders: FolderInfo[];
  roots: string[];
  undoStack: HistoryOp[];
  redoStack: HistoryOp[];
  trashOpen: boolean;
  trashItems: TrashItem[];
  groups: FileGroup[];
  groupMode: GroupMode;
  query: string;
  renameOpen: boolean;
  settings: AppSettings;
  settingsOpen: boolean;
  projectsOpen: boolean;
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
  completeTrash: (ids: string[], items: TrashItem[]) => void;
  applyGroups: (groups: FileGroup[], mode: Exclude<GroupMode, "none">) => void;
  clearGroups: () => void;
  setQuery: (query: string) => void;
  openRename: () => void;
  closeRename: () => void;
  completeRename: (originalIds: string[], newFiles: FileInfo[]) => void;
  setSettings: (settings: AppSettings) => void;
  openSettings: () => void;
  closeSettings: () => void;
  openProjects: () => void;
  closeProjects: () => void;
  loadProjectData: (project: Project) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  files: [],
  scanning: false,
  scanned: 0,
  previewId: null,
  focusedId: null,
  selectedIds: [],
  folders: [],
  roots: [],
  undoStack: [],
  redoStack: [],
  trashOpen: false,
  trashItems: [],
  groups: [],
  groupMode: "none",
  query: "",
  renameOpen: false,
  settings: DEFAULT_SETTINGS,
  settingsOpen: false,
  projectsOpen: false,
  startScan: () =>
    set({
      scanning: true,
      files: [],
      scanned: 0,
      previewId: null,
      focusedId: null,
      selectedIds: [],
      folders: [],
      undoStack: [],
      redoStack: [],
      groups: [],
      groupMode: "none",
      query: "",
    }),
  addFiles: (batch) => set((s) => ({ files: [...s.files, ...batch] })),
  finishScan: (total) => set({ scanning: false, scanned: total }),
  reset: () =>
    set({
      files: [],
      scanning: false,
      scanned: 0,
      previewId: null,
      focusedId: null,
      selectedIds: [],
      folders: [],
      roots: [],
      undoStack: [],
      redoStack: [],
      trashOpen: false,
      trashItems: [],
      groups: [],
      groupMode: "none",
      query: "",
      renameOpen: false,
      settingsOpen: false,
      projectsOpen: false,
    }),
  openPreview: (id) => set({ previewId: id }),
  closePreview: () => set({ previewId: null }),
  previewNext: () => {
    const { files, previewId } = get();
    const i = files.findIndex((f) => f.id === previewId);
    if (i < 0 || i >= files.length - 1) return;
    set({ previewId: files[i + 1].id });
  },
  previewPrev: () => {
    const { files, previewId } = get();
    const i = files.findIndex((f) => f.id === previewId);
    if (i <= 0) return;
    set({ previewId: files[i - 1].id });
  },
  setFocus: (id) => set({ focusedId: id }),
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
  openTrash: () => set({ trashOpen: true }),
  closeTrash: () => set({ trashOpen: false }),
  toggleTrash: () => set((s) => ({ trashOpen: !s.trashOpen })),
  setTrashItems: (items) => set({ trashItems: items }),
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
      const focusIdx = Math.min(trashed[0].fromIndex, files.length - 1);
      const focusedId = focusIdx >= 0 ? files[focusIdx].id : null;
      const op: HistoryOp = { kind: "trash", trashed };
      return { files, focusedId, selectedIds: [], undoStack: [...s.undoStack, op], redoStack: [] };
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
      return {
        files,
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
      const focusIdx = Math.min(op.trashed[0].fromIndex, files.length - 1);
      const focusedId = focusIdx >= 0 ? files[focusIdx].id : null;
      return {
        files,
        focusedId,
        selectedIds: [],
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
      const focusIdx = Math.min(index, files.length - 1);
      const focusedId = focusIdx >= 0 ? files[focusIdx].id : null;
      const folders = s.folders.map((f) =>
        f.id === folderId ? { ...f, fileCount: f.fileCount + 1 } : f,
      );
      const op: HistoryOp = {
        kind: "move",
        folderId,
        moved: [{ file, fromIndex: index, toPath }],
      };
      return { files, focusedId, folders, undoStack: [...s.undoStack, op], redoStack: [] };
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
      const focusIdx = Math.min(moved[0].fromIndex, files.length - 1);
      const focusedId = focusIdx >= 0 ? files[focusIdx].id : null;
      const folders = s.folders.map((f) =>
        f.id === folderId ? { ...f, fileCount: f.fileCount + moved.length } : f,
      );
      // One grouped op so a single Ctrl+Z undoes the whole batch (fixes #5d deferral).
      const op: HistoryOp = { kind: "move", folderId, moved };
      return {
        files,
        focusedId,
        folders,
        selectedIds: [],
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
      const focusIdx = Math.min(op.moved[0].fromIndex, files.length - 1);
      const focusedId = focusIdx >= 0 ? files[focusIdx].id : null;
      const folders = s.folders.map((f) =>
        f.id === op.folderId ? { ...f, fileCount: f.fileCount + op.moved.length } : f,
      );
      return {
        files,
        folders,
        focusedId,
        selectedIds: [],
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
      return { files, groups, groupMode: mode };
    }),
  clearGroups: () =>
    set((s) => ({
      files: s.files.map((f) => (f.groupId == null ? f : { ...f, groupId: null })),
      groups: [],
      groupMode: "none",
    })),
  setQuery: (query) => set({ query }),
  openRename: () => set({ renameOpen: true }),
  closeRename: () => set({ renameOpen: false }),
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
  openProjects: () => set({ projectsOpen: true }),
  closeProjects: () => set({ projectsOpen: false }),
  loadProjectData: (project) =>
    set({
      roots: project.roots,
      files: project.files,
      folders: project.folders,
      groups: project.groups,
      groupMode: project.groups.length > 0 ? project.groups[0].groupType : "none",
      scanned: project.files.length,
      scanning: false,
      focusedId: project.files[0]?.id ?? null,
      selectedIds: [],
      previewId: null,
      undoStack: [],
      redoStack: [],
      query: "",
      projectsOpen: false,
    }),
}));
