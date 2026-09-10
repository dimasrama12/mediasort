import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refreshApp = vi.fn(async () => {});
vi.mock("../lib/refresh", () => ({ refreshApp: () => refreshApp() }));

vi.mock("../lib/commands", () => ({
  trashFiles: vi.fn(async (paths: string[]) =>
    paths.map((p, i) => ({
      id: `t${i}`,
      originalPath: p,
      trashPath: `C:/trash/t${i}`,
      name: p.split("/").pop() ?? "",
      size: 1,
      deletedAt: 0,
    })),
  ),
  moveFiles: vi.fn(async () => []),
}));

import { ContextMenu, clampMenu } from "./ContextMenu";
import { trashFiles } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const mk = (id: string): FileInfo => ({
  id,
  path: `C:/x/${id}.jpg`,
  name: `${id}.jpg`,
  extension: "jpg",
  size: 1,
  modifiedAt: 0,
  dateTaken: null,
  fileType: "image",
  groupId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    files: [mk("a"), mk("b"), mk("c")],
    browseFolder: null,
    browseFiles: [],
    selectedIds: [],
    contextMenu: { x: 20, y: 30, fileId: "b" },
    exifFileId: null,
    undoStack: [],
    redoStack: [],
  });
});
afterEach(cleanup);

test("the menu has exactly five entries, and they are text only", () => {
  render(<ContextMenu />);
  const items = screen.getAllByRole("menuitem");
  // "Delete" sat one keystroke from Shift+Delete's permanent delete and meant the opposite
  // (undoable). The label now says which of the two it is.
  expect(items.map((b) => b.textContent)).toEqual([
    "Move to trash",
    "Refresh",
    "EXIF data",
    "Rename",
    "Batch rename",
  ]);
  // No icon column and no glyphs smuggled into the labels: every entry is its words.
  for (const b of items) expect(b.querySelector("svg")).toBeNull();
  expect(items.map((b) => b.textContent).join("")).toMatch(/^[\w ]+$/);
});

test("Rename opens the single-file dialog for the right-clicked file", () => {
  render(<ContextMenu />);
  fireEvent.click(screen.getByRole("menuitem", { name: /^rename$/i }));
  expect(useAppStore.getState().renameFileId).toBe("b");
  expect(useAppStore.getState().contextMenu).toBeNull();
});

test("Batch rename opens the pattern renamer and closes the menu", () => {
  useAppStore.setState({ selectedIds: ["a", "b"], renameOpen: false });
  render(<ContextMenu />);
  fireEvent.click(screen.getByRole("menuitem", { name: /batch rename/i }));
  expect(useAppStore.getState().renameOpen).toBe(true);
  expect(useAppStore.getState().contextMenu).toBeNull();
});

test("both renames are disabled while browsing a target folder (read-only)", () => {
  useAppStore.setState({
    browseFolder: { id: "fam", name: "fam", path: "C:/base/fam", key: "1", keyCustom: false, fileCount: 1 },
    browseFiles: [mk("b")],
    selectedIds: ["b"],
  });
  render(<ContextMenu />);
  const disabled = (name: RegExp) =>
    (screen.getByRole("menuitem", { name }) as HTMLButtonElement).disabled;
  expect(disabled(/^rename$/i)).toBe(true);
  expect(disabled(/batch rename/i)).toBe(true);
});

test("renders nothing when no menu is open", () => {
  useAppStore.setState({ contextMenu: null });
  const { container } = render(<ContextMenu />);
  expect(container.firstChild).toBeNull();
});

test("Move to Trash trashes the right-clicked file and closes the menu", async () => {
  useAppStore.setState({ selectedIds: ["b"] });
  render(<ContextMenu />);
  fireEvent.click(screen.getByRole("menuitem", { name: /move to trash/i }));

  await waitFor(() => expect(trashFiles).toHaveBeenCalledWith(["C:/x/b.jpg"]));
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["a", "c"]));
  expect(useAppStore.getState().contextMenu).toBeNull();
});

test("Move to Trash acts on the whole selection when the click landed inside it", async () => {
  useAppStore.setState({ selectedIds: ["a", "b"] });
  render(<ContextMenu />);
  expect(screen.getByRole("menuitem", { name: /move to trash/i }).textContent).toContain("2");
  fireEvent.click(screen.getByRole("menuitem", { name: /move to trash/i }));
  await waitFor(() => expect(trashFiles).toHaveBeenCalledWith(["C:/x/a.jpg", "C:/x/b.jpg"]));
});

test("Move to Trash is disabled while browsing a target folder (read-only)", () => {
  useAppStore.setState({
    browseFolder: { id: "fam", name: "fam", path: "C:/base/fam", key: "1", keyCustom: false, fileCount: 1 },
    browseFiles: [mk("b")],
  });
  render(<ContextMenu />);
  expect((screen.getByRole("menuitem", { name: /move to trash/i }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

test("Refresh runs the app refresh and closes the menu", async () => {
  render(<ContextMenu />);
  fireEvent.click(screen.getByRole("menuitem", { name: /refresh/i }));
  await waitFor(() => expect(refreshApp).toHaveBeenCalled());
  expect(useAppStore.getState().contextMenu).toBeNull();
});

test("EXIF Data opens the viewer for that file", () => {
  render(<ContextMenu />);
  fireEvent.click(screen.getByRole("menuitem", { name: /exif/i }));
  expect(useAppStore.getState().exifFileId).toBe("b");
  expect(useAppStore.getState().contextMenu).toBeNull();
});

test("EXIF Data is disabled when the menu was opened on empty space", () => {
  useAppStore.setState({ contextMenu: { x: 5, y: 5, fileId: null } });
  render(<ContextMenu />);
  expect((screen.getByRole("menuitem", { name: /exif/i }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("menuitem", { name: /move to trash/i }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

test("Escape and a click elsewhere both dismiss it", () => {
  const { unmount } = render(<ContextMenu />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(useAppStore.getState().contextMenu).toBeNull();
  unmount();

  useAppStore.setState({ contextMenu: { x: 1, y: 1, fileId: "a" } });
  render(<ContextMenu />);
  fireEvent.mouseDown(document.body);
  expect(useAppStore.getState().contextMenu).toBeNull();
});

test("clampMenu keeps the menu inside the window", () => {
  // Comfortably inside: unchanged.
  expect(clampMenu(100, 100, 180, 120, 1280, 800)).toEqual({ left: 100, top: 100 });
  // Near the right/bottom edges: pulled back so the whole menu stays visible.
  expect(clampMenu(1270, 790, 180, 120, 1280, 800)).toEqual({ left: 1096, top: 676 });
  // A window smaller than the menu still gets a sane, on-screen origin.
  expect(clampMenu(10, 10, 180, 120, 100, 100)).toEqual({ left: 4, top: 4 });
});
