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
