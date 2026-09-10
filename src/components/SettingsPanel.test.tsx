import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/commands", () => ({
  saveSettings: vi.fn(async () => {}),
  resetSettings: vi.fn(async () => ({
    similarityThreshold: 80,
    timeWindowHours: 1,
    minGroupSize: 2,
    theme: "system",
    defaultView: "grid",
    thumbnailSize: 200,
    sidebarWidth: 224,
    sidebarCollapsed: false,
    cachePath: null,
    hashAlgorithm: "dhash",
    scratchPath: null,
    keybindings: {},
  })),
  emptyScratch: vi.fn(async () => {}),
  setReservedKeys: vi.fn(async () => {}),
  readImageDataUrl: vi.fn(async () => "data:image/jpeg;base64,AAAA"),
  pickFolder: vi.fn(async () => "D:/scratch"),
}));

import { SettingsPanel } from "./SettingsPanel";
import { saveSettings, resetSettings } from "../lib/commands";
import * as commands from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import { DEFAULT_SETTINGS } from "../lib/types";

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ settingsOpen: true, settings: { ...DEFAULT_SETTINGS } });
});
afterEach(cleanup);

test("changing similarity threshold updates the store and persists", async () => {
  render(<SettingsPanel />);
  fireEvent.change(screen.getByLabelText("Similarity threshold"), { target: { value: "55" } });
  expect(useAppStore.getState().settings.similarityThreshold).toBe(55);
  await waitFor(() => expect(saveSettings).toHaveBeenCalled());
});

test("changing theme persists the new theme", async () => {
  render(<SettingsPanel />);
  fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "dark" } });
  expect(useAppStore.getState().settings.theme).toBe("dark");
  await waitFor(() => expect(saveSettings).toHaveBeenCalled());
});

test("switching the hash algorithm to pHash updates the store and persists", async () => {
  render(<SettingsPanel />);
  expect(useAppStore.getState().settings.hashAlgorithm).toBe("dhash");
  fireEvent.change(screen.getByLabelText("Hash algorithm"), { target: { value: "phash" } });
  expect(useAppStore.getState().settings.hashAlgorithm).toBe("phash");
  await waitFor(() => expect(saveSettings).toHaveBeenCalled());
});

test("reset restores defaults via the command", async () => {
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, similarityThreshold: 30 } });
  render(<SettingsPanel />);
  fireEvent.click(screen.getByText("Reset to defaults"));
  await waitFor(() => expect(resetSettings).toHaveBeenCalled());
  await waitFor(() => expect(useAppStore.getState().settings.similarityThreshold).toBe(80));
});

test("Shortcuts tab lists a rebindable action with its default combo", () => {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
  expect(screen.getByText("Open / scan folder")).toBeInTheDocument();
  expect(screen.getByText("Ctrl + O")).toBeInTheDocument();
});

test("editing a shortcut captures the next key and persists it", async () => {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
  // Start capturing "Open / scan folder", then press Ctrl+P.
  fireEvent.click(screen.getByRole("button", { name: "Edit Open / scan folder" }));
  // The capture listener is on window in the capture phase.
  fireEvent.keyDown(window, { key: "p", ctrlKey: true });
  await waitFor(() => expect(saveSettings).toHaveBeenCalled());
  expect(useAppStore.getState().settings.keybindings.scanFolder).toEqual(["Ctrl+P"]);
});

test("scratch disk: choosing a folder persists the path", async () => {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByText("Choose…"));
  await waitFor(() => expect(useAppStore.getState().settings.scratchPath).toBe("D:/scratch"));
});

test("Special tab stays locked until the right password, then shows the message", async () => {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Special" }));
  expect(screen.queryByText(/Intan Sriwedari/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Special password"), { target: { value: "25052025" } });
  await waitFor(() => expect(screen.getByText(/Intan Sriwedari/)).toBeInTheDocument());
});

test("the User Guide no longer duplicates the shortcut list (§1)", () => {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole("button", { name: "User Guide" }));
  expect(screen.queryByText("Keyboard shortcuts")).toBeNull();
  // The guide still explains itself, and points at the tab that owns the bindings.
  expect(screen.getByText("Getting started")).toBeInTheDocument();
  expect(screen.getByText("Shortcuts", { selector: "strong" })).toBeInTheDocument();
});

test("clicking the app behind the modal closes it (§1)", () => {
  const { container } = render(<SettingsPanel />);
  fireEvent.mouseDown(container.firstChild as HTMLElement); // the dimmed backdrop
  expect(useAppStore.getState().settingsOpen).toBe(false);
});

test("clicking inside the modal leaves it open", () => {
  render(<SettingsPanel />);
  fireEvent.mouseDown(screen.getByLabelText("Theme"));
  expect(useAppStore.getState().settingsOpen).toBe(true);
});

test("a click away is ignored while a shortcut capture is armed", () => {
  const { container } = render(<SettingsPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit Open / scan folder" }));
  fireEvent.mouseDown(container.firstChild as HTMLElement);
  expect(useAppStore.getState().settingsOpen).toBe(true);
});

test("scanning sub-folders is off by default and persists when turned on", async () => {
  render(<SettingsPanel />);
  const box = screen.getByRole("checkbox", { name: /scan sub-folders/i });
  expect(useAppStore.getState().settings.scanSubfolders).toBe(false);
  expect(box).not.toBeChecked();
  fireEvent.click(box);
  expect(useAppStore.getState().settings.scanSubfolders).toBe(true);
  await waitFor(() => expect(saveSettings).toHaveBeenCalled());
});

/* ---------------------------------------------- the reverse of the sidebar's conflict check */

test("an action cannot be rebound onto a key a target folder holds", async () => {
  act(() =>
    useAppStore.setState({
      settingsOpen: true,
      folders: [
        { id: "lama", name: "Foto Lama", path: "C:/base/lama", key: "F", keyCustom: true, fileCount: 0 },
      ],
    }),
  );
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole("button", { name: /shortcuts/i }));
  fireEvent.click(screen.getByRole("button", { name: /edit move to trash/i }));
  await act(async () => {
    fireEvent.keyDown(window, { key: "f" });
  });
  expect(await screen.findByText(/Foto Lama/)).toBeInTheDocument();
  // The binding is unchanged.
  expect(useAppStore.getState().settings.keybindings.trash).toEqual(["Delete", "B"]);
});

test("rebinding pushes the new reserved set to the backend", async () => {
  act(() => useAppStore.setState({ settingsOpen: true, folders: [] }));
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole("button", { name: /shortcuts/i }));
  fireEvent.click(screen.getByRole("button", { name: /edit move to trash/i }));
  await act(async () => {
    fireEvent.keyDown(window, { key: "Backspace", ctrlKey: true });
  });
  await waitFor(() => expect(commands.setReservedKeys).toHaveBeenCalled());
  const calls = vi.mocked(commands.setReservedKeys).mock.calls;
  const sent = calls[calls.length - 1][0];
  expect(sent).toContain("Ctrl+Backspace");
  expect(sent).not.toContain("B");
});
