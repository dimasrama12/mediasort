export type FileType = "image" | "video";

export interface FileInfo {
  id: string;
  path: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: number;
  dateTaken: number | null;
  fileType: FileType;
  groupId: string | null;
}

export type GroupType = "visual" | "temporal" | "date" | "type";

export interface FileGroup {
  id: string;
  name: string;
  fileIds: string[];
  similarity: number; // 0..100 (visual only)
  timeSpan: string | null; // "start – end" (temporal only)
  groupType: GroupType;
}

export interface FolderInfo {
  id: string;
  name: string;
  path: string;
  shortcut: number; // 1..9
  fileCount: number;
}

export interface TrashItem {
  id: string;
  originalPath: string;
  trashPath: string;
  name: string;
  size: number;
  deletedAt: number;
}

export interface TrashStats {
  count: number;
  totalSize: number;
}

export interface Project {
  id: string;
  name: string;
  savedAt: number;
  roots: string[];
  files: FileInfo[];
  folders: FolderInfo[];
  groups: FileGroup[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  savedAt: number;
  fileCount: number;
}

/** One EXIF field, already rendered for display by the backend (§6). */
export interface ExifEntry {
  tag: string;
  ifd: string;
  value: string;
}

/** The EXIF viewer's payload: the file's own facts plus whatever metadata it carries. */
export interface ExifData {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
  width: number | null;
  height: number | null;
  hasExif: boolean;
  entries: ExifEntry[];
}

export type Theme = "light" | "dark" | "system";

/** Perceptual hash used for visual grouping: fast dHash (default) or DCT-based pHash. */
export type HashAlgorithm = "dhash" | "phash";

import type { Keybindings } from "./keybindings";
import { DEFAULT_KEYBINDINGS } from "./keybindings";

export interface AppSettings {
  similarityThreshold: number;
  timeWindowHours: number;
  minGroupSize: number;
  theme: Theme;
  defaultView: string;
  thumbnailSize: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  cachePath: string | null;
  hashAlgorithm: HashAlgorithm;
  /** Folder whose contents are emptied on app close (§1); null disables the auto-clean. */
  scratchPath: string | null;
  /** Walk sub-folders when scanning a root, instead of listing only what sits directly in it.
   *  Off by default: the sub-folders under a scanned root are overwhelmingly the target folders
   *  the user has been filing *into*, and reading them back re-fills the library with photos
   *  that have already been sorted. */
  scanSubfolders: boolean;
  /** Action id → combos. Merged with defaults on load (see keybindings.ts). */
  keybindings: Keybindings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  similarityThreshold: 80,
  timeWindowHours: 1,
  minGroupSize: 2,
  theme: "system",
  defaultView: "grid",
  thumbnailSize: 200,
  sidebarWidth: 224,
  sidebarCollapsed: false,
  cachePath: null,
  hashAlgorithm: "dhash",
  scratchPath: null,
  scanSubfolders: false,
  keybindings: DEFAULT_KEYBINDINGS,
};
