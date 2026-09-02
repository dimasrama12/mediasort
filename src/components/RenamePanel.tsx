import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { filterFiles } from "../lib/filter";
import { batchRename } from "../lib/commands";

const seqStr = (start: number, pad: number) => {
  const s = String(start);
  return pad > 0 ? s.padStart(pad, "0") : s;
};

/** Mirror of the backend's name computation, for the live preview. */
export function previewName(pattern: string, start: number, pad: number, ext: string): string {
  const num = seqStr(start, pad);
  const base = pattern.includes("{n}") ? pattern.split("{n}").join(num) : `${pattern} ${num}`;
  return ext ? `${base}.${ext}` : base;
}

export function RenamePanel() {
  const renameOpen = useAppStore((s) => s.renameOpen);
  const files = useAppStore((s) => s.files);
  const query = useAppStore((s) => s.query);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const closeRename = useAppStore((s) => s.closeRename);
  const completeRename = useAppStore((s) => s.completeRename);

  const [pattern, setPattern] = useState("Photo {n}");
  const [start, setStart] = useState(1);
  const [pad, setPad] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Targets: the selection if any, else every visible (filtered) file — matches the grid.
  const targets = useMemo(() => {
    if (!renameOpen) return [];
    return selectedIds.length > 0
      ? files.filter((f) => selectedIds.includes(f.id))
      : filterFiles(files, query);
  }, [renameOpen, files, query, selectedIds]);

  useEffect(() => {
    if (!renameOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRename();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renameOpen, closeRename]);

  if (!renameOpen) return null;

  const preview = previewName(pattern, start, pad, targets[0]?.extension ?? "jpg");

  const onApply = async () => {
    if (busy || targets.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const ids = targets.map((f) => f.id);
      const paths = targets.map((f) => f.path);
      const newFiles = await batchRename(paths, pattern, start, pad);
      completeRename(ids, newFiles); // also closes the panel
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50">
      <div className="w-[420px] rounded-lg bg-neutral-900 border border-neutral-700 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            Rename {targets.length} file{targets.length === 1 ? "" : "s"}
          </h2>
          <button
            type="button"
            onClick={closeRename}
            aria-label="Close"
            className="text-neutral-400 hover:text-neutral-100"
          >
            ✕
          </button>
        </div>

        <label className="text-xs text-neutral-400 flex flex-col gap-1">
          Pattern (use <code className="text-neutral-300">{"{n}"}</code> for the number)
          <input
            autoFocus
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            aria-label="Rename pattern"
            className="px-2 py-1 rounded bg-neutral-800 text-sm outline-none"
          />
        </label>

        <div className="flex gap-3">
          <label className="text-xs text-neutral-400 flex flex-col gap-1 flex-1">
            Start
            <input
              type="number"
              value={start}
              onChange={(e) => setStart(Number(e.target.value) || 0)}
              aria-label="Start number"
              className="px-2 py-1 rounded bg-neutral-800 text-sm outline-none"
            />
          </label>
          <label className="text-xs text-neutral-400 flex flex-col gap-1 flex-1">
            Zero-pad width
            <input
              type="number"
              min={0}
              value={pad}
              onChange={(e) => setPad(Math.max(0, Number(e.target.value) || 0))}
              aria-label="Zero-pad width"
              className="px-2 py-1 rounded bg-neutral-800 text-sm outline-none"
            />
          </label>
        </div>

        <div className="text-xs text-neutral-500">
          First file → <span className="text-neutral-300">{preview}</span>
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={closeRename}
            className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={busy || targets.length === 0}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium"
          >
            {busy ? "Renaming…" : "Rename"}
          </button>
        </div>
      </div>
    </div>
  );
}
