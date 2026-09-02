import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/commands", () => ({
  listTrash: vi.fn(async () => []),
  restoreFromTrash: vi.fn(async () => {}),
  emptyTrash: vi.fn(async () => {}),
}));

import { TrashPanel } from "./TrashPanel";
import { listTrash, restoreFromTrash, emptyTrash } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import type { TrashItem } from "../lib/types";

const item = (id: string): TrashItem => ({
  id,
  originalPath: `C:/x/${id}.jpg`,
  trashPath: `C:/trash/${id}`,
  name: `${id}.jpg`,
  size: 10,
  deletedAt: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ trashOpen: true, trashItems: [item("a"), item("b")] });
});
afterEach(cleanup);

test("renders a row per trash item", () => {
  render(<TrashPanel />);
  expect(screen.getByText("a.jpg")).toBeTruthy();
  expect(screen.getByText("b.jpg")).toBeTruthy();
});

test("Restore calls restoreFromTrash with id + originalPath then re-lists", async () => {
  render(<TrashPanel />);
  fireEvent.click(screen.getAllByRole("button", { name: /restore/i })[0]);
  await waitFor(() => expect(restoreFromTrash).toHaveBeenCalledWith("a", "C:/x/a.jpg"));
  await waitFor(() => expect(listTrash).toHaveBeenCalled());
});

test("Empty Trash calls emptyTrash then re-lists", async () => {
  render(<TrashPanel />);
  fireEvent.click(screen.getByRole("button", { name: /empty trash/i }));
  await waitFor(() => expect(emptyTrash).toHaveBeenCalled());
  await waitFor(() => expect(listTrash).toHaveBeenCalled());
});

test("renders nothing when closed", () => {
  useAppStore.setState({ trashOpen: false });
  const { container } = render(<TrashPanel />);
  expect(container.firstChild).toBeNull();
});
