import { beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// App registers scan-event listeners on mount; stub Tauri's event bridge,
// which isn't present in the jsdom test environment.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const listTargetFolders = vi.fn(async () => [
  { id: "contoh1", name: "contoh 1", path: "D:/random/contoh 1", key: "1", keyCustom: false, fileCount: 3 },
]);

vi.mock("./lib/commands", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listTargetFolders: (...a: unknown[]) => (listTargetFolders as never as (...x: unknown[]) => unknown)(...a),
  getSettings: vi.fn(async () => ({ theme: "dark", keybindings: {} })),
  setReservedKeys: vi.fn(async () => {}),
  setFolderKey: vi.fn(async () => []),
  reorderFolders: vi.fn(async () => []),
  trashStats: vi.fn(async () => ({ count: 0, bytes: 0 })),
  listTrash: vi.fn(async () => []),
}));

import App from "./App";
import * as commands from "./lib/commands";
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
 * The folder keys are only as live as the folder list they read.
 *
 * The target folders live in the backend registry, and the UI has to ask for them — but nothing
 * ever did at startup. Every key press before something else happened to re-list them (a drop,
 * a rename, a Ctrl+R) found no folder for that key and returned without a sound.
 * ------------------------------------------------------------------------------------------ */
test("hydrates the target folders from the backend as soon as the UI loads", async () => {
  render(<App />);
  await waitFor(() => expect(listTargetFolders).toHaveBeenCalled());
  await waitFor(() =>
    expect(useAppStore.getState().folders.map((f) => f.key)).toEqual(["1"]),
  );
});

test("a backend that cannot list folders still leaves a usable window", async () => {
  listTargetFolders.mockRejectedValueOnce(new Error("registry locked") as never);
  render(<App />);
  await waitFor(() => expect(listTargetFolders).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: /scan folder/i })).toBeDefined();
  expect(useAppStore.getState().folders).toEqual([]);
});

test("the reserved keys are pushed to the backend once settings have loaded", async () => {
  render(<App />);
  await waitFor(() => expect(commands.setReservedKeys).toHaveBeenCalled());
  const sent = vi.mocked(commands.setReservedKeys).mock.calls[0][0];
  expect(sent).toContain("Ctrl+O");
  expect(sent).toContain("J");
  expect(sent).not.toContain("L"); // preview scope
});
