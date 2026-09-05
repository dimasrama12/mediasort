import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/commands", () => ({
  readExif: vi.fn(async () => ({
    path: "C:/x/b.jpg",
    name: "b.jpg",
    size: 2048,
    modifiedAt: 0,
    width: 4000,
    height: 3000,
    hasExif: true,
    entries: [
      { tag: "Make", ifd: "Primary", value: "Canon" },
      { tag: "ExposureTime", ifd: "Primary", value: "1/125 s" },
    ],
  })),
  decodePreview: vi.fn(async () => "data:image/png;base64,AAAA"),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
}));

const copyText = vi.fn(async (_text: string) => true);
vi.mock("../lib/clipboard", () => ({ copyText: (t: string) => copyText(t) }));

import { ExifPanel } from "./ExifPanel";
import { readExif } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const mk = (id: string): FileInfo => ({
  id,
  path: `C:/x/${id}.jpg`,
  name: `${id}.jpg`,
  extension: "jpg",
  size: 2048,
  modifiedAt: 0,
  dateTaken: null,
  fileType: "image",
  groupId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    files: [mk("a"), mk("b")],
    browseFolder: null,
    browseFiles: [],
    exifFileId: "b",
  });
});
afterEach(cleanup);

test("renders nothing until a file is chosen", () => {
  useAppStore.setState({ exifFileId: null });
  const { container } = render(<ExifPanel />);
  expect(container.firstChild).toBeNull();
});

test("shows the photo on the left and its metadata on the right (§6)", async () => {
  render(<ExifPanel />);
  await waitFor(() => expect(readExif).toHaveBeenCalledWith("C:/x/b.jpg"));

  const img = document.querySelector("img")!;
  expect(img.getAttribute("src")).toContain("asset://C:/x/b.jpg");
  expect(await screen.findByText("Canon")).toBeInTheDocument();
  expect(screen.getByText("1/125 s")).toBeInTheDocument();
  expect(screen.getByText("4000 × 3000")).toBeInTheDocument();
});

test("the metadata is selectable text, not an image or a canvas", async () => {
  render(<ExifPanel />);
  const value = await screen.findByText("Canon");
  // The container opts text selection back in — the grid disables it globally.
  expect(value.closest(".select-text")).not.toBeNull();
});

test("Copy to Clipboard copies the whole payload and confirms", async () => {
  render(<ExifPanel />);
  await screen.findByText("Canon");
  fireEvent.click(screen.getByRole("button", { name: /copy to clipboard/i }));

  await waitFor(() => expect(copyText).toHaveBeenCalled());
  const text = copyText.mock.calls[0][0];
  expect(text).toContain("File: b.jpg");
  expect(text).toContain("Make: Canon");
  expect(await screen.findByText(/Copied/)).toBeInTheDocument();
});

test("a file with no EXIF says so instead of showing an empty table", async () => {
  vi.mocked(readExif).mockResolvedValueOnce({
    path: "C:/x/b.jpg",
    name: "b.jpg",
    size: 10,
    modifiedAt: 0,
    width: 100,
    height: 50,
    hasExif: false,
    entries: [],
  });
  render(<ExifPanel />);
  expect(await screen.findByText(/carries no EXIF metadata/)).toBeInTheDocument();
});

test("a backend failure is reported, not swallowed", async () => {
  vi.mocked(readExif).mockRejectedValueOnce(new Error("C:/x/b.jpg: file not found"));
  render(<ExifPanel />);
  expect(await screen.findByText(/file not found/)).toBeInTheDocument();
});

test("Escape and the close button both shut it", async () => {
  const { unmount } = render(<ExifPanel />);
  await screen.findByText("Canon");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(useAppStore.getState().exifFileId).toBeNull();
  unmount();

  useAppStore.setState({ exifFileId: "b" });
  render(<ExifPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(useAppStore.getState().exifFileId).toBeNull();
});

test("it reads from the browsed folder when one is open", async () => {
  useAppStore.setState({
    files: [],
    browseFolder: { id: "fam", name: "fam", path: "C:/base/fam", shortcut: 1, fileCount: 1 },
    browseFiles: [{ ...mk("b"), path: "C:/base/fam/b.jpg" }],
    exifFileId: "b",
  });
  render(<ExifPanel />);
  await waitFor(() => expect(readExif).toHaveBeenCalledWith("C:/base/fam/b.jpg"));
});
