import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

vi.mock("../lib/useThumbnail", () => ({
  useThumbnail: () => ({ url: null, status: "placeholder" }),
}));

import { FileGrid } from "./FileGrid";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const mk = (id: string): FileInfo => ({
  id, path: `C:/x/${id}.jpg`, name: `${id}.jpg`, extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
});

beforeEach(() => useAppStore.setState({ files: [], focusedId: null, previewId: null }));
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
