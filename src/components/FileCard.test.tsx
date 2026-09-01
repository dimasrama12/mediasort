import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Stub the thumbnail hook so the card renders without touching Tauri.
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

test("clicking a card opens that file's preview", () => {
  useAppStore.setState({ previewId: null });
  render(<FileCard file={file} />);
  fireEvent.click(screen.getByRole("button"));
  expect(useAppStore.getState().previewId).toBe("x1");
});
