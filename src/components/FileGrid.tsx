import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../store/useAppStore";
import { FileCard } from "./FileCard";
import { nextFocusIndex } from "../lib/gridNav";

const CARD = 160; // px cell size

export function FileGrid() {
  const files = useAppStore((s) => s.files);
  const focusedId = useAppStore((s) => s.focusedId);
  const setFocus = useAppStore((s) => s.setFocus);
  const openPreview = useAppStore((s) => s.openPreview);
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

  // Keyboard navigation — inert while the Preview owns the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { files, focusedId, previewId } = useAppStore.getState();
      if (previewId != null || files.length === 0) return;
      if (e.key === "f" || e.key === "F" || e.key === "Enter") {
        if (focusedId != null) {
          openPreview(focusedId);
          e.preventDefault();
        }
        return;
      }
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
  }, [setFocus, openPreview]);

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
                <FileCard key={f.id} file={f} focused={f.id === focusedId} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
