import { create } from "zustand";
import type { FileInfo } from "../lib/types";

interface AppState {
  files: FileInfo[];
  scanning: boolean;
  scanned: number;
  startScan: () => void;
  addFiles: (batch: FileInfo[]) => void;
  finishScan: (total: number) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  files: [],
  scanning: false,
  scanned: 0,
  startScan: () => set({ scanning: true, files: [], scanned: 0 }),
  addFiles: (batch) => set((s) => ({ files: [...s.files, ...batch] })),
  finishScan: (total) => set({ scanning: false, scanned: total }),
  reset: () => set({ files: [], scanning: false, scanned: 0 }),
}));
