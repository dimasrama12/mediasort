import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  ExifData,
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

/** Open the OS folder picker (single-select). Returns the absolute path, or null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  const res = await open({ directory: true, multiple: false });
  if (res == null) return null;
  return Array.isArray(res) ? (res[0] ?? null) : res;
}

export const ensureThumbnail = async (path: string): Promise<string> =>
  convertFileSrc(await invoke<string>("ensure_thumbnail", { path }));

export const clearThumbnailCache = (): Promise<void> =>
  invoke<void>("clear_thumbnail_cache");

/** Create (or reuse) a target folder under `base`; returns its FolderInfo + key. */
export const createFolder = (base: string, name: string): Promise<FolderInfo> =>
  invoke<FolderInfo>("create_folder", { base, name });

/** Register an existing folder (picked via the explorer) as a target; returns its FolderInfo. */
export const addExistingFolder = (path: string): Promise<FolderInfo> =>
  invoke<FolderInfo>("add_existing_folder", { path });

/** Register several picked folders at once; returns the whole target list. There is no cap:
 *  a folder the key pool has run dry on is registered keyless (drag-only) rather than refused. */
export const addExistingFolders = (paths: string[]): Promise<FolderInfo[]> =>
  invoke<FolderInfo[]>("add_existing_folders", { paths });

/** List the registered target folders, each with its **live** on-disk file count. Read-only:
 *  it sorts for display and never re-keys, so a Ctrl+R cannot move anyone's keys around. */
export const listTargetFolders = (): Promise<FolderInfo[]> =>
  invoke<FolderInfo[]>("list_target_folders");

/** Forget every registered target folder (the directories on disk are left alone). Called when a
 *  new root is scanned, so a fresh session never inherits the last one's folder keys. */
export const clearTargetFolders = (): Promise<void> => invoke<void>("clear_target_folders");

/** Tell the backend which keys the app's own shortcuts occupy, so a target folder is never
 *  auto-assigned one. Pushed at startup and after every rebind — the binding map lives here, so
 *  this side is the only one that can know. */
export const setReservedKeys = (keys: string[]): Promise<void> =>
  invoke<void>("set_reserved_keys", { keys });

/** Point a target folder at a key the user picked; returns the refreshed list. Rejects when
 *  another folder already holds it. */
export const setFolderKey = (id: string, key: string): Promise<FolderInfo[]> =>
  invoke<FolderInfo[]>("set_folder_key", { id, key });

/** Re-apply the A→Z ordering after the preference has been saved; returns the reordered list. */
export const reorderFolders = (): Promise<FolderInfo[]> =>
  invoke<FolderInfo[]>("reorder_folders");

/** Re-adopt a saved session: grant its roots + target folders (access scope and asset protocol)
 *  and re-register the folders under their keys. Returns the live folder list. */
export const adoptSession = (roots: string[], folders: string[]): Promise<FolderInfo[]> =>
  invoke<FolderInfo[]>("adopt_session", { roots, folders });

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

/** The error a cancelled backend grouping run rejects with (Esc). Distinguished from a real
 *  failure so an abort leaves the existing grouping alone and says nothing. */
export const GROUPING_CANCELLED = "cancelled";

/** Group images by visual similarity: every image is hashed (dHash or pHash) and clustered around
 *  seeds, biggest group first. Emits `group-progress`; rejects with `GROUPING_CANCELLED` if the
 *  user pressed Esc. */
export const groupVisual = (
  files: FileInfo[],
  threshold: number,
  algo: HashAlgorithm,
): Promise<FileGroup[]> => invoke<FileGroup[]>("group_visual", { files, threshold, algo });

/** Request cancellation of an in-progress grouping run (Esc). */
export const cancelGrouping = (): Promise<void> => invoke<void>("cancel_grouping");

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

/** Empty the configured scratch-disk folder's contents now (also runs automatically on app close). */
export const emptyScratch = (): Promise<void> => invoke<void>("empty_scratch");

/** Read a local image as a `data:` URL (used for the Settings "Special For You" portrait). */
export const readImageDataUrl = (path: string): Promise<string> =>
  invoke<string>("read_image_data_url", { path });

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

/** The rewritten file's new identity, used to bust every cache keyed on it. */
export interface RotateResult {
  modifiedAt: number;
  size: number;
}

/** Rotate the original file on disk by ±90° — permanent, not a CSS transform. */
export const rotateImage = (path: string, degrees: number): Promise<RotateResult> =>
  invoke<RotateResult>("rotate_image", { path, degrees });

/** Delete files outright: no app trash, no OS recycle bin. Returns the paths actually removed. */
export const deleteFilesPermanently = (paths: string[]): Promise<string[]> =>
  invoke<string[]>("delete_files_permanently", { paths });

/** Decode a still the webview can't render itself (HEIC/HEIF/TIFF) into a PNG data URL. */
export const decodePreview = (path: string): Promise<string> =>
  invoke<string>("decode_preview", { path });

/** Rebuild FileInfo for explicit paths (restored trash items); unknown/missing paths are skipped. */
export const fileInfos = (paths: string[]): Promise<FileInfo[]> =>
  invoke<FileInfo[]>("file_infos", { paths });

/** Read a file's full EXIF metadata for the viewer (§6). */
export const readExif = (path: string): Promise<ExifData> => invoke<ExifData>("read_exif", { path });

/** List the media files directly inside `path` (non-recursive) — the sidebar's folder browser. */
export const listFolderFiles = (path: string): Promise<FileInfo[]> =>
  invoke<FileInfo[]>("list_folder_files", { path });

/** Hand a file to the OS default application (fallback for codecs the webview lacks). */
export async function openInDefaultApp(path: string): Promise<void> {
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
}

/** Reveal a file or folder in the OS file manager. */
export async function revealInExplorer(path: string): Promise<void> {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}
