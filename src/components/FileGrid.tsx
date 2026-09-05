import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../store/useAppStore";
import { FileCard } from "./FileCard";
import { FileRow } from "./FileRow";
import { nextFocusIndex } from "../lib/gridNav";
import { filterFiles } from "../lib/filter";
import { sortFiles } from "../lib/sort";
import { applyBucketVisibility } from "../lib/buckets";
import { applyGroupView } from "../lib/groupView";
import { groupIndexMap } from "../lib/groupColors";
import { undo, redo } from "../lib/history";
import {
  exceedsThreshold,
  idsInRect,
  mergeSelection,
  rectFromPoints,
  type Rect,
} from "../lib/marquee";
import { trashFiles, revealInExplorer } from "../lib/commands";
import { moveToFolder, returnToLibrary, syncFolders } from "../lib/fileActions";
import { formatBytes } from "./Toolbar";
import { bindingsWithDefaults, matchAction } from "../lib/keybindings";
import { scanFlow, exitApp } from "../lib/appActions";
import type { FileInfo } from "../lib/types";

/** The readable half of whatever a rejected command threw. Tauri rejects with a plain string;
 *  everything else arrives as an Error. Either way the user gets the sentence, not "[object
 *  Object]" and not a stack. */
export function messageOf(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

const ROW = 42; // px list row height (compact — §3)
const GAP = 6; // px between grid cells (matches gap-1.5 / px-1.5)
const LIST_COLUMNS = 3; // list view is three parallel columns (§2)

/** Files per grid row: exactly 10 with the sidebar closed, 9 with it open (§2). The cell width
 *  is then derived from the container, so the row always spans the full width with no dead
 *  space on the right, whatever the window size. */
export function gridColumns(list: boolean, sidebarCollapsed: boolean): number {
  if (list) return LIST_COLUMNS;
  return sidebarCollapsed ? 10 : 9;
}

/** Width of one grid cell inside a `containerWidth`-wide viewport with `columns` cells. */
export function cellWidth(containerWidth: number, columns: number): number {
  const usable = containerWidth - 2 * GAP - (columns - 1) * GAP;
  return Math.max(48, Math.floor(usable / columns));
}

export function FileGrid() {
  const files = useAppStore((s) => s.files);
  const query = useAppStore((s) => s.query);
  const sortBy = useAppStore((s) => s.sortBy);
  const sortDir = useAppStore((s) => s.sortDir);
  const viewMode = useAppStore((s) => s.viewMode);
  const focusedId = useAppStore((s) => s.focusedId);
  const setFocus = useAppStore((s) => s.setFocus);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const groups = useAppStore((s) => s.groups);
  const activeGroupId = useAppStore((s) => s.activeGroupId);
  const hiddenBuckets = useAppStore((s) => s.hiddenBuckets);
  const browseFolder = useAppStore((s) => s.browseFolder);
  const browseFiles = useAppStore((s) => s.browseFiles);
  const setVisibleIds = useAppStore((s) => s.setVisibleIds);
  const refreshNonce = useAppStore((s) => s.refreshNonce);
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Track the viewport width so the cells can divide it evenly. Without this the layout would be
  // frozen at whatever width the first render happened to see (sidebar toggles, window resizes).
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return; // jsdom
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const source = browseFolder ? browseFiles : files;
  const bucketKind = sortBy === "date" || sortBy === "type" ? sortBy : null;

  // The visible set = filter (search) → hide toggled-off buckets → sort → group view. This is
  // exactly what renders, what the keyboard navigates, and what a range selection walks, so the
  // grid, the list, the preview and the keyboard can never disagree. Never mutates `files`.
  const visible = useMemo(() => {
    const filtered = applyBucketVisibility(filterFiles(source, query), bucketKind, hiddenBuckets);
    const sorted = sortFiles(filtered, sortBy, sortDir);
    return browseFolder ? sorted : applyGroupView(sorted, groups, activeGroupId);
  }, [source, query, sortBy, sortDir, bucketKind, hiddenBuckets, groups, activeGroupId, browseFolder]);

  // Publish the render order so store-side selection (Shift+click, Shift+Arrow) and the preview's
  // ←/→ follow what is on screen rather than the raw scan order (§4).
  useEffect(() => {
    setVisibleIds(visible.map((f) => f.id));
  }, [visible, setVisibleIds]);

  const groupIndex = useMemo(() => groupIndexMap(groups), [groups]);

  // Dragging a tile drags the whole selection when that tile is part of it, and just that tile
  // otherwise — the same rule Explorer and Finder use.
  const onDragStart = (id: string) => (e: React.DragEvent) => {
    const st = useAppStore.getState();
    const ids = st.selectedIds.includes(id) ? st.selectedIds : [id];
    if (!st.selectedIds.includes(id)) st.selectOnly(id);
    st.setDraggingIds(ids);
    e.dataTransfer.effectAllowed = "move";
    // The payload lives in the store (dataTransfer.getData is unreadable during dragover, which
    // is exactly when the sidebar needs to know how many files are coming). This is just the
    // handshake that makes the browser treat it as a real drag.
    e.dataTransfer.setData("text/plain", ids.join("\n"));
  };
  const onDragEnd = () => useAppStore.getState().setDraggingIds([]);

  // ---- Marquee selection (§3) -------------------------------------------------------------
  // A press on empty space starts a rubber band; every tile it touches joins the selection while
  // the mouse is still down. The listeners live on `window` for the duration of the drag so the
  // band keeps tracking even when the pointer leaves the grid (or the window).
  const [marquee, setMarquee] = useState<Rect | null>(null);

  const onGridMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // left button only; right-click opens the context menu
    const el = parentRef.current;
    const target = e.target as HTMLElement;
    // Only empty space starts a band — a press on a tile is a click or the start of a drag-move.
    if (!el || target.closest("[data-file-id]")) return;

    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const base = additive ? useAppStore.getState().selectedIds : [];
    const ax = e.clientX;
    const ay = e.clientY;
    let dragged = false;

    const onMove = (m: MouseEvent) => {
      if (!dragged && !exceedsThreshold(ax, ay, m.clientX, m.clientY)) return;
      dragged = true;
      const rect = rectFromPoints(ax, ay, m.clientX, m.clientY);
      setMarquee(rect);
      // Only mounted rows exist (the grid is virtualized), which is also the only thing the user
      // can see and sweep — so "what the box covers" and "what is on screen" agree.
      const tiles = [...el.querySelectorAll<HTMLElement>("[data-file-id]")].map((node) => ({
        id: node.dataset.fileId!,
        rect: node.getBoundingClientRect() as Rect,
      }));
      useAppStore
        .getState()
        .setSelection(mergeSelection(base, idsInRect(tiles, rect), additive ? "add" : "replace"));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setMarquee(null);
      // A press that never became a drag is a click on the background: clear the selection, the
      // way clicking empty space does in every file manager.
      if (!dragged && !additive) useAppStore.getState().clearSelection();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const list = viewMode === "list";
  const columns = gridColumns(list, sidebarCollapsed);
  const cw = cellWidth(width || 1200, columns);
  const ch = Math.max(72, Math.round(cw * 0.95)); // near-square tiles, room for the name strip
  const rows = Math.ceil(visible.length / columns);
  const rowHeight = list ? ROW : ch + GAP;

  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  // Row height changes with the window (cells divide the width, so they also get taller/shorter)
  // and when switching views. The virtualizer caches measurements, so tell it to re-measure or
  // rows would keep the geometry of the previous layout.
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  // Keep focus on a visible file: default to the first once results exist, and re-home it
  // when the current filter hides the focused file.
  useEffect(() => {
    const fid = useAppStore.getState().focusedId;
    if (visible.length > 0 && (fid == null || !visible.some((f) => f.id === fid))) {
      setFocus(visible[0].id);
    }
  }, [visible, setFocus]);

  // Keyboard: keybinding-driven global actions + digit moves + focus nav. Reads live state and
  // the (defaults-merged) bindings on every keypress via getState(), so it needs no deps and never
  // re-subscribes. Inert while a modal owns the keyboard; ignored while typing in a form field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      const st = useAppStore.getState();
      const { focusedId, previewId, folders, selectedIds, trashOpen, renameOpen, settingsOpen, projectsOpen, query, sortBy, sortDir } = st;
      const bindings = bindingsWithDefaults(st.settings.keybindings);
      const browsing = st.browseFolder != null;
      const src = browsing ? st.browseFiles : st.files;
      const kind = sortBy === "date" || sortBy === "type" ? sortBy : null;
      const sorted = sortFiles(
        applyBucketVisibility(filterFiles(src, query), kind, st.hiddenBuckets),
        sortBy,
        sortDir,
      );
      const files = browsing ? sorted : applyGroupView(sorted, st.groups, st.activeGroupId); // visible order
      const action = matchAction(bindings, e, "global");

      // Modal panels own the keyboard (their own Esc closes them).
      if (renameOpen || settingsOpen || projectsOpen || st.renameFileId || st.pendingDelete) return;

      // Trash panel: only its toggle / Esc are live.
      if (trashOpen) {
        if (action === "toggleTrash" || e.key === "Escape") {
          e.preventDefault();
          if (e.key === "Escape") st.closeTrash();
          else st.toggleTrash();
        }
        return;
      }

      if (previewId != null) return; // Preview owns Esc / ←/→ / rotate / zoom

      // Undo / redo are fixed (not rebindable) — work even on an empty grid. Both replay
      // library operations, so they stay out of the way while browsing a target folder.
      if (!browsing && e.ctrlKey && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        void undo().catch(() => {});
        return;
      }
      if (!browsing && e.ctrlKey && ((e.key === "y" || e.key === "Y") || (e.shiftKey && (e.key === "z" || e.key === "Z")))) {
        e.preventDefault();
        void redo().catch(() => {});
        return;
      }

      // Enter opens the focused tile in the preview. Double-click was the only way in after
      // Space was unbound, which left the keyboard with no route to the app's main viewer at all.
      if (e.key === "Enter" && focusedId != null && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        st.openPreview(focusedId);
        return;
      }

      // Escape clears a selection, then (on a second press) leaves the folder browser.
      if (e.key === "Escape") {
        if (selectedIds.length > 0) {
          e.preventDefault();
          st.clearSelection();
        } else if (browsing) {
          e.preventDefault();
          st.closeFolderBrowse();
        }
        return;
      }

      // Rebindable global actions.
      if (action) {
        switch (action) {
          case "scanFolder":
            e.preventDefault();
            void scanFlow().catch(() => {});
            return;
          case "newFolder":
            e.preventDefault();
            st.setSidebarCollapsed(false); // make sure the input is visible
            st.requestNewFolder();
            return;
          case "focusSearch":
            e.preventDefault();
            st.requestSearchFocus();
            return;
          case "openSettings":
            e.preventDefault();
            st.openSettings();
            return;
          case "toggleSidebar":
            e.preventDefault();
            st.toggleSidebar();
            return;
          case "exitApp":
            e.preventDefault();
            void exitApp();
            return;
          case "gridView":
            e.preventDefault();
            st.setViewMode("grid");
            return;
          case "listView":
            e.preventDefault();
            st.setViewMode("list");
            return;
          case "toggleTrash":
            e.preventDefault();
            st.toggleTrash();
            return;
          case "selectAll":
            if (files.length > 0) {
              e.preventDefault();
              st.setSelection(files.map((f) => f.id));
            }
            return;
          case "batchRename":
            if (!browsing && files.length > 0) {
              e.preventDefault();
              st.openRename();
            }
            return;
          case "returnToLibrary": {
            if (!browsing) return; // nothing to return: these files are already in the library
            const sel =
              selectedIds.length > 0
                ? files.filter((f) => selectedIds.includes(f.id))
                : files.filter((f) => f.id === focusedId);
            if (sel.length > 0) {
              e.preventDefault();
              st.setNotice(null);
              void returnToLibrary(sel).catch((err) =>
                useAppStore.getState().setNotice(`Could not return the files: ${messageOf(err)}`),
              );
            }
            return;
          }
          case "deletePermanently": {
            // Irreversible and outside the recycle bin, so it opens a confirmation instead of
            // firing straight off a keystroke.
            const sel =
              selectedIds.length > 0
                ? files.filter((f) => selectedIds.includes(f.id))
                : files.filter((f) => f.id === focusedId);
            if (sel.length > 0) {
              e.preventDefault();
              st.requestPermanentDelete(sel);
            }
            return;
          }
          case "trash": {
            if (browsing) return; // the library owns trash/undo; browsing is read-only
            const sel =
              selectedIds.length > 0
                ? files.filter((f) => selectedIds.includes(f.id))
                : files.filter((f) => f.id === focusedId);
            if (sel.length > 0) {
              e.preventDefault();
              const ids = sel.map((f) => f.id);
              st.setNotice(null);
              void trashFiles(sel.map((f) => f.path))
                .then((items) => {
                  st.completeTrash(ids, items);
                  void syncFolders();
                })
                .catch((err) =>
                  useAppStore.getState().setNotice(`Could not move to trash: ${messageOf(err)}`),
                );
            }
            return;
          }
          default:
            return; // preview-scope actions (rotate, zoom) never reach here
        }
      }

      if (files.length === 0) return;

      // Move to target folder N (bare 1–9): the selection if any, else the focused file.
      //
      // Works while browsing a target folder too, which is the keyboard half of folder-to-folder
      // moves (§2): open folder 1, press 3, and those photos are in folder 3. Pressing the digit
      // of the folder you are already looking at is a no-op rather than a move onto itself.
      if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
        const folder = folders.find((f) => f.shortcut === Number(e.key));
        if (!folder || folder.id === st.browseFolder?.id) return;
        const sel =
          selectedIds.length > 0
            ? files.filter((f) => selectedIds.includes(f.id)) // visible order
            : files.filter((f) => f.id === focusedId);
        if (sel.length === 0) return;
        e.preventDefault();
        // A refused move is the one outcome with nothing to see: the tile stays, the count does
        // not budge, and the shortcut reads as broken. Say what went wrong instead.
        st.setNotice(null);
        void moveToFolder(sel, folder).catch((err) =>
          useAppStore.getState().setNotice(`Could not move to ${folder.name}: ${messageOf(err)}`),
        );
        return;
      }

      const cols = list ? LIST_COLUMNS : gridColumns(false, st.sidebarCollapsed);

      // Shift + arrows grow/shrink the selection from the anchor, in visible order (§4).
      if (e.shiftKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const cur = files.findIndex((f) => f.id === focusedId);
        const next = nextFocusIndex(cur, e.key, cols, files.length);
        if (next >= 0 && files[next]) st.selectRangeTo(files[next].id);
        return;
      }

      // Arrow / vim focus movement (within the visible set).
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "j", "k"].includes(e.key)) {
        const cur = files.findIndex((f) => f.id === focusedId);
        const next = nextFocusIndex(cur, e.key, cols, files.length);
        if (next >= 0 && files[next]) setFocus(files[next].id);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFocus, list]);

  // Keep the focused cell in view.
  useEffect(() => {
    if (focusedId == null) return;
    const idx = visible.findIndex((f) => f.id === focusedId);
    if (idx < 0) return;
    try {
      rowVirtualizer.scrollToIndex(Math.floor(idx / columns));
    } catch {
      // virtualizer not laid out yet (e.g. jsdom) — scroll is best-effort
    }
  }, [focusedId, visible, rowVirtualizer, columns]);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <GridHeader shown={visible} total={source.length} />
      <div
        ref={parentRef}
        onMouseDown={onGridMouseDown}
        role="grid"
        aria-multiselectable="true"
        aria-label={browseFolder ? `Files in ${browseFolder.name}` : "Scanned files"}
        aria-rowcount={rows}
        aria-colcount={columns}
        className={`relative flex-1 overflow-auto ${marquee ? "select-none" : ""}`}
      >
        {visible.length === 0 && (
          <div className="h-full grid place-items-center text-sm text-[var(--muted)]">
            {source.length === 0 ? "Nothing here yet" : "No files match the current filters"}
          </div>
        )}
        {/* Keyed on the refresh counter so Ctrl+R remounts every tile: thumbnails are re-resolved
            from disk instead of showing the copy cached before the file changed (§5). */}
        <div key={refreshNonce} style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((vr) => {
            const start = vr.index * columns;
            const cells = visible.slice(start, start + columns);
            return (
              <div
                key={vr.key}
                role="row"
                aria-rowindex={vr.index + 1}
                className={list ? "absolute left-0 flex w-full" : "absolute left-0 flex"}
                style={{
                  top: vr.start,
                  height: list ? ROW : ch,
                  width: "100%",
                  gap: list ? 0 : GAP,
                  padding: list ? 0 : `0 ${GAP}px`,
                }}
              >
                {cells.map((f) =>
                  list ? (
                    <div
                      key={f.id}
                      data-file-id={f.id}
                      role="gridcell"
                      aria-selected={selectedIds.includes(f.id)}
                      draggable
                      onDragStart={onDragStart(f.id)}
                      onDragEnd={onDragEnd}
                      className="min-w-0 flex-1 border-r border-[var(--border)] last:border-r-0"
                    >
                      <FileRow
                        file={f}
                        focused={f.id === focusedId}
                        selected={selectedIds.includes(f.id)}
                        groupIndex={f.groupId != null ? groupIndex.get(f.groupId) ?? null : null}
                      />
                    </div>
                  ) : (
                    <div
                      key={f.id}
                      data-file-id={f.id}
                      role="gridcell"
                      aria-selected={selectedIds.includes(f.id)}
                      draggable
                      onDragStart={onDragStart(f.id)}
                      onDragEnd={onDragEnd}
                      style={{ width: cw, height: ch }}
                      className="shrink-0"
                    >
                      <FileCard
                        file={f}
                        focused={f.id === focusedId}
                        selected={selectedIds.includes(f.id)}
                        groupIndex={f.groupId != null ? groupIndex.get(f.groupId) ?? null : null}
                      />
                    </div>
                  ),
                )}
              </div>
            );
          })}
        </div>
      </div>
      <Notice />
      <SelectionBar />
      {marquee && (
        <div
          data-testid="marquee"
          aria-hidden
          className="pointer-events-none fixed z-30 rounded-sm border border-blue-400 bg-blue-500/20"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: marquee.right - marquee.left,
            height: marquee.bottom - marquee.top,
          }}
        />
      )}
    </div>
  );
}

/**
 * The last thing that went wrong, said out loud.
 *
 * Every file operation the grid fires used to end in `.catch(() => {})`. That is right for a
 * *cancelled* operation and wrong for a failed one: a move the backend refuses looks exactly
 * like a shortcut that does nothing, which is precisely how the 1–9 keys came to be described
 * as broken. It sits above the selection bar, in the same corner-free strip, and clears itself
 * on the next attempt so it can never describe a state that has moved on.
 */
function Notice() {
  const notice = useAppStore((s) => s.notice);
  const setNotice = useAppStore((s) => s.setNotice);
  if (!notice) return null;
  return (
    <div
      role="alert"
      className="surface pointer-events-auto absolute bottom-16 left-1/2 z-30 flex max-w-[80%] -translate-x-1/2 items-center gap-3 rounded-full border border-red-500/50 bg-[var(--panel)] py-1.5 pl-4 pr-1.5 text-sm text-[var(--text)]"
    >
      <span aria-hidden>⚠</span>
      <span className="min-w-0 truncate" title={notice}>
        {notice}
      </span>
      <button
        type="button"
        onClick={() => setNotice(null)}
        aria-label="Dismiss"
        className="press shrink-0 rounded-full bg-[var(--elevated)] px-3 py-1 text-xs hover:bg-[var(--elevated-hover)]"
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * Floating count of what is selected, with the one action that undoes it.
 *
 * The grid ticks selected tiles, but a tick you have to count is no answer when the selection
 * runs past a screenful — which is exactly when the next keystroke (a digit, Delete) is about
 * to act on all of it. It sits over the grid rather than in the toolbar so it is next to the
 * thing it is counting; the toolbar's copy of this number is gone.
 */
function SelectionBar() {
  const selectedIds = useAppStore((s) => s.selectedIds);
  const files = useAppStore((s) => s.files);
  const browseFiles = useAppStore((s) => s.browseFiles);
  const browseFolder = useAppStore((s) => s.browseFolder);
  const clearSelection = useAppStore((s) => s.clearSelection);

  const n = selectedIds.length;
  const source = browseFolder ? browseFiles : files;
  const bytes = useMemo(() => {
    if (n === 0) return 0;
    const picked = new Set(selectedIds);
    return source.reduce((sum, f) => (picked.has(f.id) ? sum + f.size : sum), 0);
  }, [selectedIds, source, n]);

  if (n === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="surface edge-lit pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--border)] py-1.5 pl-4 pr-1.5 text-sm"
    >
      <span className="font-medium tabular-nums text-[var(--text)]">
        {n} item{n > 1 ? "s" : ""} selected
      </span>
      <span className="text-xs tabular-nums text-[var(--muted)]">{formatBytes(bytes)}</span>
      <span className="hidden text-[11px] text-[var(--muted)] sm:inline">
        press <kbd className="rounded bg-[var(--elevated)] px-1">1</kbd>–
        <kbd className="rounded bg-[var(--elevated)] px-1">9</kbd> to file them
      </span>
      <button
        type="button"
        onClick={() => clearSelection()}
        title="Clear the selection (Esc)"
        className="press rounded-full bg-[var(--elevated)] px-3 py-1 text-xs hover:bg-[var(--elevated-hover)]"
      >
        Clear
      </button>
    </div>
  );
}

/** The last segment of a path — the folder's own name, without its parents. */
export function folderName(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end--; // ignore any trailing separator
  let start = end;
  while (start > 0 && path[start - 1] !== "/" && path[start - 1] !== "\\") start--;
  return path.slice(start, end) || path;
}

/**
 * What you are looking at, directly above the thing you are looking at.
 *
 * The folder's name, its item count and its total size used to live in the top-right corner of
 * the toolbar, three clusters away from the grid and diagonally opposite the first tile — so the
 * two facts that describe the grid were the furthest things on screen from it. Here they read as
 * one line, and they say the same thing whether you are in the scanned library or inside one of
 * the 1–9 target folders.
 *
 * `shown` is what the grid is actually rendering, so searching or hiding a bucket moves these
 * numbers; `total` is the folder itself, named alongside them whenever the two disagree.
 */
function GridHeader({ shown, total }: { shown: FileInfo[]; total: number }) {
  const browseFolder = useAppStore((s) => s.browseFolder);
  const roots = useAppStore((s) => s.roots);
  const scanning = useAppStore((s) => s.scanning);
  const selectedCount = useAppStore((s) => s.selectedIds.length);
  const closeFolderBrowse = useAppStore((s) => s.closeFolderBrowse);

  const path = browseFolder ? browseFolder.path : roots[0] ?? "";
  const bytes = useMemo(() => shown.reduce((n, f) => n + f.size, 0), [shown]);
  if (!path) return null; // nothing scanned yet — the empty grid says so on its own

  const name = browseFolder ? browseFolder.name : folderName(path);
  const filtered = shown.length !== total;

  return (
    <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-sm">
      <span aria-hidden>📂</span>
      <span className="truncate font-medium" title={path}>
        {name}
      </span>
      <span className="tabular-nums text-[var(--muted)]" aria-live="polite" aria-atomic="true">
        {scanning
          ? `${shown.length} found…`
          : filtered
            ? `${shown.length} of ${total} items`
            : `${total} item${total === 1 ? "" : "s"}`}
      </span>
      <span className="tabular-nums text-[var(--muted)]">{formatBytes(bytes)}</span>

      {browseFolder && (
        <>
          <button
            type="button"
            disabled={selectedCount === 0}
            title="Move the selected files back into the library (`)"
            onClick={() => {
              const st = useAppStore.getState();
              const sel = st.browseFiles.filter((f) => st.selectedIds.includes(f.id));
              void returnToLibrary(sel).catch(() => {});
            }}
            className="press ml-auto rounded bg-[var(--elevated)] px-2 py-0.5 text-xs hover:bg-[var(--elevated-hover)] disabled:opacity-40"
          >
            Return {selectedCount > 0 ? `${selectedCount} ` : ""}to library
          </button>
          <button
            type="button"
            onClick={() => void revealInExplorer(browseFolder.path).catch(() => {})}
            className="press rounded bg-[var(--elevated)] px-2 py-0.5 text-xs hover:bg-[var(--elevated-hover)]"
          >
            Open in Explorer
          </button>
          <button
            type="button"
            onClick={() => closeFolderBrowse()}
            className="press rounded bg-[var(--elevated)] px-2 py-0.5 text-xs hover:bg-[var(--elevated-hover)]"
          >
            Back to library
          </button>
        </>
      )}
    </div>
  );
}
