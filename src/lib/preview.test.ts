import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));

import { previewKind, previewSrc } from "./preview";
import type { FileInfo } from "./types";

const mk = (over: Partial<FileInfo> = {}): FileInfo => ({
  id: "1", path: "C:/x/a.jpg", name: "a.jpg", extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null, ...over,
});

test("browser-native images are 'image' (case-insensitive)", () => {
  for (const e of ["jpg", "jpeg", "png", "gif", "webp", "bmp", "JPG", "PNG"])
    expect(previewKind(mk({ extension: e }))).toBe("image");
});

test("browser-native videos are 'video'", () => {
  for (const e of ["mp4", "webm", "mov", "MP4"])
    expect(previewKind(mk({ fileType: "video", extension: e }))).toBe("video");
});

test("deferred/unknown formats are 'unsupported'", () => {
  for (const e of ["heic", "heif", "svg", "tiff", "txt", ""])
    expect(previewKind(mk({ extension: e }))).toBe("unsupported");
  for (const e of ["mkv", "avi"])
    expect(previewKind(mk({ fileType: "video", extension: e }))).toBe("unsupported");
});

test("previewSrc wraps the path through convertFileSrc", () => {
  expect(previewSrc(mk({ path: "C:/x/a.jpg" }))).toContain("asset://");
});
