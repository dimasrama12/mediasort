import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../lib/useThumbnail", () => ({
  useThumbnail: () => ({ url: null, status: "placeholder" }),
}));

import { FileCard } from "./FileCard";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const file: FileInfo = {
  id: "x1", path: "C:/x/a.jpg", name: "a.jpg", extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
};

afterEach(cleanup);

test("clicking a card focuses it (does not open the preview)", () => {
  useAppStore.setState({ focusedId: null, previewId: null });
  render(<FileCard file={file} focused={false} />);
  fireEvent.click(screen.getByRole("button"));
  expect(useAppStore.getState().focusedId).toBe("x1");
  expect(useAppStore.getState().previewId).toBeNull();
});

test("double-clicking a card opens its preview", () => {
  useAppStore.setState({ previewId: null });
  render(<FileCard file={file} focused={false} />);
  fireEvent.doubleClick(screen.getByRole("button"));
  expect(useAppStore.getState().previewId).toBe("x1");
});

test("a focused card renders a focus ring", () => {
  render(<FileCard file={file} focused={true} />);
  expect(screen.getByRole("button").className).toContain("ring-2");
});

test("plain click selects only this card and focuses it", () => {
  useAppStore.setState({ files: [file], selectedIds: ["other"], focusedId: null });
  render(<FileCard file={file} focused={false} />);
  fireEvent.click(screen.getByRole("button"));
  expect(useAppStore.getState().selectedIds).toEqual(["x1"]);
  expect(useAppStore.getState().focusedId).toBe("x1");
});

test("ctrl+click toggles this card into an existing selection", () => {
  useAppStore.setState({ files: [file], selectedIds: ["other"], focusedId: null });
  render(<FileCard file={file} focused={false} />);
  fireEvent.click(screen.getByRole("button"), { ctrlKey: true });
  expect(useAppStore.getState().selectedIds).toEqual(["other", "x1"]);
});

test("shift+click selects the file-order range from the focus anchor", () => {
  const a = { ...file, id: "a" };
  const b = { ...file, id: "b" };
  const c = { ...file, id: "c" };
  useAppStore.setState({ files: [a, b, c], selectedIds: [], focusedId: "a" });
  render(<FileCard file={c} focused={false} />);
  fireEvent.click(screen.getByRole("button"), { shiftKey: true });
  expect(useAppStore.getState().selectedIds).toEqual(["a", "b", "c"]);
});

test("a selected card renders a selected style", () => {
  render(<FileCard file={file} selected />);
  expect(screen.getByRole("button").className).toContain("sky");
});

test("renders a group badge only when the file belongs to a group", () => {
  const { rerender } = render(<FileCard file={file} />);
  expect(screen.queryByTestId("group-badge")).toBeNull();
  rerender(<FileCard file={{ ...file, groupId: "visual-1" }} />);
  expect(screen.getByTestId("group-badge")).toBeTruthy();
});
