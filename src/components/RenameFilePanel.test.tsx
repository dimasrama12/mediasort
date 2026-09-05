import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/commands", () => ({
  renameFiles: vi.fn(async (renames: { from: string; to: string }[]) =>
    renames.map((r) => ({
      id: r.to.toLowerCase(),
      path: r.to,
      name: r.to.split(/[\\/]/).pop()!,
      extension: "jpg",
      size: 1,
      modifiedAt: 0,
      dateTaken: null,
      fileType: "image" as const,
      groupId: null,
    })),
  ),
}));

import { RenameFilePanel, splitName } from "./RenameFilePanel";
import { renameFiles } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const file: FileInfo = {
  id: "x1", path: "C:\\x\\holiday.jpg", name: "holiday.jpg", extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ files: [file], renameFileId: null, undoStack: [], redoStack: [] });
});
afterEach(cleanup);

test("splitName keeps the extension apart, and leaves dotfiles whole", () => {
  expect(splitName("holiday.jpg")).toEqual(["holiday", "jpg"]);
  expect(splitName("a.b.jpg")).toEqual(["a.b", "jpg"]);
  expect(splitName("README")).toEqual(["README", ""]);
  expect(splitName(".gitignore")).toEqual([".gitignore", ""]);
});

test("renders nothing until a file is picked", () => {
  const { container } = render(<RenameFilePanel />);
  expect(container.firstChild).toBeNull();
});

test("opens with the base name in the box and the extension beside it", () => {
  useAppStore.setState({ renameFileId: "x1" });
  render(<RenameFilePanel />);
  expect((screen.getByLabelText("New file name") as HTMLInputElement).value).toBe("holiday");
  expect(screen.getByText(".jpg")).toBeTruthy();
});

test("renaming writes the new path, keeps the extension, and closes", async () => {
  useAppStore.setState({ renameFileId: "x1" });
  render(<RenameFilePanel />);
  fireEvent.change(screen.getByLabelText("New file name"), { target: { value: "beach" } });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));

  await waitFor(() =>
    expect(renameFiles).toHaveBeenCalledWith([
      { from: "C:\\x\\holiday.jpg", to: "C:\\x\\beach.jpg" },
    ]),
  );
  await waitFor(() => expect(useAppStore.getState().renameFileId).toBeNull());
  expect(useAppStore.getState().files[0].name).toBe("beach.jpg");
});

test("the rename goes on the undo stack", async () => {
  useAppStore.setState({ renameFileId: "x1" });
  render(<RenameFilePanel />);
  fireEvent.change(screen.getByLabelText("New file name"), { target: { value: "beach" } });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  await waitFor(() => expect(useAppStore.getState().undoStack).toHaveLength(1));
  expect(useAppStore.getState().undoStack[0].kind).toBe("rename");
});

test("Enter applies it too", async () => {
  useAppStore.setState({ renameFileId: "x1" });
  render(<RenameFilePanel />);
  const input = screen.getByLabelText("New file name");
  fireEvent.change(input, { target: { value: "beach" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(renameFiles).toHaveBeenCalled());
});

test("a name Windows would reject is refused before it reaches the backend", () => {
  useAppStore.setState({ renameFileId: "x1" });
  render(<RenameFilePanel />);
  fireEvent.change(screen.getByLabelText("New file name"), { target: { value: "a/b" } });
  expect((screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/cannot contain/i)).toBeTruthy();
});

test("an empty name is refused", () => {
  useAppStore.setState({ renameFileId: "x1" });
  render(<RenameFilePanel />);
  fireEvent.change(screen.getByLabelText("New file name"), { target: { value: "   " } });
  expect((screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(true);
});

test("an unchanged name just closes, without touching the disk", async () => {
  useAppStore.setState({ renameFileId: "x1" });
  render(<RenameFilePanel />);
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  await waitFor(() => expect(useAppStore.getState().renameFileId).toBeNull());
  expect(renameFiles).not.toHaveBeenCalled();
});

test("Escape and Cancel both back out", () => {
  useAppStore.setState({ renameFileId: "x1" });
  const { rerender } = render(<RenameFilePanel />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(useAppStore.getState().renameFileId).toBeNull();

  useAppStore.setState({ renameFileId: "x1" });
  rerender(<RenameFilePanel />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(useAppStore.getState().renameFileId).toBeNull();
});

test("a backend refusal is shown and the dialog stays open", async () => {
  vi.mocked(renameFiles).mockRejectedValueOnce(new Error("Access is denied"));
  useAppStore.setState({ renameFileId: "x1" });
  render(<RenameFilePanel />);
  fireEvent.change(screen.getByLabelText("New file name"), { target: { value: "beach" } });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  await waitFor(() => expect(screen.getByText("Access is denied")).toBeTruthy());
  expect(useAppStore.getState().renameFileId).toBe("x1");
});
