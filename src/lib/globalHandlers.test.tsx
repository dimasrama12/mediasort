import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fireEvent } from "@testing-library/react";

const refreshApp = vi.fn(async () => {});
vi.mock("./refresh", () => ({ refreshApp: () => refreshApp() }));

// Esc reaches straight through to the two abort commands.
vi.mock("./commands", () => ({
  cancelScan: vi.fn(async () => {}),
  cancelGrouping: vi.fn(async () => {}),
  clearTargetFolders: vi.fn(async () => {}),
  pickFolders: vi.fn(async () => null),
  scanFolders: vi.fn(async () => {}),
}));
vi.mock("./useThumbnail", () => ({ clearThumbnailMemo: vi.fn() }));

import { installContextMenu, installGlobalKeys } from "./globalHandlers";
import { cancelScan, cancelGrouping } from "./commands";
import { useAppStore } from "../store/useAppStore";
import { DEFAULT_SETTINGS } from "./types";

let uninstall: (() => void)[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    settings: { ...DEFAULT_SETTINGS },
    settingsOpen: false,
    contextMenu: null,
    selectedIds: [],
    files: [],
    browseFolder: null,
    browseFiles: [],
    scanning: false,
    grouping: false,
  });
});
afterEach(() => {
  uninstall.forEach((f) => f());
  uninstall = [];
  document.body.innerHTML = "";
});

const keys = () => uninstall.push(installGlobalKeys());
const menus = () => uninstall.push(installContextMenu());

test("Ctrl+' twice quickly toggles the Settings modal (§1)", () => {
  keys();
  fireEvent.keyDown(window, { key: "'", ctrlKey: true });
  expect(useAppStore.getState().settingsOpen).toBe(false); // one tap does nothing
  fireEvent.keyDown(window, { key: "'", ctrlKey: true });
  expect(useAppStore.getState().settingsOpen).toBe(true);
});

test("the double-tap closes Settings again, so it really toggles", () => {
  keys();
  useAppStore.setState({ settingsOpen: true });
  fireEvent.keyDown(window, { key: "'", ctrlKey: true });
  fireEvent.keyDown(window, { key: "'", ctrlKey: true });
  expect(useAppStore.getState().settingsOpen).toBe(false);
});

test("two taps too far apart are two separate first taps", () => {
  const now = vi.spyOn(Date, "now");
  keys();
  now.mockReturnValue(1000);
  fireEvent.keyDown(window, { key: "'", ctrlKey: true });
  now.mockReturnValue(1000 + 5000); // five seconds later
  fireEvent.keyDown(window, { key: "'", ctrlKey: true });
  expect(useAppStore.getState().settingsOpen).toBe(false);
  // …but a prompt follow-up to that second tap does fire.
  now.mockReturnValue(1000 + 5100);
  fireEvent.keyDown(window, { key: "'", ctrlKey: true });
  expect(useAppStore.getState().settingsOpen).toBe(true);
  now.mockRestore();
});

test("a third quick tap does not toggle straight back", () => {
  keys();
  fireEvent.keyDown(window, { key: "'", ctrlKey: true });
  fireEvent.keyDown(window, { key: "'", ctrlKey: true });
  expect(useAppStore.getState().settingsOpen).toBe(true);
  fireEvent.keyDown(window, { key: "'", ctrlKey: true }); // starts a new pair
  expect(useAppStore.getState().settingsOpen).toBe(true);
});

test("Ctrl+R refreshes and stops the webview reloading the page (§5)", () => {
  keys();
  const e = new KeyboardEvent("keydown", { key: "r", ctrlKey: true, cancelable: true });
  window.dispatchEvent(e);
  expect(refreshApp).toHaveBeenCalled();
  expect(e.defaultPrevented).toBe(true);
});

test("F5 refreshes too", () => {
  keys();
  fireEvent.keyDown(window, { key: "F5" });
  expect(refreshApp).toHaveBeenCalled();
});

test("an unbound key is left alone", () => {
  keys();
  const e = new KeyboardEvent("keydown", { key: "q", cancelable: true });
  window.dispatchEvent(e);
  expect(refreshApp).not.toHaveBeenCalled();
  expect(e.defaultPrevented).toBe(false);
});

test("right-click suppresses the native menu and opens ours on the file under the cursor", () => {
  menus();
  const tile = document.createElement("div");
  tile.dataset.fileId = "b";
  const inner = document.createElement("img"); // right-clicking the thumbnail itself
  tile.appendChild(inner);
  document.body.appendChild(tile);
  useAppStore.setState({ selectedIds: ["a"] });

  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 90 });
  inner.dispatchEvent(e);

  expect(e.defaultPrevented).toBe(true); // no "Save image as…" from the webview
  expect(useAppStore.getState().contextMenu).toEqual({ x: 40, y: 90, fileId: "b" });
  // Right-clicking outside the selection moves it, like Explorer.
  expect(useAppStore.getState().selectedIds).toEqual(["b"]);
});

test("right-clicking inside a multi-file selection keeps that selection", () => {
  menus();
  const tile = document.createElement("div");
  tile.dataset.fileId = "b";
  document.body.appendChild(tile);
  useAppStore.setState({ selectedIds: ["a", "b", "c"] });

  fireEvent.contextMenu(tile);
  expect(useAppStore.getState().selectedIds).toEqual(["a", "b", "c"]);
  expect(useAppStore.getState().contextMenu?.fileId).toBe("b");
});

test("right-clicking empty space still opens the menu, with no file", () => {
  menus();
  const empty = document.createElement("div");
  document.body.appendChild(empty);
  fireEvent.contextMenu(empty);
  expect(useAppStore.getState().contextMenu?.fileId).toBeNull();
});

test("right-clicking a text field shows nothing at all", () => {
  menus();
  const input = document.createElement("input");
  document.body.appendChild(input);
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  input.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  expect(useAppStore.getState().contextMenu).toBeNull();
});

/* ------------------------------------------------------------------------------------------
 * Esc aborts the two operations that can hold the app for minutes. Until this existed, a scan
 * aimed at the wrong drive, or "Group: Similar" over ten thousand photos, had to be waited out.
 * ---------------------------------------------------------------------------------------- */

test("Esc cancels a running scan", () => {
  useAppStore.setState({ scanning: true, grouping: false });
  keys();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(cancelScan).toHaveBeenCalledTimes(1);
  expect(cancelGrouping).not.toHaveBeenCalled();
});

test("Esc cancels a running grouping pass", () => {
  useAppStore.setState({ scanning: false, grouping: true });
  keys();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(cancelGrouping).toHaveBeenCalledTimes(1);
  expect(cancelScan).not.toHaveBeenCalled();
});

test("Esc is inert when nothing long-running is happening", () => {
  useAppStore.setState({ scanning: false, grouping: false });
  keys();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(cancelScan).not.toHaveBeenCalled();
  expect(cancelGrouping).not.toHaveBeenCalled();
});

test("the abort runs in the capture phase, ahead of the panels' own Escape handlers", () => {
  // Every other Escape in the app (clear selection, leave the browser, close a panel) listens on
  // the bubble phase; if the abort did too, whichever registered first would swallow the key.
  useAppStore.setState({ scanning: true });
  const bubble = vi.fn();
  window.addEventListener("keydown", bubble);
  keys();
  fireEvent.keyDown(window, { key: "Escape" });
  window.removeEventListener("keydown", bubble);
  expect(cancelScan).toHaveBeenCalled();
  expect(bubble).not.toHaveBeenCalled();
});
