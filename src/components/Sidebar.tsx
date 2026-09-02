import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { createFolder, renameFolder, deleteFolder } from "../lib/commands";

export function Sidebar() {
  const folders = useAppStore((s) => s.folders);
  const roots = useAppStore((s) => s.roots);
  const upsertFolder = useAppStore((s) => s.upsertFolder);
  const setFolders = useAppStore((s) => s.setFolders);
  const groups = useAppStore((s) => s.groups);
  const setFocus = useAppStore((s) => s.setFocus);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
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

  async function onRename(id: string) {
    const trimmed = editName.trim();
    setEditingId(null);
    if (!trimmed) return;
    try {
      setFolders(await renameFolder(id, trimmed));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onDelete(id: string) {
    try {
      setFolders(await deleteFolder(id));
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
            {editingId === f.id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onRename(f.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                onBlur={() => setEditingId(null)}
                className="flex-1 min-w-0 px-1 rounded bg-neutral-800 text-sm outline-none"
              />
            ) : (
              <span
                className="flex-1 truncate cursor-text"
                title={f.path}
                onDoubleClick={() => {
                  setEditingId(f.id);
                  setEditName(f.name);
                }}
              >
                {f.name}
              </span>
            )}
            <span className="text-neutral-500 text-xs">{f.fileCount}</span>
            <button
              aria-label={`Delete ${f.name}`}
              onClick={() => onDelete(f.id)}
              className="text-neutral-500 hover:text-red-400 text-xs px-1"
            >
              ×
            </button>
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
      {groups.length > 0 && (
        <div className="border-t border-neutral-800">
          <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-neutral-500">
            Groups ({groups.length})
          </div>
          <ul>
            {groups.map((g) => (
              <li key={g.id}>
                <button
                  onClick={() => g.fileIds[0] && setFocus(g.fileIds[0])}
                  title={g.timeSpan ?? undefined}
                  className="w-full flex items-center gap-2 px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-800 text-left"
                >
                  <span className="text-xs" aria-hidden>
                    {g.groupType === "visual" ? "◈" : "◷"}
                  </span>
                  <span className="flex-1 truncate">{g.name}</span>
                  <span className="text-neutral-500 text-xs">{g.fileIds.length}</span>
                  <span className="text-neutral-600 text-[10px] w-9 text-right">
                    {g.groupType === "visual" ? `${Math.round(g.similarity)}%` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
