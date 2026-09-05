import { convertFileSrc } from "@tauri-apps/api/core";
import type { FileInfo } from "./types";

/** Stills the webview renders straight from an asset URL. */
const NATIVE_IMAGE = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
/** Stills the webview has no decoder for — Rust decodes them to a PNG data URL instead. */
const DECODE_IMAGE = new Set(["heic", "heif", "tiff", "tif"]);
/** Containers the webview plays directly (h.264/vp9 in mp4/webm/mov). */
const NATIVE_VIDEO = new Set(["mp4", "webm", "mov"]);
/** Containers whose playback depends on the codecs installed on the machine (mkv, avi). We still
 *  hand them to <video>; if it can't play them the preview falls back to "open in your player". */
const HOST_VIDEO = new Set(["mkv", "avi"]);

export type PreviewKind = "image" | "decode" | "video" | "unsupported";

/** Decide how a file previews: inline image, Rust-decoded image, inline video, or fallback card.
 *  Every format §1 asks for (jpeg/jpg/png/heic/heif/gif/webp/mp4/mov/webm/mkv/avi) resolves to a
 *  real preview path here; only genuinely unknown extensions land on "unsupported". */
export function previewKind(file: FileInfo): PreviewKind {
  const ext = file.extension.toLowerCase();
  if (NATIVE_VIDEO.has(ext) || HOST_VIDEO.has(ext)) return "video";
  if (NATIVE_IMAGE.has(ext)) return "image";
  if (DECODE_IMAGE.has(ext)) return "decode";
  return "unsupported";
}

/** Asset URL for the original file. Scope is granted at scan time (see scan.rs),
 * so this is synchronous — no per-file IPC. convertFileSrc stays JS-side. */
export const previewSrc = (file: FileInfo): string => convertFileSrc(file.path);
