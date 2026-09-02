import { create } from "zustand";
import type { FileInfo, FolderInfo, TrashItem } from "../lib/types";

interface MoveRecord {
  file: FileInfo;
  folderId: string;
  fromDir: string;
  toPath: string;
  fromIndex: number;
}

const dirname = (p: string) => {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : p;
};

interface AppState {
  files: FileInfo[];
  scanning: boolean;
  scanned: number;
  previewId: string | null;
  focusedId: string | null;
  selectedIds: string[];
  folders: FolderInfo[];
  roots: string[];
  moveHistory: MoveRecord[];
  trashOpen: boolean;
  trashItems: TrashItem[];
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
  completeUndo: (backPath: string) => void;
  openTrash: () => void;
  closeTrash: () => void;
  toggleTrash: () => void;
  setTrashItems: (items: TrashItem[]) => void;
  completeTrash: (ids: string[]) => void;
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
  moveHistory: [],
  trashOpen: false,
  trashItems: [],
  startScan: () =>
    set({
      scanning: true,
      files: [],
      scanned: 0,
      previewId: null,
      focusedId: null,
      selectedIds: [],
      folders: [],
      moveHistory: [],
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
      moveHistory: [],
      trashOpen: false,
      trashItems: [],
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
      return { files, focusedId, selectedIds: [] };
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
      const record: MoveRecord = {
        file,
        folderId,
        fromDir: dirname(file.path),
        toPath,
        fromIndex: index,
      };
      return { files, focusedId, folders, moveHistory: [...s.moveHistory, record] };
    }),
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
      // Newest-first so per-press Ctrl+Z pops the lowest original index first,
      // re-inserting survivors in the right slots to reconstruct the exact order.
      const history = [...records].reverse();
      return {
        files,
        focusedId,
        folders,
        selectedIds: [],
        moveHistory: [...s.moveHistory, ...history],
      };
    }),
  completeUndo: (backPath) =>
    set((s) => {
      const record = s.moveHistory[s.moveHistory.length - 1];
      if (!record) return {};
      const restored = { ...record.file, path: backPath };
      const at = Math.min(record.fromIndex, s.files.length);
      const files = [...s.files.slice(0, at), restored, ...s.files.slice(at)];
      const folders = s.folders.map((f) =>
        f.id === record.folderId ? { ...f, fileCount: Math.max(0, f.fileCount - 1) } : f,
      );
      return { files, focusedId: restored.id, folders, moveHistory: s.moveHistory.slice(0, -1) };
    }),
}));
