import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import {
  createFolder,
  renameFolder,
  deleteFolder,
  addExistingFolders,
  pickFolders,
  listFolderFiles,
  listTargetFolders,
  reorderFolders,
  saveSettings,
  setFolderKey,
} from "../lib/commands";
import { moveToFolder } from "../lib/fileActions";
import { bindingsWithDefaults, eventToCombo, formatCombo } from "../lib/keybindings";
import { keyConflict } from "../lib/folderKeys";
import { groupColor } from "../lib/groupColors";

export function Sidebar() {
  const folders = useAppStore((s) => s.folders);
  const roots = useAppStore((s) => s.roots);
  const upsertFolder = useAppStore((s) => s.upsertFolder);
  const setFolders = useAppStore((s) => s.setFolders);
  const groups = useAppStore((s) => s.groups);
  const activeGroupId = useAppStore((s) => s.activeGroupId);
  const setActiveGroup = useAppStore((s) => s.setActiveGroup);
  const openFolderBrowse = useAppStore((s) => s.openFolderBrowse);
  const browseFolder = useAppStore((s) => s.browseFolder);
  const draggingIds = useAppStore((s) => s.draggingIds);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const newFolderRequested = useAppStore((s) => s.newFolderRequested);
  const settings = useAppStore((s) => s.settings);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  /** The folder whose key chip is armed and waiting for a keypress, or null. */
  const [capturingKey, setCapturingKey] = useState<string | null>(null);
  const base = roots[0] ?? "";
  const dragging = draggingIds.length > 0;

  // Ctrl+N (via the store nonce) opens the inline "new folder" input — when there is a base to
  // create under. Keyed on the nonce only (base read fresh) so a later scan can't reopen it.
  useEffect(() => {
    if (newFolderRequested === 0) return;
    if (useAppStore.getState().roots[0] ?? "") setAdding(true);
  }, [newFolderRequested]);

  // Capture the next keypress and give it to the folder being edited. Capture phase, so it beats
  // the grid's own handler — otherwise pressing "F" to *assign* F would file the selection into
  // whichever folder already had it.
  useEffect(() => {
    if (!capturingKey) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setCapturingKey(null);
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return; // bare modifier — keep waiting
      const st = useAppStore.getState();
      const conflict = keyConflict(
        combo,
        bindingsWithDefaults(st.settings.keybindings),
        st.folders,
        capturingKey,
      );
      if (conflict) {
        setError(conflict);
        setCapturingKey(null);
        return;
      }
      setCapturingKey(null);
      setError(null);
      void setFolderKey(capturingKey, combo)
        .then(setFolders)
        .catch((err) => setError(String(err)));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturingKey, setFolders]);

  /** Flip the A→Z ordering. The setting is saved *before* the reorder, because the backend reads
   *  the flag straight from settings.json — the save is how the two agree on what "on" means. */
  async function onToggleSort(on: boolean) {
    const st = useAppStore.getState();
    const next = { ...st.settings, sortFoldersAlphabetically: on };
    st.setSettings(next);
    try {
      await saveSettings(next);
      setFolders(await reorderFolders());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed || !base) return;
    try {
      const created = await createFolder(base, trimmed);
      // With A→Z on the backend re-keys the *whole* list to keep 1 at the top, so taking only the
      // new folder back would leave every other chip showing a key it no longer has.
      if (useAppStore.getState().settings.sortFoldersAlphabetically) {
        setFolders(await listTargetFolders());
      } else {
        upsertFolder(created);
      }
      setName("");
      setAdding(false);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  /** Register one or more existing folders as targets in a single pick (§2 multi-select). */
  async function onAddExisting() {
    try {
      const paths = await pickFolders();
      if (!paths || paths.length === 0) return;
      setFolders(await addExistingFolders(paths));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  /** Drop a dragged selection straight onto a target folder (§2). The dragged ids come from the
   *  store rather than `dataTransfer`, which is deliberately unreadable during a drag.
   *
   *  The source can be the scanned library **or another target folder being browsed** — that is
   *  the folder-to-folder move; `moveToFolder` picks the right store reducer for each. */
  async function onDrop(id: string) {
    const folder = folders.find((f) => f.id === id);
    setDropTarget(null);
    const st = useAppStore.getState();
    const ids = st.draggingIds;
    st.setDraggingIds([]);
    if (!folder || ids.length === 0) return;
    const source = st.browseFolder ? st.browseFiles : st.files;
    const picked = source.filter((f) => ids.includes(f.id));
    if (picked.length === 0 || folder.id === st.browseFolder?.id) return;
    try {
      await moveToFolder(picked, folder);
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

  /** Open a target folder in the grid so you can see what actually landed in it (3). */
  async function onBrowse(id: string) {
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    try {
      openFolderBrowse(folder, await listFolderFiles(folder.path));
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

  if (collapsed) {
    return (
      <aside className="w-11 shrink-0 border-r border-[var(--border)] bg-[var(--panel)] flex flex-col items-center gap-1 py-2">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Expand sidebar"
          title="Expand sidebar (Ctrl+H)"
          className="press grid h-7 w-7 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)]"
        >
          »
        </button>
        <div className="my-1 h-px w-6 bg-[var(--border)]" />
        {/* The key chips stay reachable as drop targets even with the sidebar collapsed. */}
        {folders.map((f) => (
          <button
            key={f.id}
            type="button"
            title={`${f.name} — ${f.fileCount} item${f.fileCount === 1 ? "" : "s"}`}
            aria-label={`Open ${f.name}`}
            onClick={() => void onBrowse(f.id)}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDropTarget(f.id);
            }}
            onDragLeave={() => setDropTarget((t) => (t === f.id ? null : t))}
            onDrop={(e) => {
              e.preventDefault();
              void onDrop(f.id);
            }}
            className={`press grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs tabular-nums ${
              dropTarget === f.id
                ? "bg-[var(--accent)] text-white"
                : browseFolder?.id === f.id
                  ? "bg-[var(--accent-faint)] text-[var(--text)]"
                  : "bg-[var(--elevated)] text-[var(--muted)] hover:bg-[var(--elevated-hover)] hover:text-[var(--text)]"
            }`}
          >
            {f.key || "—"}
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="w-56 shrink-0 border-r border-[var(--border)] bg-[var(--panel)] flex flex-col overflow-auto">
      <div className="flex items-center gap-1 p-2">
        <div
          className="flex-1 min-w-0 text-[11px] text-[var(--muted)] truncate"
          title={roots.length > 0 ? roots.join("\n") : undefined}
        >
          {base || "No folder scanned"}
          {roots.length > 1 && (
            <span className="ml-1 text-[var(--accent-hover)]">+{roots.length - 1} more</span>
          )}
        </div>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Collapse sidebar"
          title="Collapse sidebar (Ctrl+H)"
          className="press grid h-6 w-6 place-items-center rounded text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)] text-xs"
        >
          «
        </button>
      </div>

      {folders.length > 0 && (
        <label className="flex items-center gap-2 px-2 pb-1 text-[11px] text-[var(--muted)]">
          <input
            type="checkbox"
            checked={settings.sortFoldersAlphabetically}
            onChange={(e) => void onToggleSort(e.target.checked)}
            aria-label="Sort target folders alphabetically"
          />
          A→Z
        </label>
      )}

      <ul className="flex-1">
        {folders.map((f, i) => {
          const armed = dropTarget === f.id;
          const active = browseFolder?.id === f.id;
          return (
            <li
              key={f.id}
              data-active={active}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault(); // without this the browser refuses the drop
                e.dataTransfer.dropEffect = "move";
                setDropTarget(f.id);
              }}
              onDragLeave={() => setDropTarget((t) => (t === f.id ? null : t))}
              onDrop={(e) => {
                e.preventDefault();
                void onDrop(f.id);
              }}
              style={{ animationDelay: `${Math.min(i, 8) * 22}ms` }}
              // Armed = the dragged files will land here. One solid fill of the accent, no
              // outline and no pulse: at a screenful of rows a ring of pulsing dashed boxes was
              // the loudest thing on screen during the app's most common gesture.
              className={`row-rail mx-1 flex items-center gap-2 rounded-md px-2 py-1.5 pl-2.5 text-sm ${
                armed
                  ? "bg-[var(--accent)] text-white"
                  : active
                    ? "bg-[var(--accent-faint)] text-[var(--text)]"
                    : "text-[var(--text)] hover:bg-[var(--elevated)]"
              }`}
            >
              <button
                type="button"
                onClick={() => setCapturingKey(f.id)}
                aria-label={`Change the key for ${f.name}`}
                title={`Key: ${f.key ? formatCombo(f.key) : "none"} — click to change`}
                className={`press grid h-5 min-w-5 shrink-0 place-items-center rounded px-1 text-[11px] tabular-nums transition-colors ${
                  armed ? "bg-white/25 text-white" : "bg-[var(--elevated)] text-[var(--muted)]"
                }`}
              >
                {capturingKey === f.id ? "…" : f.key ? formatCombo(f.key) : "—"}
              </button>
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
                  className="flex-1 min-w-0 px-1 rounded bg-[var(--elevated)] text-sm outline-none"
                />
              ) : (
                <button
                  type="button"
                  aria-label={`Open ${f.name}`}
                  className={`flex-1 min-w-0 truncate text-left transition-colors ${
                    armed
                      ? "text-white"
                      : active
                        ? "font-medium text-[var(--accent-hover)]"
                        : "hover:text-[var(--accent-hover)]"
                  }`}
                  title={`${f.path} — click to see what is inside`}
                  onClick={() => void onBrowse(f.id)}
                >
                  {f.name}
                </button>
              )}
              <span
                className={`rounded px-1.5 text-[11px] tabular-nums ${
                  armed ? "bg-white/25 text-white" : "bg-[var(--elevated)] text-[var(--muted)]"
                }`}
                title={`${f.fileCount} item${f.fileCount === 1 ? "" : "s"} in this folder`}
              >
                {f.fileCount}
              </span>
              <button
                aria-label={`Rename ${f.name}`}
                onClick={() => {
                  setEditingId(f.id);
                  setEditName(f.name);
                }}
                className="press text-[var(--muted)] hover:text-[var(--text)] text-xs px-0.5"
              >
                &#9998;
              </button>
              <button
                aria-label={`Delete ${f.name}`}
                onClick={() => onDelete(f.id)}
                className="press text-[var(--muted)] hover:text-red-400 text-xs px-0.5"
              >
                ×
              </button>
            </li>
          );
        })}
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
            className="px-2 py-1 rounded bg-[var(--elevated)] text-sm outline-none"
          />
          {error && <span className="text-red-400 text-xs">{error}</span>}
        </div>
      ) : (
        <div className="m-2 flex flex-col gap-1">
          <button
            onClick={() => setAdding(true)}
            disabled={!base}
            title="New target folder (Ctrl+N)"
            className="press px-2 py-1 rounded-md bg-[var(--elevated)] hover:bg-[var(--elevated-hover)] disabled:opacity-40 text-sm"
          >
            New folder
          </button>
          <button
            onClick={onAddExisting}
            title="Register one or more existing folders as targets"
            className="press px-2 py-1 rounded-md bg-[var(--elevated)] hover:bg-[var(--elevated-hover)] disabled:opacity-40 text-xs text-[var(--muted)]"
          >
            Add existing folders…
          </button>
          {error && <span className="text-red-400 text-xs">{error}</span>}
        </div>
      )}

      {groups.length > 0 && (
        <div className="border-t border-[var(--border)]">
          <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">
            Groups ({groups.length})
          </div>
          <ul>
            {/* "All" shows every file, ordered group 1, 2, 3...; picking one group shows only it. */}
            <li>
              <button
                onClick={() => setActiveGroup(null)}
                aria-pressed={activeGroupId === null}
                data-active={activeGroupId === null}
                title="Show every file, ordered by group"
                className={`row-rail w-full flex items-center gap-2 px-2 py-1 pl-2.5 text-sm text-left ${
                  activeGroupId === null
                    ? "bg-[var(--accent-soft)] text-[var(--text)]"
                    : "text-[var(--text)] hover:bg-[var(--elevated)]"
                }`}
              >
                <span className="text-xs" aria-hidden>
                  ☰
                </span>
                <span className="flex-1 truncate font-medium">All</span>
                <span className="text-[var(--muted)] text-xs tabular-nums">
                  {groups.reduce((n, g) => n + g.fileIds.length, 0)}
                </span>
                <span className="w-9" />
              </button>
            </li>
            {groups.map((g, i) => (
              <li key={g.id}>
                <button
                  onClick={() => setActiveGroup(activeGroupId === g.id ? null : g.id)}
                  aria-pressed={activeGroupId === g.id}
                  data-active={activeGroupId === g.id}
                  title={g.timeSpan ?? undefined}
                  className={`row-rail w-full flex items-center gap-2 px-2 py-1 pl-2.5 text-sm text-left ${
                    activeGroupId === g.id
                      ? "bg-[var(--accent-soft)] text-[var(--text)]"
                      : "text-[var(--text)] hover:bg-[var(--elevated)]"
                  }`}
                >
                  <span
                    aria-hidden
                    data-testid="group-color"
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold text-black/75 ring-1 ring-black/40"
                    style={{ backgroundColor: groupColor(i) }}
                  >
                    {/* The number, not only the hue: colour alone is invisible to a colour-blind
                        user and indistinguishable past seven groups. */}
                    {i + 1 <= 99 ? i + 1 : ""}
                  </span>
                  <span className="flex-1 truncate">{g.name}</span>
                  <span className="text-[var(--muted)] text-xs tabular-nums">{g.fileIds.length}</span>
                  <span className="text-[var(--muted)] text-[10px] w-9 text-right tabular-nums">
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
