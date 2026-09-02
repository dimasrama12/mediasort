import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/commands", () => ({
  batchRename: vi.fn(async (paths: string[]) =>
    paths.map((_p, i) => ({
      id: `new-${i}`,
      path: `C:/x/Renamed 0${i + 1}.jpg`,
      name: `Renamed 0${i + 1}.jpg`,
      extension: "jpg",
      size: 1,
      modifiedAt: 0,
      dateTaken: null,
      fileType: "image",
      groupId: null,
    })),
  ),
}));

import { RenamePanel, previewName } from "./RenamePanel";
import { batchRename } from "../lib/commands";
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
    files: [mk("a"), mk("b")],
    selectedIds: [],
    query: "",
    renameOpen: true,
    focusedId: "a",
  });
});
afterEach(cleanup);

test("previewName mirrors {n} substitution + zero-pad + extension", () => {
  expect(previewName("Photo {n}", 1, 2, "jpg")).toBe("Photo 01.jpg");
  expect(previewName("Trip", 5, 0, "png")).toBe("Trip 5.png");
});

test("Rename applies batchRename to all visible files and updates the store", async () => {
  render(<RenamePanel />);
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  await waitFor(() =>
    expect(batchRename).toHaveBeenCalledWith(["C:/x/a.jpg", "C:/x/b.jpg"], "Photo {n}", 1, 2),
  );
  await waitFor(() =>
    expect(useAppStore.getState().files.map((f) => f.name)).toEqual([
      "Renamed 01.jpg",
      "Renamed 02.jpg",
    ]),
  );
  expect(useAppStore.getState().renameOpen).toBe(false);
});

test("renames only the selection when one exists", async () => {
  useAppStore.setState({ selectedIds: ["b"] });
  render(<RenamePanel />);
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  await waitFor(() =>
    expect(batchRename).toHaveBeenCalledWith(["C:/x/b.jpg"], "Photo {n}", 1, 2),
  );
});
