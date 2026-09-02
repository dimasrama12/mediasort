import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { saveSettings, resetSettings } from "../lib/commands";
import type { AppSettings, Theme } from "../lib/types";

const THEMES: Theme[] = ["light", "dark", "system"];

export function SettingsPanel() {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const closeSettings = useAppStore((s) => s.closeSettings);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, closeSettings]);

  if (!settingsOpen) return null;

  // Patch one field, then persist the whole object (fire-and-forget).
  const patch = (p: Partial<AppSettings>) => {
    const next = { ...settings, ...p };
    setSettings(next);
    void saveSettings(next).catch(() => {});
  };

  const onReset = () => void resetSettings().then(setSettings).catch(() => {});

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50">
      <div className="w-[440px] rounded-lg bg-neutral-900 border border-neutral-700 p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Settings</h2>
          <button
            type="button"
            onClick={closeSettings}
            aria-label="Close"
            className="text-neutral-400 hover:text-neutral-100"
          >
            ✕
          </button>
        </div>

        <label className="text-xs text-neutral-400 flex flex-col gap-1">
          Similarity threshold: <span className="text-neutral-300">{settings.similarityThreshold}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={settings.similarityThreshold}
            onChange={(e) => patch({ similarityThreshold: Number(e.target.value) })}
            aria-label="Similarity threshold"
          />
        </label>

        <label className="text-xs text-neutral-400 flex flex-col gap-1">
          Time window (hours)
          <input
            type="number"
            min={0}
            step={0.5}
            value={settings.timeWindowHours}
            onChange={(e) => patch({ timeWindowHours: Math.max(0, Number(e.target.value) || 0) })}
            aria-label="Time window hours"
            className="px-2 py-1 rounded bg-neutral-800 text-sm outline-none"
          />
        </label>

        <label className="text-xs text-neutral-400 flex flex-col gap-1">
          Minimum group size
          <input
            type="number"
            min={2}
            value={settings.minGroupSize}
            onChange={(e) => patch({ minGroupSize: Math.max(2, Number(e.target.value) || 2) })}
            aria-label="Minimum group size"
            className="px-2 py-1 rounded bg-neutral-800 text-sm outline-none"
          />
        </label>

        <label className="text-xs text-neutral-400 flex flex-col gap-1">
          Theme
          <select
            value={settings.theme}
            onChange={(e) => patch({ theme: e.target.value as Theme })}
            aria-label="Theme"
            className="px-2 py-1 rounded bg-neutral-800 text-sm outline-none capitalize"
          >
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <div className="flex justify-between pt-1">
          <button
            type="button"
            onClick={onReset}
            className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-400"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={closeSettings}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm font-medium"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
