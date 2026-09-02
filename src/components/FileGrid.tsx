import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../store/useAppStore";
import { FileCard } from "./FileCard";
import { nextFocusIndex } from "../lib/gridNav";
import { moveFiles, trashFiles } from "../lib/commands";

const CARD = 160; // px cell size

export function FileGrid() {
  const files = useAppStore((s) => s.files);
  const focusedId = useAppStore((s) => s.focusedId);
  const setFocus = useAppStore((s) => s.setFocus);
  const openPreview = useAppStore((s) => s.openPreview);
  const completeMove = useAppStore((s) => s.completeMove);
  const completeMoveMany = useAppStore((s) => s.completeMoveMany);
  const completeUndo = useAppStore((s) => s.completeUndo);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const completeTrash = useAppStore((s) => s.completeTrash);
  const toggleTrash = useAppStore((s) => s.toggleTrash);
  const closeTrash = useAppStore((s) => s.closeTrash);
  const parentRef = useRef<HTMLDivElement>(null);
  const columns = Math.max(1, Math.floor((parentRef.current?.clientWidth ?? 1200) / CARD));
  const rows = Math.ceil(files.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD,
    overscan: 6,
  });

  // Default focus to the first file once results exist.
  useEffect(() => {
    if (files.length > 0 && useAppStore.getState().focusedId == null) {
      setFocus(files[0].id);
    }
  }, [files, setFocus]);

  // Keyboard: focus nav (#5a) + move-on-keypress / undo (#5b). Inert while the
  // Preview owns the keyboard, and ignored while typing in a form field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const { files, focusedId, previewId, folders, moveHistory, selectedIds, trashOpen } =
        useAppStore.getState();

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

      // Undo the last move (Ctrl+Z) — works even if the grid just emptied.
      if (e.ctrlKey && (e.key === "z" || e.key === "Z")) {
        const top = moveHistory[moveHistory.length - 1];
        if (top) {
          e.preventDefault();
          void moveFiles([top.toPath], top.fromDir)
            .then(([backPath]) => completeUndo(backPath))
            .catch(() => {});
        }
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

      if (files.length === 0) return;

      // Move to target folder N (bare 1–9): the whole selection if any, else the focused file.
      if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
        const folder = folders.find((f) => f.shortcut === Number(e.key));
        if (!folder) return;
        if (selectedIds.length > 0) {
          const sel = files.filter((f) => selectedIds.includes(f.id)); // grid order
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
        const index = files.findIndex((f) => f.id === focusedId);
        if (index >= 0) {
          e.preventDefault();
          const path = files[index].path;
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
            .then(() => completeTrash(ids))
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

      // Arrow / vim focus movement.
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
    completeUndo,
    completeMoveMany,
    clearSelection,
    completeTrash,
    toggleTrash,
    closeTrash,
  ]);

  // Keep the focused cell in view.
  useEffect(() => {
    if (focusedId == null) return;
    const idx = files.findIndex((f) => f.id === focusedId);
    if (idx < 0) return;
    const cols = Math.max(1, Math.floor((parentRef.current?.clientWidth ?? 0) / CARD));
    try {
      rowVirtualizer.scrollToIndex(Math.floor(idx / cols));
    } catch {
      // virtualizer not laid out yet (e.g. jsdom) — scroll is best-effort
    }
  }, [focusedId, files, rowVirtualizer]);

  return (
    <div ref={parentRef} className="flex-1 overflow-auto">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((vr) => {
          const start = vr.index * columns;
          const cells = files.slice(start, start + columns);
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
