import type { MouseEvent } from "react";
import type { FileInfo } from "./types";
import { useAppStore } from "../store/useAppStore";

/** Shared click/selection behavior for a file tile or row: plain click selects only, Ctrl/Cmd
 *  toggles, Shift extends the range from the focus anchor; double-click opens the preview. */
export function useFileSelection(file: FileInfo) {
  const selectOnly = useAppStore((s) => s.selectOnly);
  const toggleSelected = useAppStore((s) => s.toggleSelected);
  const selectRangeTo = useAppStore((s) => s.selectRangeTo);
  const openPreview = useAppStore((s) => s.openPreview);

  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (e.shiftKey) selectRangeTo(file.id);
    else if (e.ctrlKey || e.metaKey) toggleSelected(file.id);
    else selectOnly(file.id);
  };
  const onDoubleClick = () => openPreview(file.id);
  return { onClick, onDoubleClick };
}
