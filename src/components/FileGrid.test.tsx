import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("../lib/useThumbnail", () => ({
  useThumbnail: () => ({ url: null, status: "placeholder" }),
}));

vi.mock("../lib/commands", () => ({
  moveFiles: vi.fn(async (paths: string[], dest: string) =>
    paths.map((p) => `${dest}/${p.split(/[\\/]/).pop()}`),
  ),
  trashFiles: vi.fn(async (paths: string[]) =>
    paths.map((p, i) => ({
      id: `t${i}`,
      originalPath: p,
      trashPath: `C:/trash/t${i}`,
      name: p.split(/[\\/]/).pop() ?? "",
      size: 1,
      deletedAt: 0,
    })),
  ),
  restoreFromTrash: vi.fn(async (_id: string, dest: string) => dest),
}));

import { FileGrid } from "./FileGrid";
import { moveFiles, trashFiles } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const mk = (id: string): FileInfo => ({
  id, path: `C:/x/${id}.jpg`, name: `${id}.jpg`, extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
});

const fam = { id: "fam", name: "fam", path: "C:/base/fam", shortcut: 1, fileCount: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ files: [], focusedId: null, previewId: null, folders: [], undoStack: [], redoStack: [], selectedIds: [], trashOpen: false, renameOpen: false, query: "" });
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

test("Ctrl+Y redoes an undone move", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [fam], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["a", "b"]));
  fireEvent.keyDown(window, { key: "y", ctrlKey: true });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  expect(useAppStore.getState().redoStack).toHaveLength(0);
  expect(useAppStore.getState().undoStack).toHaveLength(1);
});

test("with a selection, a mapped digit moves the whole selection (grid order) and clears it", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], folders: [fam], focusedId: "b", selectedIds: ["a", "c"] });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() =>
    expect(moveFiles).toHaveBeenCalledWith(["C:/x/a.jpg", "C:/x/c.jpg"], "C:/base/fam"),
  );
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  expect(useAppStore.getState().folders[0].fileCount).toBe(2);
  expect(useAppStore.getState().selectedIds).toEqual([]);
});

test("Escape clears a non-empty selection", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "a", previewId: null, selectedIds: ["a", "b"] });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(useAppStore.getState().selectedIds).toEqual([]);
});

test("Del trashes the selection and removes those files", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], focusedId: "b", selectedIds: ["a", "c"], trashOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Delete" });
  await waitFor(() => expect(trashFiles).toHaveBeenCalledWith(["C:/x/a.jpg", "C:/x/c.jpg"]));
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  expect(useAppStore.getState().selectedIds).toEqual([]);
});

test("Del with no selection trashes the focused file", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "a", selectedIds: [], trashOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Delete" });
  await waitFor(() => expect(trashFiles).toHaveBeenCalledWith(["C:/x/a.jpg"]));
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
});

test("Ctrl+Z after Del restores the trashed file (undoable trash)", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "a", selectedIds: [], trashOpen: false, undoStack: [], redoStack: [] });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Delete" });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["a", "b"]));
});

test("T toggles the trash panel (works with an empty grid)", () => {
  useAppStore.setState({ files: [], focusedId: null, trashOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "t" });
  expect(useAppStore.getState().trashOpen).toBe(true);
});

test("grid keys are inert while the trash panel is open", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [fam], focusedId: "a", selectedIds: [], trashOpen: true });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  expect(moveFiles).not.toHaveBeenCalled();
});

test("digits are inert while the preview is open", () => {
  useAppStore.setState({ files: [mk("a")], folders: [fam], focusedId: "a", previewId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  expect(moveFiles).not.toHaveBeenCalled();
});

test("search narrows keyboard navigation to the visible files", () => {
  useAppStore.setState({
    files: [
      { ...mk("a"), name: "keep-1.jpg" },
      { ...mk("b"), name: "skip.jpg" },
      { ...mk("c"), name: "keep-2.jpg" },
    ],
    focusedId: "a",
    query: "keep",
  });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(useAppStore.getState().focusedId).toBe("c"); // skipped the hidden "skip.jpg"
});

test("R opens the rename panel when files exist", () => {
  useAppStore.setState({ files: [mk("a")], focusedId: "a", renameOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "r" });
  expect(useAppStore.getState().renameOpen).toBe(true);
});

test("grid keys are inert while the rename panel is open", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [fam], focusedId: "a", renameOpen: true });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  expect(moveFiles).not.toHaveBeenCalled();
});
