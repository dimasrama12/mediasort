import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useClickOutside } from "../lib/useClickOutside";
import { useFocusTrap } from "../lib/useFocusTrap";
import {
  saveSettings,
  resetSettings,
  emptyScratch,
  pickFolder,
  setReservedKeys,
} from "../lib/commands";
// Bundled, not read from disk. The portrait used to be loaded from a hard-coded `D:\foto\...`
// path on one developer's machine, which meant the feature simply did not exist on any other
// computer the installer ran on. Importing it makes Vite emit it into `dist/assets`, so it ships
// inside the executable's own resources like every other asset.
import portraitUrl from "../assets/special-portrait.jpg";
import type { AppSettings, HashAlgorithm, Theme } from "../lib/types";
import type { ActionId } from "../lib/keybindings";
import {
  ACTIONS,
  DEFAULT_KEYBINDINGS,
  bindingsWithDefaults,
  eventToCombo,
  formatCombo,
  reservedKeys,
} from "../lib/keybindings";

const THEMES: Theme[] = ["light", "dark", "system"];
const HASH_ALGOS: { value: HashAlgorithm; label: string }[] = [
  { value: "dhash", label: "dHash — fast (default)" },
  { value: "phash", label: "pHash — DCT, more robust" },
];

type Tab = "general" | "shortcuts" | "guide" | "special";
const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "guide", label: "User Guide" },
  { id: "special", label: "✦" }, // the "Special For You" tab, unlabeled on purpose
];

// The "Special For You" surface (§1): unlocked by either password; shows a portrait + message.
const SPECIAL_PASSWORDS = ["25052025", "19092004"];
const LOVE_MESSAGE =
  "Hai hai, my love... a.k.a Intan Sriwedari! ❤️ Aplikasi ini aku bikin khusus buat kamu... biar foto-foto yang bejibun itu nggak bikin pusing lagi. Jadi semuanya rapi, cantik, dan teratur - kayak kamu di hidup aku. [haha] Semoga tiap kali kamu pakai ini, kamu keinget kalau ada aku yang selalu siap bantuin kamu (dan nemenin kamu juga 😝). Hope you like it, bebe ✨";

export function SettingsPanel() {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const closeSettings = useAppStore((s) => s.closeSettings);

  const cardRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("general");
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  const [pw, setPw] = useState("");
  const [shake, setShake] = useState(false);

  // Clicking the app behind the modal closes it (§1) — but not while a shortcut capture is armed,
  // where the next input belongs to the capture and closing would strand it half-done.
  const onOutside = useCallback(() => {
    if (!capturing) closeSettings();
  }, [capturing, closeSettings]);
  useClickOutside(settingsOpen, cardRef, onOutside);
  useFocusTrap(settingsOpen, cardRef);

  const unlocked = SPECIAL_PASSWORDS.includes(pw.trim());
  const bindings = bindingsWithDefaults(settings.keybindings);
  /** Why the last capture was refused (a folder already holds that key), or null. */
  const [keyError, setKeyError] = useState<string | null>(null);

  // Patch one field (or several), then persist the whole object (fire-and-forget).
  const patch = (p: Partial<AppSettings>) => {
    const next = { ...settings, ...p };
    setSettings(next);
    void saveSettings(next).catch(() => {});
  };

  // Esc closes the panel — unless we're mid-capture (then Esc cancels the capture instead).
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !capturing) {
        e.preventDefault();
        closeSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, closeSettings, capturing]);

  // Shortcut capture: grab the next keypress (capture phase, so it beats every app handler),
  // assign it to the action being edited, and strip that combo from any other action so bindings
  // stay unique. Esc cancels. Reads/writes through getState so it needs no stale closures.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return; // bare modifier — keep waiting
      const st = useAppStore.getState();
      // A target folder's key is as real a binding as an action's. Stealing one would leave that
      // folder silently unreachable from the keyboard, so refuse and name it — the mirror image
      // of the check the sidebar runs when a folder tries to take an action's key.
      const clash = st.folders.find((f) => f.key !== "" && f.key === combo);
      if (clash) {
        setKeyError(`${formatCombo(combo)} is already the key for "${clash.name}".`);
        setCapturing(null);
        return;
      }
      setKeyError(null);
      const cur = bindingsWithDefaults(st.settings.keybindings);
      const next: Record<string, string[]> = {};
      for (const a of ACTIONS) {
        next[a.id] = a.id === capturing ? [combo] : (cur[a.id] ?? []).filter((c) => c !== combo);
      }
      const nextSettings = { ...st.settings, keybindings: next };
      st.setSettings(nextSettings);
      void saveSettings(nextSettings).catch(() => {});
      void setReservedKeys(reservedKeys(next)).catch(() => {});
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing]);

  // A wrong password nudges the field rather than saying nothing at all. Fires only once the
  // guess is as long as the real ones, so it does not scold you mid-typing.
  useEffect(() => {
    const guess = pw.trim();
    if (unlocked || guess.length < 8) return;
    setShake(true);
    const t = setTimeout(() => setShake(false), 420);
    return () => clearTimeout(t);
  }, [pw, unlocked]);

  if (!settingsOpen) return null;

  const onReset = () =>
    void resetSettings()
      .then((s) => {
        const merged = bindingsWithDefaults(s.keybindings);
        setSettings({ ...s, keybindings: merged });
        void setReservedKeys(reservedKeys(merged)).catch(() => {});
      })
      .catch(() => {});

  const resetOneShortcut = (id: ActionId) => {
    const next = { ...bindings, [id]: [...DEFAULT_KEYBINDINGS[id]] };
    patch({ keybindings: next });
    void setReservedKeys(reservedKeys(next)).catch(() => {});
  };

  const resetAllShortcuts = () => {
    const next = { ...DEFAULT_KEYBINDINGS };
    patch({ keybindings: next });
    void setReservedKeys(reservedKeys(next)).catch(() => {});
  };

  const chooseScratch = async () => {
    const p = await pickFolder();
    if (p) patch({ scratchPath: p });
  };

  return (
    <div className="anim-fade absolute inset-0 z-40 flex items-center justify-center bg-[var(--scrim)]">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="surface edge-lit flex max-h-[86vh] w-[540px] flex-col rounded-xl border border-[var(--border)]"
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 className="text-sm font-medium">Settings</h2>
          <button type="button" onClick={closeSettings} aria-label="Close" className="text-[var(--muted)] hover:text-[var(--text)]">
            ✕
          </button>
        </div>

        <div className="flex gap-1 px-4 pt-2 border-b border-[var(--border)]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              aria-label={t.id === "special" ? "Special" : undefined}
              className={`px-3 py-1.5 text-sm rounded-t ${
                tab === t.id ? "bg-[var(--elevated)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 overflow-auto flex flex-col gap-4">
          {tab === "general" && (
            <>
              <label className="text-xs text-[var(--muted)] flex flex-col gap-1">
                Similarity threshold: <span className="text-[var(--text)]">{settings.similarityThreshold}%</span>
                <input type="range" min={0} max={100} value={settings.similarityThreshold} onChange={(e) => patch({ similarityThreshold: Number(e.target.value) })} aria-label="Similarity threshold" />
              </label>

              <label className="text-xs text-[var(--muted)] flex flex-col gap-1">
                Similar-photo hashing
                <select value={settings.hashAlgorithm} onChange={(e) => patch({ hashAlgorithm: e.target.value as HashAlgorithm })} aria-label="Hash algorithm" className="px-2 py-1 rounded bg-[var(--elevated)] text-sm outline-none">
                  {HASH_ALGOS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>

              {/* "Minimum group size" and "Time window (hours)" used to sit here. Both are gone:
                  the minimum is fixed at 1 in `grouping.rs` on purpose (so no photo is ever
                  dropped from the results), which made the control a setting that changed
                  nothing, and the time window is a grouping internal rather than a preference. */}

              {/* Off by default, and deliberately so: a target folder living inside the scanned
                  root is somewhere files have already been filed *to*, so descending into it
                  handed every filed photo straight back to the library it was filed out of. */}
              <label className="text-xs text-[var(--muted)] flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={settings.scanSubfolders}
                  onChange={(e) => patch({ scanSubfolders: e.target.checked })}
                  className="mt-0.5"
                />
                <span className="flex flex-col">
                  <span>Scan sub-folders</span>
                  <span className="text-[10px]">
                    Off: a scanned folder shows only the files sitting directly in it, so the
                    target folders you file into stay out of the library.
                  </span>
                </span>
              </label>

              <label className="text-xs text-[var(--muted)] flex flex-col gap-1">
                Theme
                <select value={settings.theme} onChange={(e) => patch({ theme: e.target.value as Theme })} aria-label="Theme" className="px-2 py-1 rounded bg-[var(--elevated)] text-sm outline-none capitalize">
                  {THEMES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <div className="text-xs text-[var(--muted)] flex flex-col gap-1 border-t border-[var(--border)] pt-3">
                Scratch disk <span className="text-[10px]">(its contents are emptied every time the app closes)</span>
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-[var(--text)]" title={settings.scratchPath ?? undefined}>
                    {settings.scratchPath ?? "Not set"}
                  </span>
                  <button type="button" onClick={chooseScratch} className="px-2 py-1 rounded bg-[var(--elevated)] hover:bg-[var(--elevated-hover)]">
                    Choose…
                  </button>
                  {settings.scratchPath && (
                    <>
                      <button type="button" onClick={() => patch({ scratchPath: null })} className="px-2 py-1 rounded bg-[var(--elevated)] hover:bg-[var(--elevated-hover)]">
                        Clear
                      </button>
                      <button type="button" onClick={() => void emptyScratch().catch(() => {})} className="px-2 py-1 rounded bg-red-600/80 hover:bg-red-600 text-white">
                        Clean now
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="pt-1">
                <button type="button" onClick={onReset} className="px-3 py-1.5 rounded bg-[var(--elevated)] hover:bg-[var(--elevated-hover)] text-sm text-[var(--muted)]">
                  Reset to defaults
                </button>
              </div>
            </>
          )}

          {tab === "shortcuts" && (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] text-[var(--muted)] mb-1">
                Click <em>Edit</em>, then press the key combination. Esc cancels; the combo is moved off any other action it was on.
              </p>
              {keyError && <p className="text-red-400 text-[11px] mb-1">{keyError}</p>}
              {ACTIONS.map((a) => (
                <div key={a.id} className="flex items-center gap-2 py-1 text-sm">
                  <span className="flex-1 min-w-0 truncate text-[var(--text)]">{a.label}</span>
                  <span className="text-[11px] text-[var(--muted)] w-40 text-right truncate">
                    {capturing === a.id ? "Press a key…" : (bindings[a.id] ?? []).map(formatCombo).join(", ") || "—"}
                  </span>
                  <button type="button" onClick={() => setCapturing(a.id)} aria-label={`Edit ${a.label}`} className="px-2 py-0.5 rounded bg-[var(--elevated)] hover:bg-[var(--elevated-hover)] text-xs">
                    Edit
                  </button>
                  <button type="button" onClick={() => resetOneShortcut(a.id)} aria-label={`Reset ${a.label}`} className="px-2 py-0.5 rounded bg-[var(--elevated)] hover:bg-[var(--elevated-hover)] text-xs text-[var(--muted)]">
                    ↺
                  </button>
                </div>
              ))}
              <div className="pt-2">
                <button type="button" onClick={resetAllShortcuts} className="px-3 py-1.5 rounded bg-[var(--elevated)] hover:bg-[var(--elevated-hover)] text-sm text-[var(--muted)]">
                  Reset all shortcuts
                </button>
              </div>
            </div>
          )}

          {tab === "guide" && (
            <div className="text-sm text-[var(--text)] flex flex-col gap-3">
              <div>
                <h3 className="font-medium mb-1">Getting started</h3>
                <ol className="list-decimal list-inside text-[13px] text-[var(--muted)] space-y-0.5">
                  <li>Scan one or more parent folders (Scan folder / Ctrl+O). Add another library later with the blue + or Ctrl+Shift+O — the one you already have stays open.</li>
                  <li>Add target folders in the sidebar (New folder / Ctrl+N, or “Add existing folders…”). Each gets a key for this session — click the key chip to change it to any letter or symbol. There is no limit on how many.</li>
                  <li>Browse in Grid ([) or List (]) view; Sort and Group from the toolbar.</li>
                  <li>Press a folder’s key to move the focused file (or the whole selection) into it.</li>
                  <li>Delete/B sends files to the in-app Trash (restorable); Ctrl+Z/Ctrl+Y undo/redo.</li>
                  <li>
                    Open the Trash from the button at the foot of the sidebar (or press T), pick
                    thumbnails, and Restore — or drag them back onto the grid.
                  </li>
                  <li>
                    Press <strong className="text-[var(--text)]">Esc</strong> to stop a scan or a
                    grouping run that is still going.
                  </li>
                </ol>
              </div>
              <div>
                <h3 className="font-medium mb-1">Selecting files</h3>
                <ul className="list-disc list-inside text-[13px] text-[var(--muted)] space-y-0.5">
                  <li>Click a tile to select it; Ctrl+Click adds one; Shift+Click takes the range.</li>
                  <li>Drag across empty space to sweep a marquee over a block of thumbnails.</li>
                  <li>Drag a selection onto a sidebar folder to move it there.</li>
                  <li>Enter opens the focused file in the preview; Esc closes it.</li>
                  <li>Right-click a tile for Move to Trash, Refresh and EXIF Data.</li>
                  <li>With several libraries open, Group asks which ones to cover.</li>
                  <li>
                    While a target folder is open, its files can be filed straight into another
                    one — drag them onto it, or press its key.
                  </li>
                </ul>
              </div>
              <p className="text-[12px] text-[var(--muted)] border-t border-[var(--border)] pt-3">
                Every key combination lives in the <strong className="text-[var(--text)]">Shortcuts</strong>{" "}
                tab, where each one can be rebound — including{" "}
                <strong className="text-[var(--text)]">Ctrl+&apos; pressed twice</strong>, which
                opens and closes this window from anywhere.
              </p>
            </div>
          )}

          {tab === "special" && (
            <div className="flex flex-col items-center gap-3 text-center">
              {!unlocked ? (
                <div className="flex w-full flex-col items-center gap-3 py-6">
                  {/* The locked placeholder is drawn, not loaded: no file to find, no path to get
                      wrong, and it looks identical on every machine the installer lands on. */}
                  <div
                    aria-hidden
                    className="relative grid h-28 w-28 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--elevated)]"
                  >
                    <span className="absolute inset-0 rounded-2xl bg-[var(--accent-faint)]" />
                    <span className="relative grid h-14 w-14 place-items-center rounded-full bg-[var(--panel)] text-2xl">
                      🔒
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted)]">This one’s locked. 🔒</p>
                  <input
                    type="password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="Enter the password…"
                    aria-label="Special password"
                    className={`w-56 rounded-md border px-2 py-1.5 text-center text-sm outline-none transition-colors ${
                      shake
                        ? "border-red-500/70 bg-red-500/10"
                        : "border-transparent bg-[var(--elevated)]"
                    }`}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  {/* Bundled with the app, so it works on any machine the installer runs on. */}
                  <img
                    src={portraitUrl}
                    alt="A special someone"
                    decoding="async"
                    className="max-h-64 rounded-xl object-contain shadow-[var(--shadow-3)]"
                  />
                  <p className="max-w-md whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
                    {LOVE_MESSAGE}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end px-4 py-3 border-t border-[var(--border)]">
          <button type="button" onClick={closeSettings} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm font-medium">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
