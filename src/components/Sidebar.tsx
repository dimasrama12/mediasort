import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { createFolder } from "../lib/commands";

export function Sidebar() {
  const folders = useAppStore((s) => s.folders);
  const roots = useAppStore((s) => s.roots);
  const upsertFolder = useAppStore((s) => s.upsertFolder);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const base = roots[0] ?? "";
  const full = folders.length >= 9;

  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed || !base) return;
    try {
      upsertFolder(await createFolder(base, trimmed));
      setName("");
      setAdding(false);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <aside className="w-56 shrink-0 border-r border-neutral-800 bg-neutral-900 flex flex-col overflow-auto">
      <div className="p-2 text-[11px] text-neutral-500 truncate" title={base}>
        {base || "No folder scanned"}
      </div>
      <ul className="flex-1">
        {folders.map((f) => (
          <li key={f.id} className="flex items-center gap-2 px-2 py-1 text-sm text-neutral-200">
            <kbd className="w-5 h-5 grid place-items-center rounded bg-neutral-800 text-xs">{f.shortcut}</kbd>
            <span className="flex-1 truncate" title={f.path}>{f.name}</span>
            <span className="text-neutral-500 text-xs">{f.fileCount}</span>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="p-2 flex flex-col gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreate();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="Folder name"
            className="px-2 py-1 rounded bg-neutral-800 text-sm outline-none"
          />
          {error && <span className="text-red-400 text-xs">{error}</span>}
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={full || !base}
          className="m-2 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-sm"
        >
          {full ? "All 9 keys used" : "New folder"}
        </button>
      )}
    </aside>
  );
}
