import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TrashItem } from "../lib/types";

const items: TrashItem[] = [
  { id: "t1", originalPath: "C:/x/a.jpg", trashPath: "C:/t/1", name: "a.jpg", size: 1, deletedAt: 0 },
  { id: "t2", originalPath: "C:/x/b.jpg", trashPath: "C:/t/2", name: "b.jpg", size: 1, deletedAt: 0 },
];

vi.mock("../lib/commands", () => ({ listTrash: vi.fn(async () => items) }));

import { TrashButton } from "./TrashButton";
import { useAppStore } from "../store/useAppStore";

beforeEach(() => useAppStore.setState({ trashOpen: false, trashItems: [], refreshNonce: 0 }));
afterEach(cleanup);

test("the trash sits in the corner and toggles the panel", async () => {
  render(<TrashButton />);
  const btn = await screen.findByRole("button", { name: /trash/i });
  expect(btn.className).toContain("bottom-4");
  expect(btn.className).toContain("right-4");
  fireEvent.click(btn);
  expect(useAppStore.getState().trashOpen).toBe(true);
  fireEvent.click(btn);
  expect(useAppStore.getState().trashOpen).toBe(false);
});

test("it shows how much is recoverable without being opened", async () => {
  render(<TrashButton />);
  const btn = await screen.findByRole("button", { name: /trash — 2 items/i });
  expect(btn.textContent).toBe("2");
});

test("it carries the icon and the count, and no label", async () => {
  render(<TrashButton />);
  const btn = await screen.findByRole("button", { name: /trash/i });
  expect(btn.querySelector("svg")).toBeTruthy();
  expect(btn.textContent).not.toMatch(/trash/i); // the word lives in the tooltip, not the button
});

test("it survives the sidebar being collapsed — it never lived there", async () => {
  useAppStore.setState({ sidebarCollapsed: true });
  render(<TrashButton />);
  expect(await screen.findByRole("button", { name: /trash/i })).toBeTruthy();
});
