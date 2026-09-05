import { beforeEach, expect, test, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("C:/cache/abc.jpg"),
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURIComponent(p)}`),
}));

import { invoke } from "@tauri-apps/api/core";
import { useThumbnail, __clearThumbnailMemo } from "./useThumbnail";
import type { FileInfo } from "./types";

const mk = (over: Partial<FileInfo> = {}): FileInfo => ({
  id: "1", path: "C:/x/a.jpg", name: "a.jpg", extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null, ...over,
});

beforeEach(() => {
  __clearThumbnailMemo();
  vi.clearAllMocks();
});

test("raster file resolves to a ready thumbnail url", async () => {
  const { result } = renderHook(() => useThumbnail(mk()));
  expect(result.current.status).toBe("loading");
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.url).toContain("asset://");
  expect(invoke).toHaveBeenCalledTimes(1);
});

test("video and svg are placeholders and never invoke", () => {
  const v = renderHook(() => useThumbnail(mk({ id: "v", fileType: "video", extension: "mp4" })));
  const h = renderHook(() => useThumbnail(mk({ id: "h", extension: "svg" })));
  expect(v.result.current.status).toBe("placeholder");
  expect(h.result.current.status).toBe("placeholder");
  expect(invoke).not.toHaveBeenCalled();
});

test("memo cache: two mounts of one file invoke once", async () => {
  const f = mk({ id: "same" });
  const a = renderHook(() => useThumbnail(f));
  await waitFor(() => expect(a.result.current.status).toBe("ready"));
  a.unmount();
  const b = renderHook(() => useThumbnail(f));
  await waitFor(() => expect(b.result.current.status).toBe("ready"));
  expect(invoke).toHaveBeenCalledTimes(1);
});

test("invoke rejection sets status error and null url", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"));
  const { result } = renderHook(() => useThumbnail(mk({ id: "err" })));
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.url).toBeNull();
});

test("heif now generates a thumbnail (decoded through WIC in the backend)", () => {
  const { result } = renderHook(() => useThumbnail(mk({ id: "hf", extension: "heif" })));
  expect(result.current.status).toBe("loading");
  expect(invoke).toHaveBeenCalled();
});
