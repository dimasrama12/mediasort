import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("../lib/useThumbnail", () => ({
  useThumbnail: () => ({ url: null, status: "placeholder" }),
}));

vi.mock("../lib/commands", () => ({
  moveFiles: vi.fn(async (paths: string[], dest: string) => [
    `${dest}/${paths[0].split(/[\\/]/).pop()}`,
  ]),
}));

import { FileGrid } from "./FileGrid";
import { moveFiles } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const mk = (id: string): FileInfo => ({
  id, path: `C:/x/${id}.jpg`, name: `${id}.jpg`, extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
});

const fam = { id: "fam", name: "fam", path: "C:/base/fam", shortcut: 1, fileCount: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ files: [], focusedId: null, previewId: null, folders: [], moveHistory: [] });
});
afterEach(cleanup);

test("defaults focus to the first file on mount", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: null });
  render(<FileGrid />);
  expect(useAppStore.getState().focusedId).toBe("a");
});

test("arrows move focus when the preview is closed (one column under jsdom)", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], focusedId: "a", previewId: null });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(useAppStore.getState().focusedId).toBe("b");
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(useAppStore.getState().focusedId).toBe("c");
});

test("F opens the focused file in the preview", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "b", previewId: null });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "f" });
  expect(useAppStore.getState().previewId).toBe("b");
});

test("arrows are inert while the preview is open", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "a", previewId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(useAppStore.getState().focusedId).toBe("a");
});

test("a mapped digit moves the focused file to that folder", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], folders: [fam], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() => expect(moveFiles).toHaveBeenCalledWith(["C:/x/a.jpg"], "C:/base/fam"));
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b", "c"]));
  expect(useAppStore.getState().focusedId).toBe("b");
  expect(useAppStore.getState().folders[0].fileCount).toBe(1);
});

test("an unmapped digit does nothing", () => {
  useAppStore.setState({ files: [mk("a")], folders: [], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "5" });
  expect(moveFiles).not.toHaveBeenCalled();
  expect(useAppStore.getState().files).toHaveLength(1);
});

test("Ctrl+Z moves the last-moved file back", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [fam], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["a", "b"]));
  expect(useAppStore.getState().focusedId).toBe("a");
});

test("digits are inert while the preview is open", () => {
  useAppStore.setState({ files: [mk("a")], folders: [fam], focusedId: "a", previewId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  expect(moveFiles).not.toHaveBeenCalled();
});
