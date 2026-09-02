import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  })),
}));

import { SettingsPanel } from "./SettingsPanel";
import { saveSettings, resetSettings } from "../lib/commands";
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

test("reset restores defaults via the command", async () => {
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, similarityThreshold: 30 } });
  render(<SettingsPanel />);
  fireEvent.click(screen.getByText("Reset to defaults"));
  await waitFor(() => expect(resetSettings).toHaveBeenCalled());
  await waitFor(() => expect(useAppStore.getState().settings.similarityThreshold).toBe(80));
});
