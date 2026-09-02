import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileInfo } from "./types";

export const onScanFile = (cb: (files: FileInfo[]) => void): Promise<UnlistenFn> =>
  listen<FileInfo[]>("scan-file", (e) => cb(e.payload));

export const onScanProgress = (cb: (done: number) => void): Promise<UnlistenFn> =>
  listen<{ done: number }>("scan-progress", (e) => cb(e.payload.done));

export const onScanDone = (cb: (total: number) => void): Promise<UnlistenFn> =>
  listen<{ total: number }>("scan-done", (e) => cb(e.payload.total));

export const onGroupProgress = (
  cb: (done: number, total: number) => void,
): Promise<UnlistenFn> =>
  listen<{ done: number; total: number }>("group-progress", (e) =>
    cb(e.payload.done, e.payload.total),
  );
