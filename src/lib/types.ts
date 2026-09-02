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

export type GroupType = "visual" | "temporal";

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

export type Theme = "light" | "dark" | "system";

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
};
