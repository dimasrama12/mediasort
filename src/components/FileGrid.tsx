import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../store/useAppStore";
import { FileCard } from "./FileCard";
import { nextFocusIndex } from "../lib/gridNav";
import { filterFiles } from "../lib/filter";
import { undo, redo } from "../lib/history";
import { moveFiles, trashFiles } from "../lib/commands";

const CARD = 160; // px cell size

export function FileGrid() {
  const files = useAppStore((s) => s.files);
  const query = useAppStore((s) => s.query);
  const focusedId = useAppStore((s) => s.focusedId);
  const setFocus = useAppStore((s) => s.setFocus);
  const openPreview = useAppStore((s) => s.openPreview);
  const completeMove = useAppStore((s) => s.completeMove);
  const completeMoveMany = useAppStore((s) => s.completeMoveMany);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const completeTrash = useAppStore((s) => s.completeTrash);
  const toggleTrash = useAppStore((s) => s.toggleTrash);
  const closeTrash = useAppStore((s) => s.closeTrash);
  const openRename = useAppStore((s) => s.openRename);
  const parentRef = useRef<HTMLDivElement>(null);

  // The visible set is what the grid renders and what keyboard nav operates on, so the
  // two always agree. Search never mutates the store's `files`.
  const visible = useMemo(() => filterFiles(files, query), [files, query]);

  const columns = Math.max(1, Math.floor((parentRef.current?.clientWidth ?? 1200) / CARD));
  const rows = Math.ceil(visible.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD,
    overscan: 6,
  });

  // Keep focus on a visible file: default to the first once results exist, and re-home it
  // when the current filter hides the focused file.
  useEffect(() => {
    const fid = useAppStore.getState().focusedId;
    if (visible.length > 0 && (fid == null || !visible.some((f) => f.id === fid))) {
      setFocus(visible[0].id);
    }
  }, [visible, setFocus]);

  // Keyboard: focus nav (#5a) + move-on-keypress / undo (#5b) + trash (#6). Inert while the
  // Preview owns the keyboard, and ignored while typing in a form field (search box included).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const {
        files: allFiles,
        focusedId,
        previewId,
        folders,
        selectedIds,
        trashOpen,
        renameOpen,
        settingsOpen,
        projectsOpen,
        query,
      } = useAppStore.getState();
      // Operate on the visible (filtered) set, exactly what's on screen.
      const files = filterFiles(allFiles, query);

      // A modal panel owns the keyboard while open (its own Esc closes it).
      if (renameOpen || settingsOpen || projectsOpen) return;

      // Trash panel owns the keyboard while open: T/Esc close it, everything else inert.
      if (trashOpen) {
        if (e.key === "t" || e.key === "T" || e.key === "Escape") {
          e.preventDefault();
          if (e.key === "Escape") closeTrash();
          else toggleTrash();
        }
        return;
      }

      if (previewId != null) return; // Preview owns Esc / ←/→

      // Undo (Ctrl+Z) / redo (Ctrl+Y or Ctrl+Shift+Z) — work even on an empty grid.
      if (e.ctrlKey && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        void undo().catch(() => {});
        return;
      }
      if (
        e.ctrlKey &&
        ((e.key === "y" || e.key === "Y") || (e.shiftKey && (e.key === "z" || e.key === "Z")))
      ) {
        e.preventDefault();
        void redo().catch(() => {});
        return;
      }

      // Clear the selection (Escape). Preview already consumed Esc via the previewId guard.
      if (e.key === "Escape") {
        if (selectedIds.length > 0) {
          e.preventDefault();
          clearSelection();
        }
        return;
      }

      // Toggle the trash panel (T) — works even on an empty grid.
      if ((e.key === "t" || e.key === "T") && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        toggleTrash();
        return;
      }

      // Open the rename panel (R) — needs at least one visible file.
      if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (files.length > 0) {
          e.preventDefault();
          openRename();
        }
        return;
      }

      if (files.length === 0) return;

      // Move to target folder N (bare 1–9): the whole selection if any, else the focused file.
      if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
        const folder = folders.find((f) => f.shortcut === Number(e.key));
        if (!folder) return;
        if (selectedIds.length > 0) {
          const sel = files.filter((f) => selectedIds.includes(f.id)); // visible grid order
          if (sel.length > 0) {
            e.preventDefault();
            const ids = sel.map((f) => f.id);
            const paths = sel.map((f) => f.path);
            void moveFiles(paths, folder.path)
              .then((newPaths) => completeMoveMany(ids, folder.id, newPaths))
              .catch(() => {});
          }
          return;
        }
        // Single move uses the index into the full store array (completeMove is index-based).
        const index = allFiles.findIndex((f) => f.id === focusedId);
        if (index >= 0) {
          e.preventDefault();
          const path = allFiles[index].path;
          void moveFiles([path], folder.path)
            .then(([newPath]) => completeMove(index, folder.id, newPath))
            .catch(() => {});
        }
        return;
      }

      // Trash the selection (or the focused file) with Del.
      if (e.key === "Delete") {
        const sel =
          selectedIds.length > 0
            ? files.filter((f) => selectedIds.includes(f.id))
            : files.filter((f) => f.id === focusedId);
        if (sel.length > 0) {
          e.preventDefault();
          const ids = sel.map((f) => f.id);
          void trashFiles(sel.map((f) => f.path))
            .then((items) => completeTrash(ids, items))
            .catch(() => {});
        }
        return;
      }

      // Open the focused file (F / Enter).
      if (e.key === "f" || e.key === "F" || e.key === "Enter") {
        if (focusedId != null) {
          openPreview(focusedId);
          e.preventDefault();
        }
        return;
      }

      // Arrow / vim focus movement (within the visible set).
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "j", "k"].includes(e.key)) {
        const cols = Math.max(1, Math.floor((parentRef.current?.clientWidth ?? 0) / CARD));
        const cur = files.findIndex((f) => f.id === focusedId);
        const next = nextFocusIndex(cur, e.key, cols, files.length);
        if (next >= 0 && files[next]) setFocus(files[next].id);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    setFocus,
    openPreview,
    completeMove,
    completeMoveMany,
    clearSelection,
    completeTrash,
    toggleTrash,
    closeTrash,
    openRename,
  ]);

  // Keep the focused cell in view.
  useEffect(() => {
    if (focusedId == null) return;
    const idx = visible.findIndex((f) => f.id === focusedId);
    if (idx < 0) return;
    const cols = Math.max(1, Math.floor((parentRef.current?.clientWidth ?? 0) / CARD));
    try {
      rowVirtualizer.scrollToIndex(Math.floor(idx / cols));
    } catch {
      // virtualizer not laid out yet (e.g. jsdom) — scroll is best-effort
    }
  }, [focusedId, visible, rowVirtualizer]);

  return (
    <div ref={parentRef} className="flex-1 overflow-auto">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((vr) => {
          const start = vr.index * columns;
          const cells = visible.slice(start, start + columns);
          return (
            <div
              key={vr.key}
              className="absolute left-0 flex gap-2 px-2"
              style={{ top: vr.start, height: CARD, width: "100%" }}
            >
              {cells.map((f) => (
                <FileCard
                  key={f.id}
                  file={f}
                  focused={f.id === focusedId}
                  selected={selectedIds.includes(f.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
