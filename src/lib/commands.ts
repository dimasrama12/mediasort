import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { FolderInfo } from "./types";

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
