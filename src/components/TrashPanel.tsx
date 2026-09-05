import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { SelectedCheck } from "./SelectedCheck";
import { listTrash, restoreFromTrash, fileInfos } from "../lib/commands";
import { useClickOutside } from "../lib/useClickOutside";
import { useThumbnail } from "../lib/useThumbnail";
import { syncFolders } from "../lib/fileActions";
import type { FileInfo, FileType, TrashItem } from "../lib/types";

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

/** Extensions the app treats as video; everything else supported is a still. Mirrors the Rust
 *  `FileType::from_extension` closely enough to pick the right tile treatment. */
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v", "wmv", "flv"]);

const extensionOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};

/** Adapt a `TrashItem` to the `FileInfo` shape `useThumbnail` already knows how to render.
 *
 *  The trashed file is still a real file on disk (under the app-data trash directory) — it is
 *  only its *name* that changed — so the ordinary thumbnail pipeline works on it unmodified.
 *  That is what lets the trash show the same tiles as the library instead of a list of names:
 *  you cannot decide whether to restore a photo you cannot see. */
export function trashItemAsFile(it: TrashItem): FileInfo {
  const extension = extensionOf(it.name);
  return {
    id: it.id,
    path: it.trashPath,
    name: it.name,
    extension,
    size: it.size,
    // The thumbnail cache key is `id|modifiedAt|size`; a trash entry never changes after it is
    // created, so its deletion timestamp is a stable, correct stand-in for mtime.
    modifiedAt: it.deletedAt,
    dateTaken: null,
    fileType: (VIDEO_EXT.has(extension) ? "video" : "image") as FileType,
    groupId: null,
  };
}

/** Restore `items` to the paths they came from and put them back in the library grid (§2).
 *  Each restore is independent: one file whose original folder has since been deleted must not
 *  stop the rest of the batch. Returns how many actually came back. */
export async function restoreItems(items: TrashItem[]): Promise<number> {
  const paths: string[] = [];
  for (const it of items) {
    try {
      paths.push(await restoreFromTrash(it.id, it.originalPath));
    } catch {
      /* keep going — a failed restore is reported by the item staying in the trash */
    }
  }
  if (paths.length > 0) {
    // The backend hands back a path; the grid needs a whole FileInfo, so rebuild them there.
    const infos = await fileInfos(paths).catch(() => []);
    useAppStore.getState().addRestoredFiles(infos);
    // A file can be restored straight back into a target folder — re-read the counts.
    await syncFolders();
  }
  return paths.length;
}

export function TrashPanel() {
  const trashOpen = useAppStore((s) => s.trashOpen);
  const trashItems = useAppStore((s) => s.trashItems);
  const selectedIds = useAppStore((s) => s.trashSelectedIds);
  const setTrashItems = useAppStore((s) => s.setTrashItems);
  const closeTrash = useAppStore((s) => s.closeTrash);
  const toggleTrashSelected = useAppStore((s) => s.toggleTrashSelected);
  const selectTrashRangeTo = useAppStore((s) => s.selectTrashRangeTo);
  const setTrashSelection = useAppStore((s) => s.setTrashSelection);
  const clearTrashSelection = useAppStore((s) => s.clearTrashSelection);
  const setDraggingTrashIds = useAppStore((s) => s.setDraggingTrashIds);
  const draggingTrashIds = useAppStore((s) => s.draggingTrashIds);
  const requestEmptyTrash = useAppStore((s) => s.requestEmptyTrash);
  const panelRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const refresh = useCallback(
    () =>
      void listTrash()
        .then(setTrashItems)
        .catch(() => {}),
    [setTrashItems],
  );

  useEffect(() => {
    if (trashOpen) refresh();
  }, [trashOpen, refresh]);

  useEffect(() => {
    if (!trashOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeTrash();
      } else if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setTrashSelection(useAppStore.getState().trashItems.map((i) => i.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trashOpen, closeTrash, setTrashSelection]);

  // Clicking the app behind the panel closes it (§1). A drag-to-restore uses drag events, not
  // mousedown, so dropping onto the grid never trips this.
  useClickOutside(trashOpen, panelRef, closeTrash);

  if (!trashOpen) return null;

  const selected = trashItems.filter((it) => selectedIds.includes(it.id));
  const totalSize = trashItems.reduce((n, it) => n + it.size, 0);

  const run = async (items: TrashItem[]) => {
    if (items.length === 0 || busy) return;
    setBusy(true);
    try {
      await restoreItems(items);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  // Dragging a tile drags the whole selection when that tile is part of it, and just that tile
  // otherwise — the same rule the grid's tiles follow.
  const onDragStart = (id: string) => (e: React.DragEvent) => {
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    if (!selectedIds.includes(id)) setTrashSelection(ids);
    setDraggingTrashIds(ids);
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", ids.join("\n"));
  };
  const endDrag = () => {
    setDraggingTrashIds([]);
    setDropActive(false);
  };

  /** The grid showing through beside the panel is the drop target: dropping there restores. */
  const onDropToGrid = (e: React.DragEvent) => {
    e.preventDefault();
    const ids = useAppStore.getState().draggingTrashIds;
    endDrag();
    const items = trashItems.filter((it) => ids.includes(it.id));
    void run(items);
  };

  return (
    <div className="absolute inset-0 z-40 flex justify-end">
      {/* Backdrop = the app itself, dimmed. It closes the panel on a click, and catches a drag
          out of the trash as a restore (§2) — "drag them back into the grid" literally. */}
      <div
        data-testid="trash-drop-zone"
        aria-label="Drop trashed files here to restore them"
        onDragOver={(e) => {
          if (draggingTrashIds.length === 0) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={onDropToGrid}
        className={`anim-fade flex-1 transition-colors ${
          dropActive
            ? "bg-[var(--accent-soft)]"
            : draggingTrashIds.length > 0
              ? "bg-black/30"
              : "bg-[var(--scrim)]"
        }`}
      >
        {draggingTrashIds.length > 0 && (
          <div className="grid h-full place-items-center">
            <div className="rounded-xl border-2 border-dashed border-[var(--accent)] bg-black/60 px-6 py-4 text-sm text-white">
              Drop to restore {draggingTrashIds.length} file
              {draggingTrashIds.length > 1 ? "s" : ""}
            </div>
          </div>
        )}
      </div>

      <div
        ref={panelRef}
        className="surface edge-lit flex h-full w-[420px] flex-col border-l border-[var(--border)]"
      >
        <header className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
          <span aria-hidden className="text-base leading-none">
            🗑
          </span>
          <h2 className="text-sm font-medium">Trash</h2>
          <span className="rounded-full bg-[var(--elevated)] px-2 text-[11px] tabular-nums text-[var(--muted)]">
            {trashItems.length}
          </span>
          {trashItems.length > 0 && (
            <span className="text-[11px] tabular-nums text-[var(--muted)]">{kb(totalSize)}</span>
          )}
          <button
            type="button"
            onClick={closeTrash}
            className="press ml-auto grid h-6 w-6 place-items-center rounded text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)]"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {trashItems.length > 0 && (
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
            <p className="flex-1 text-[11px] text-[var(--muted)]">
              Click a tile to select · Shift for a range · drag onto the grid to restore
            </p>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => clearTrashSelection()}
                className="press rounded px-1.5 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)]"
              >
                Clear {selected.length}
              </button>
            )}
          </div>
        )}

        <div
          className="flex-1 overflow-auto p-2"
          onDragEnd={endDrag}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Trashed files"
        >
          {trashItems.length === 0 ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <div className="text-3xl opacity-40" aria-hidden>
                  🗑
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">Trash is empty.</p>
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  Files you delete land here first, and can be dragged back out.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {trashItems.map((it) => (
                <TrashTile
                  key={it.id}
                  item={it}
                  selected={selectedIds.includes(it.id)}
                  onDragStart={onDragStart(it.id)}
                  onDragEnd={endDrag}
                  onPick={(e) => {
                    // Single click **toggles** here, unlike the library grid: the trash is a
                    // pick-list, not a browsing surface, and requiring Ctrl to build up a
                    // multi-file restore was the friction this replaces.
                    if (e.shiftKey) selectTrashRangeTo(it.id);
                    else toggleTrashSelected(it.id);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* One row, two buttons — the destructive one on the left, well away from Restore. */}
        <footer className="flex items-center gap-2 border-t border-[var(--border)] p-3">
          <button
            type="button"
            onClick={() => requestEmptyTrash()}
            className="press flex-1 rounded-md bg-red-600/80 px-3 py-2 text-sm text-white hover:bg-red-600 disabled:opacity-40"
            disabled={trashItems.length === 0 || busy}
            title="Send everything in the trash to the Recycle Bin"
          >
            Empty Trash
          </button>
          <button
            type="button"
            onClick={() => void run(selected)}
            className="press flex-1 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
            disabled={selected.length === 0 || busy}
          >
            {busy ? "Restoring…" : `Restore${selected.length > 0 ? ` (${selected.length})` : ""}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** One thumbnail tile in the trash grid — the same treatment a library tile gets, so restoring
 *  is a visual decision rather than a guess from a filename. */
function TrashTile({
  item,
  selected,
  onPick,
  onDragStart,
  onDragEnd,
}: {
  item: TrashItem;
  selected: boolean;
  onPick: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const file = trashItemAsFile(item);
  const { url, status } = useThumbnail(file);

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onPick}
      title={`${item.name}\n${item.originalPath || "(unknown original location)"}\n${kb(item.size)}`}
      className={`tile relative aspect-square overflow-hidden rounded-lg border text-left ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-[var(--border)] bg-[var(--elevated)]"
      }`}
    >
      {status === "ready" && url && (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {status === "loading" && <span className="shimmer absolute inset-0" aria-hidden />}
      {(status === "placeholder" || status === "error") && (
        <span
          className="absolute inset-0 grid place-items-center text-2xl text-[var(--muted)]"
          aria-hidden
        >
          {file.fileType === "video" ? "▶" : "🖼"}
        </span>
      )}

      {/* The same corner tick the grid uses — one mark for "picked", wherever you are. */}
      {selected && <SelectedCheck />}

      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-3 text-[10px] leading-tight text-white">
        {item.name}
      </span>
    </button>
  );
}
