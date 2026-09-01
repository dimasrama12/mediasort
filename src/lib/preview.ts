import { convertFileSrc } from "@tauri-apps/api/core";
import type { FileInfo } from "./types";

const NATIVE_IMAGE = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const NATIVE_VIDEO = new Set(["mp4", "webm", "mov"]);

export type PreviewKind = "image" | "video" | "unsupported";

/** Decide how a file previews: inline image, inline video, or fallback card.
 * heic/heif/svg/tiff and mkv/avi are intentionally 'unsupported' this slice. */
export function previewKind(file: FileInfo): PreviewKind {
  const ext = file.extension.toLowerCase();
  if (file.fileType === "video") return NATIVE_VIDEO.has(ext) ? "video" : "unsupported";
  return NATIVE_IMAGE.has(ext) ? "image" : "unsupported";
}

/** Asset URL for the original file. Scope is granted at scan time (see scan.rs),
 * so this is synchronous — no per-file IPC. convertFileSrc stays JS-side. */
export const previewSrc = (file: FileInfo): string => convertFileSrc(file.path);
