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

/** A grouped, reversible operation on the undo/redo stacks. */
export type HistoryOp = { kind: "move"; folderId: string; moved: MovedFile[] };

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
  openTrash: () => void;
  closeTrash: () => void;
  toggleTrash: () => void;
  setTrashItems: (items: TrashItem[]) => void;
  completeTrash: (ids: string[]) => void;
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
  completeTrash: (ids) =>
    set((s) => {
      const idSet = new Set(ids);
      const indices = s.files
        .map((f, i) => (idSet.has(f.id) ? i : -1))
        .filter((i) => i >= 0);
      if (indices.length === 0) return {};
      const files = s.files.filter((f) => !idSet.has(f.id));
      const focusIdx = Math.min(indices[0], files.length - 1);
      const focusedId = focusIdx >= 0 ? files[focusIdx].id : null;
      // Trash isn't on the undo stack, but it's a new mutation — invalidate redo.
      return { files, focusedId, selectedIds: [], redoStack: [] };
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
      const map = new Map<string, FileInfo>();
      originalIds.forEach((id, i) => {
        if (newFiles[i]) map.set(id, newFiles[i]);
      });
      if (map.size === 0) return {};
      const files = s.files.map((f) => map.get(f.id) ?? f);
      const focusedId =
        s.focusedId != null && map.has(s.focusedId) ? map.get(s.focusedId)!.id : s.focusedId;
      return { files, focusedId, selectedIds: [], renameOpen: false, redoStack: [] };
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
