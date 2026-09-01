import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

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
