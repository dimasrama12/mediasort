import { beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// App registers scan-event listeners on mount; stub Tauri's event bridge,
// which isn't present in the jsdom test environment.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const listTargetFolders = vi.fn(async () => [
  { id: "contoh1", name: "contoh 1", path: "D:/random/contoh 1", shortcut: 1, fileCount: 3 },
]);

vi.mock("./lib/commands", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listTargetFolders: (...a: unknown[]) => (listTargetFolders as never as (...x: unknown[]) => unknown)(...a),
  getSettings: vi.fn(async () => ({ theme: "dark", keybindings: {} })),
  trashStats: vi.fn(async () => ({ count: 0, bytes: 0 })),
  listTrash: vi.fn(async () => []),
}));

import App from "./App";
import { useAppStore } from "./store/useAppStore";

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.getState().reset();
  cleanup();
});

test("renders the scan control", () => {
  render(<App />);
  expect(screen.getByRole("button", { name: /scan folder/i })).toBeDefined();
});

/* --------------------------------------------------------------------------------------------
 * The 1–9 shortcuts are only as live as the folder list they read.
 *
 * The target folders live in the backend registry, and the UI has to ask for them — but nothing
 * ever did at startup. Every digit press before something else happened to re-list them (a drop,
 * a rename, a Ctrl+R) found no folder for that shortcut and returned without a sound.
 * ------------------------------------------------------------------------------------------ */
test("hydrates the 1-9 target folders from the backend as soon as the UI loads", async () => {
  render(<App />);
  await waitFor(() => expect(listTargetFolders).toHaveBeenCalled());
  await waitFor(() =>
    expect(useAppStore.getState().folders.map((f) => f.shortcut)).toEqual([1]),
  );
});

test("a backend that cannot list folders still leaves a usable window", async () => {
  listTargetFolders.mockRejectedValueOnce(new Error("registry locked") as never);
  render(<App />);
  await waitFor(() => expect(listTargetFolders).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: /scan folder/i })).toBeDefined();
  expect(useAppStore.getState().folders).toEqual([]);
});
