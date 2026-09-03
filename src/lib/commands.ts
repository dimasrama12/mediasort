import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  FileGroup,
  FileInfo,
  FolderInfo,
  HashAlgorithm,
  Project,
  ProjectSummary,
  TrashItem,
  TrashStats,
} from "./types";

/** Start a background scan of the given folders. Results arrive via scan-* events. */
export const scanFolders = (paths: string[]) => invoke<void>("scan_folders", { paths });

/** Request cancellation of an in-progress scan. */
export const cancelScan = () => invoke<void>("cancel_scan");

/** Open the OS folder picker (multi-select). Returns absolute paths, or null if cancelled. */
export async function pickFolders(): Promise<string[] | null> {
  const res = await open({ directory: true, multiple: true });
  if (res == null) return null;
  return Array.isArray(res) ? res : [res];
}

export const ensureThumbnail = async (path: string): Promise<string> =>
  convertFileSrc(await invoke<string>("ensure_thumbnail", { path }));

export const clearThumbnailCache = (): Promise<void> =>
  invoke<void>("clear_thumbnail_cache");

/** Create (or reuse) a target folder under `base`; returns its FolderInfo + shortcut. */
export const createFolder = (base: string, name: string): Promise<FolderInfo> =>
  invoke<FolderInfo>("create_folder", { base, name });

/** List the registered 1–9 target folders. */
export const listTargetFolders = (): Promise<FolderInfo[]> =>
  invoke<FolderInfo[]>("list_target_folders");

/** Move files into `dest`; returns their new absolute paths (order-matched). */
export const moveFiles = (paths: string[], dest: string): Promise<string[]> =>
  invoke<string[]>("move_files", { paths, dest });

/** Rename a target folder (moves its dir on disk); returns the updated 1–9 list. */
export const renameFolder = (id: string, name: string): Promise<FolderInfo[]> =>
  invoke<FolderInfo[]>("rename_folder", { id, name });

/** Remove a target folder (renumbers shortcuts); returns the updated 1–9 list. */
export const deleteFolder = (id: string): Promise<FolderInfo[]> =>
  invoke<FolderInfo[]>("delete_folder", { id });

/** Rename `paths` to `pattern` (with `{n}`) + sequence; returns the rebuilt FileInfo per file. */
export const batchRename = (
  paths: string[],
  pattern: string,
  start: number,
  pad: number,
): Promise<FileInfo[]> => invoke<FileInfo[]>("batch_rename", { paths, pattern, start, pad });

/** Rename files to explicit target paths (undo/redo primitive); returns the rebuilt FileInfo. */
export const renameFiles = (renames: { from: string; to: string }[]): Promise<FileInfo[]> =>
  invoke<FileInfo[]>("rename_files", { renames });

/** Group images by visual similarity (perceptual hash ≥ threshold). Emits `group-progress`. */
export const groupVisual = (
  files: FileInfo[],
  threshold: number,
  algo: HashAlgorithm,
): Promise<FileGroup[]> => invoke<FileGroup[]>("group_visual", { files, threshold, algo });

/** Group all files into temporal bursts within `hours` (EXIF dateTaken, else mtime). */
export const groupTemporal = (files: FileInfo[], hours: number): Promise<FileGroup[]> =>
  invoke<FileGroup[]>("group_temporal", { files, hours });

/** Move files to the app trash; returns the created trash items. */
export const trashFiles = (paths: string[]): Promise<TrashItem[]> =>
  invoke<TrashItem[]>("trash_files", { paths });

/** List app-trash items (newest-first). */
export const listTrash = (): Promise<TrashItem[]> => invoke<TrashItem[]>("list_trash");

/** Restore a trash item to `dest` (collision-suffixed on disk); returns the actual restored path. */
export const restoreFromTrash = (id: string, dest: string): Promise<string> =>
  invoke<string>("restore_from_trash", { id, dest });

/** Empty the app trash to the OS Recycle Bin. */
export const emptyTrash = (): Promise<void> => invoke<void>("empty_trash");

/** Count + total size of the app trash. */
export const trashStats = (): Promise<TrashStats> => invoke<TrashStats>("trash_stats");

/** Load persisted settings (defaults if none saved yet). */
export const getSettings = (): Promise<AppSettings> => invoke<AppSettings>("get_settings");

/** Persist settings to disk. */
export const saveSettings = (settings: AppSettings): Promise<void> =>
  invoke<void>("save_settings", { settings });

/** Reset settings to defaults on disk; returns the defaults. */
export const resetSettings = (): Promise<AppSettings> => invoke<AppSettings>("reset_settings");

/** Save a session snapshot (roots + files + folders + groups). */
export const saveProject = (project: Project): Promise<void> =>
  invoke<void>("save_project", { project });

/** Load a full project by id. */
export const loadProject = (id: string): Promise<Project> => invoke<Project>("load_project", { id });

/** List saved projects (summaries, newest first). */
export const listProjects = (): Promise<ProjectSummary[]> =>
  invoke<ProjectSummary[]>("list_projects");

/** Delete a saved project by id. */
export const deleteProject = (id: string): Promise<void> =>
  invoke<void>("delete_project", { id });
