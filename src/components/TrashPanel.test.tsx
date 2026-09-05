import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/commands", () => ({
  listTrash: vi.fn(async () => []),
  restoreFromTrash: vi.fn(async (_id: string, dest: string) => dest),
  emptyTrash: vi.fn(async () => {}),
  fileInfos: vi.fn(async (paths: string[]) =>
    paths.map((path) => ({
      id: path.toLowerCase(),
      path,
      name: path.split("/").pop()!,
      extension: "jpg",
      size: 10,
      modifiedAt: 0,
      dateTaken: null,
      fileType: "image" as const,
      groupId: null,
    })),
  ),
  // The trash renders real thumbnails now, and a restore can land back in a target folder.
  ensureThumbnail: vi.fn(async (path: string) => `thumb://${path}`),
  listTargetFolders: vi.fn(async () => []),
  moveFiles: vi.fn(async (paths: string[]) => paths),
  trashFiles: vi.fn(async () => []),
}));

import { TrashPanel } from "./TrashPanel";
import { listTrash, restoreFromTrash, emptyTrash, fileInfos, ensureThumbnail } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import { clearThumbnailMemo } from "../lib/useThumbnail";
import type { TrashItem } from "../lib/types";

const item = (id: string): TrashItem => ({
  id,
  originalPath: `C:/x/${id}.jpg`,
  trashPath: `C:/trash/${id}`,
  name: `${id}.jpg`,
  size: 10,
  deletedAt: 1,
});

const row = (name: string) => screen.getByText(name).closest("[role=option]") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  // The thumbnail memo is module-level and survives between tests, so a later render would
  // hit the cache and never call the backend at all.
  clearThumbnailMemo();
  useAppStore.setState({
    trashOpen: true,
    trashItems: [item("a"), item("b"), item("c")],
    trashSelectedIds: [],
    trashAnchorId: null,
    draggingTrashIds: [],
    files: [],
    scanned: 0,
    focusedId: null,
  });
});
afterEach(cleanup);

test("renders a tile per trash item, with no per-item Restore button (§2)", () => {
  render(<TrashPanel />);
  expect(screen.getByText("a.jpg")).toBeTruthy();
  expect(screen.getByText("c.jpg")).toBeTruthy();
  // Exactly one Restore control exists now: the one in the footer.
  expect(screen.getAllByRole("button", { name: /restore/i })).toHaveLength(1);
});

test("the tiles are a real listbox of thumbnails, not a checkbox list (§4)", async () => {
  render(<TrashPanel />);
  const list = screen.getByRole("listbox", { name: /trashed files/i });
  expect(list.getAttribute("aria-multiselectable")).toBe("true");
  expect(screen.getAllByRole("option")).toHaveLength(3);
  // Each tile asks the ordinary thumbnail pipeline for the file sitting in the trash directory.
  await waitFor(() => expect(ensureThumbnail).toHaveBeenCalledWith("C:/trash/a"));
});

test("the footer holds exactly two buttons: Empty Trash and Restore", () => {
  render(<TrashPanel />);
  const footer = screen.getByRole("button", { name: /empty trash/i }).parentElement!;
  const labels = [...footer.querySelectorAll("button")].map((b) => b.textContent);
  expect(labels).toEqual(["Empty Trash", "Restore"]);
});

test("a plain click toggles, so several items are picked without holding anything (§4)", () => {
  render(<TrashPanel />);
  fireEvent.click(row("a.jpg"));
  expect(useAppStore.getState().trashSelectedIds).toEqual(["a"]);

  // No Ctrl: the second plain click *adds* rather than replacing. This is the whole change —
  // the trash is a pick-list, and requiring a modifier to build a multi-file restore was friction.
  fireEvent.click(row("c.jpg"));
  expect(useAppStore.getState().trashSelectedIds).toEqual(["a", "c"]);

  // Clicking a selected tile again takes it back out.
  fireEvent.click(row("a.jpg"));
  expect(useAppStore.getState().trashSelectedIds).toEqual(["c"]);
});

test("Shift still takes the whole range", () => {
  render(<TrashPanel />);
  fireEvent.click(row("a.jpg"));
  fireEvent.click(row("c.jpg"), { shiftKey: true });
  expect(useAppStore.getState().trashSelectedIds).toEqual(["a", "b", "c"]);
});

test("Restore is disabled until something is selected, then restores only that", async () => {
  render(<TrashPanel />);
  const restore = () => screen.getByRole("button", { name: /restore/i }) as HTMLButtonElement;
  expect(restore().disabled).toBe(true);

  fireEvent.click(row("b.jpg"));
  expect(restore().disabled).toBe(false);
  fireEvent.click(restore());

  await waitFor(() => expect(restoreFromTrash).toHaveBeenCalledWith("b", "C:/x/b.jpg"));
  expect(restoreFromTrash).toHaveBeenCalledTimes(1); // only the selected one
  await waitFor(() => expect(listTrash).toHaveBeenCalled());
});

test("restored files rejoin the library grid", async () => {
  render(<TrashPanel />);
  fireEvent.click(row("a.jpg"));
  fireEvent.click(screen.getByRole("button", { name: /restore/i }));

  await waitFor(() => expect(fileInfos).toHaveBeenCalledWith(["C:/x/a.jpg"]));
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.name)).toEqual(["a.jpg"]));
  expect(useAppStore.getState().scanned).toBe(1);
});

test("dragging a selection out onto the grid restores it", async () => {
  render(<TrashPanel />);
  fireEvent.click(row("a.jpg"));
  fireEvent.click(row("b.jpg"));

  const dt = { setData: vi.fn(), getData: () => "", dropEffect: "", effectAllowed: "" };
  fireEvent.dragStart(row("a.jpg"), { dataTransfer: dt });
  expect(useAppStore.getState().draggingTrashIds).toEqual(["a", "b"]);

  const zone = screen.getByTestId("trash-drop-zone");
  fireEvent.dragOver(zone, { dataTransfer: dt });
  fireEvent.drop(zone, { dataTransfer: dt });

  await waitFor(() => expect(restoreFromTrash).toHaveBeenCalledTimes(2));
  expect(restoreFromTrash).toHaveBeenCalledWith("a", "C:/x/a.jpg");
  expect(restoreFromTrash).toHaveBeenCalledWith("b", "C:/x/b.jpg");
  expect(useAppStore.getState().draggingTrashIds).toEqual([]);
});

test("dragging an unselected row takes just that row", () => {
  render(<TrashPanel />);
  fireEvent.click(row("a.jpg"));
  const dt = { setData: vi.fn(), getData: () => "", dropEffect: "", effectAllowed: "" };
  fireEvent.dragStart(row("c.jpg"), { dataTransfer: dt });
  expect(useAppStore.getState().draggingTrashIds).toEqual(["c"]);
  expect(useAppStore.getState().trashSelectedIds).toEqual(["c"]);
});

test("a failed restore leaves the rest of the batch alone", async () => {
  vi.mocked(restoreFromTrash).mockImplementation(async (id: string, dest: string) => {
    if (id === "a") throw new Error("original folder is gone");
    return dest;
  });
  render(<TrashPanel />);
  fireEvent.click(row("a.jpg"));
  fireEvent.click(row("b.jpg"));
  fireEvent.click(screen.getByRole("button", { name: /restore/i }));

  await waitFor(() => expect(fileInfos).toHaveBeenCalledWith(["C:/x/b.jpg"]));
  await waitFor(() => expect(useAppStore.getState().files).toHaveLength(1));
});

test("Empty Trash asks before it empties (§4)", () => {
  render(<TrashPanel />);
  fireEvent.click(screen.getByRole("button", { name: /empty trash/i }));
  // Nothing has been destroyed yet: emptying the trash is *more* destructive than deleting one
  // file, and it used to be the only such action in the app that fired off a single click.
  expect(emptyTrash).not.toHaveBeenCalled();
  const pending = useAppStore.getState().pendingDelete;
  expect(pending?.kind).toBe("trash");
  expect(pending?.names).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
});

test("closing the panel drops the selection with it", () => {
  render(<TrashPanel />);
  fireEvent.click(row("a.jpg"));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(useAppStore.getState().trashOpen).toBe(false);
  expect(useAppStore.getState().trashSelectedIds).toEqual([]);
});

test("clicking outside the panel closes it (§1)", () => {
  render(<TrashPanel />);
  fireEvent.mouseDown(screen.getByTestId("trash-drop-zone"));
  expect(useAppStore.getState().trashOpen).toBe(false);
});

test("renders nothing when closed", () => {
  useAppStore.setState({ trashOpen: false });
  const { container } = render(<TrashPanel />);
  expect(container.firstChild).toBeNull();
});
