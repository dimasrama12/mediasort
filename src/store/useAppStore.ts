import { create } from "zustand";
import type { FileInfo, FolderInfo } from "../lib/types";

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
  folders: FolderInfo[];
  roots: string[];
  moveHistory: MoveRecord[];
  startScan: () => void;
  addFiles: (batch: FileInfo[]) => void;
  finishScan: (total: number) => void;
  reset: () => void;
  openPreview: (id: string) => void;
  closePreview: () => void;
  previewNext: () => void;
  previewPrev: () => void;
  setFocus: (id: string | null) => void;
  setRoots: (roots: string[]) => void;
  setFolders: (folders: FolderInfo[]) => void;
  upsertFolder: (f: FolderInfo) => void;
  completeMove: (index: number, folderId: string, toPath: string) => void;
  completeUndo: (backPath: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  files: [],
  scanning: false,
  scanned: 0,
  previewId: null,
  focusedId: null,
  folders: [],
  roots: [],
  moveHistory: [],
  startScan: () =>
    set({
      scanning: true,
      files: [],
      scanned: 0,
      previewId: null,
      focusedId: null,
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
      folders: [],
      roots: [],
      moveHistory: [],
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
