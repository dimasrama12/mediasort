import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../store/useAppStore";
import { FileCard } from "./FileCard";

const CARD = 160; // px cell size (the thumbnail slice will fill these)

export function FileGrid() {
  const files = useAppStore((s) => s.files);
  const parentRef = useRef<HTMLDivElement>(null);
  const columns = Math.max(1, Math.floor((parentRef.current?.clientWidth ?? 1200) / CARD));
  const rows = Math.ceil(files.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD,
    overscan: 6,
  });

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
                <FileCard key={f.id} file={f} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
