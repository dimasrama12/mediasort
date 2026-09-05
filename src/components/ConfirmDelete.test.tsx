import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/commands", () => ({
  // The backend reports back exactly what it managed to remove.
  deleteFilesPermanently: vi.fn(async (paths: string[]) => paths),
  // The same dialog now also confirms "Empty Trash" (§4), so it reaches for these two.
  emptyTrash: vi.fn(async () => {}),
  listTrash: vi.fn(async () => []),
}));

import { ConfirmDelete } from "./ConfirmDelete";
import { deleteFilesPermanently } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";

const pending = (n: number) => ({
  ids: Array.from({ length: n }, (_, i) => `id${i}`),
  paths: Array.from({ length: n }, (_, i) => `C:/x/f${i}.jpg`),
  names: Array.from({ length: n }, (_, i) => `f${i}.jpg`),
  kind: "files" as const,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.getState().reset();
});
afterEach(cleanup);

test("renders nothing until a deletion is pending", () => {
  const { container } = render(<ConfirmDelete />);
  expect(container).toBeEmptyDOMElement();
});

test("names the files and warns that this one is not undoable", () => {
  useAppStore.setState({ pendingDelete: pending(2) });
  render(<ConfirmDelete />);
  expect(screen.getByText("Delete 2 files permanently?")).toBeInTheDocument();
  expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
  expect(screen.getByText("f0.jpg")).toBeInTheDocument();
  expect(screen.getByText("f1.jpg")).toBeInTheDocument();
});

test("a long list is truncated rather than filling the screen", () => {
  useAppStore.setState({ pendingDelete: pending(12) });
  render(<ConfirmDelete />);
  expect(screen.getByText("…and 4 more")).toBeInTheDocument();
});

test("confirming deletes on disk and drops the files from the grid", async () => {
  const files = pending(2);
  useAppStore.setState({
    files: files.paths.map((path, i) => ({
      id: files.ids[i],
      path,
      name: files.names[i],
      extension: "jpg",
      size: 1,
      modifiedAt: 0,
      dateTaken: null,
      fileType: "image" as const,
      groupId: null,
    })),
    scanned: 2,
    pendingDelete: files,
  });
  render(<ConfirmDelete />);
  fireEvent.click(screen.getByText("Delete permanently"));
  await waitFor(() => expect(deleteFilesPermanently).toHaveBeenCalledWith(files.paths));
  await waitFor(() => expect(useAppStore.getState().files).toHaveLength(0));
  expect(useAppStore.getState().scanned).toBe(0);
  expect(useAppStore.getState().pendingDelete).toBeNull();
});

test("Escape cancels without touching the disk", () => {
  useAppStore.setState({ pendingDelete: pending(1) });
  render(<ConfirmDelete />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(deleteFilesPermanently).not.toHaveBeenCalled();
  expect(useAppStore.getState().pendingDelete).toBeNull();
});

test("Enter confirms", async () => {
  useAppStore.setState({ pendingDelete: pending(1) });
  render(<ConfirmDelete />);
  fireEvent.keyDown(window, { key: "Enter" });
  await waitFor(() => expect(deleteFilesPermanently).toHaveBeenCalled());
});

test("Cancel takes focus, so a stray Enter is harmless", () => {
  useAppStore.setState({ pendingDelete: pending(1) });
  render(<ConfirmDelete />);
  expect(document.activeElement).toBe(screen.getByText("Cancel"));
});

test("a backend failure closes the dialog and leaves the files alone", async () => {
  vi.mocked(deleteFilesPermanently).mockRejectedValueOnce("access denied");
  useAppStore.setState({ pendingDelete: pending(1) });
  render(<ConfirmDelete />);
  fireEvent.click(screen.getByText("Delete permanently"));
  await waitFor(() => expect(useAppStore.getState().pendingDelete).toBeNull());
});
