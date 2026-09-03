import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { saveSettings, resetSettings } from "../lib/commands";
import type { AppSettings, HashAlgorithm, Theme } from "../lib/types";

const THEMES: Theme[] = ["light", "dark", "system"];
const HASH_ALGOS: { value: HashAlgorithm; label: string }[] = [
  { value: "dhash", label: "dHash — fast (default)" },
  { value: "phash", label: "pHash — DCT, more robust" },
];

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
      <div className="w-[440px] rounded-lg bg-[var(--panel)] border border-[var(--border)] p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Settings</h2>
          <button
            type="button"
            onClick={closeSettings}
            aria-label="Close"
            className="text-[var(--muted)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>

        <label className="text-xs text-[var(--muted)] flex flex-col gap-1">
          Similarity threshold: <span className="text-[var(--text)]">{settings.similarityThreshold}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={settings.similarityThreshold}
            onChange={(e) => patch({ similarityThreshold: Number(e.target.value) })}
            aria-label="Similarity threshold"
          />
        </label>

        <label className="text-xs text-[var(--muted)] flex flex-col gap-1">
          Similar-photo hashing
          <select
            value={settings.hashAlgorithm}
            onChange={(e) => patch({ hashAlgorithm: e.target.value as HashAlgorithm })}
            aria-label="Hash algorithm"
            className="px-2 py-1 rounded bg-[var(--elevated)] text-sm outline-none"
          >
            {HASH_ALGOS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-[var(--muted)] flex flex-col gap-1">
          Time window (hours)
          <input
            type="number"
            min={0}
            step={0.5}
            value={settings.timeWindowHours}
            onChange={(e) => patch({ timeWindowHours: Math.max(0, Number(e.target.value) || 0) })}
            aria-label="Time window hours"
            className="px-2 py-1 rounded bg-[var(--elevated)] text-sm outline-none"
          />
        </label>

        <label className="text-xs text-[var(--muted)] flex flex-col gap-1">
          Minimum group size
          <input
            type="number"
            min={2}
            value={settings.minGroupSize}
            onChange={(e) => patch({ minGroupSize: Math.max(2, Number(e.target.value) || 2) })}
            aria-label="Minimum group size"
            className="px-2 py-1 rounded bg-[var(--elevated)] text-sm outline-none"
          />
        </label>

        <label className="text-xs text-[var(--muted)] flex flex-col gap-1">
          Theme
          <select
            value={settings.theme}
            onChange={(e) => patch({ theme: e.target.value as Theme })}
            aria-label="Theme"
            className="px-2 py-1 rounded bg-[var(--elevated)] text-sm outline-none capitalize"
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
            className="px-3 py-1.5 rounded bg-[var(--elevated)] hover:bg-[var(--elevated-hover)] text-sm text-[var(--muted)]"
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
