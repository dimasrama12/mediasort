import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));

import { Preview } from "./Preview";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const img = (id: string): FileInfo => ({
  id, path: `C:/x/${id}.jpg`, name: `${id}.jpg`, extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
});
const vid = (id: string): FileInfo => ({ ...img(id), path: `C:/x/${id}.mp4`, name: `${id}.mp4`, extension: "mp4", fileType: "video" });
const heic = (id: string): FileInfo => ({ ...img(id), extension: "heic", name: `${id}.heic` });

beforeEach(() => useAppStore.setState({ files: [], previewId: null }));
afterEach(cleanup);

test("renders nothing when no preview is open", () => {
  const { container } = render(<Preview />);
  expect(container.firstChild).toBeNull();
});

test("renders an <img> with an asset src for an image", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  const el = document.querySelector("img");
  expect(el).not.toBeNull();
  expect(el!.getAttribute("src")).toContain("asset://");
});

test("renders a <video> for a video file", () => {
  useAppStore.setState({ files: [vid("v")], previewId: "v" });
  render(<Preview />);
  expect(document.querySelector("video")).not.toBeNull();
});

test("shows the fallback card for an unsupported format", () => {
  useAppStore.setState({ files: [heic("h")], previewId: "h" });
  render(<Preview />);
  expect(screen.queryByText(/not available/i)).not.toBeNull();
});

test("the close button closes the preview", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  fireEvent.click(screen.getByLabelText("Close"));
  expect(useAppStore.getState().previewId).toBeNull();
});

test("Escape closes the preview", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(useAppStore.getState().previewId).toBeNull();
});

test("ArrowRight navigates to the next file", () => {
  useAppStore.setState({ files: [img("a"), img("b")], previewId: "a" });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(useAppStore.getState().previewId).toBe("b");
});
