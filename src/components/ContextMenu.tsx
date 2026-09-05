import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { trashSelection } from "../lib/fileActions";
import { refreshApp } from "../lib/refresh";

/** Roughly what the menu measures before it is on screen; used to keep the first paint inside the
 *  window. The real size is measured immediately after and corrects any drift. */
const EST_WIDTH = 176;
const EST_HEIGHT = 190;

/** Keep the menu fully on screen: flip it back inside the viewport rather than letting it hang
 *  off the right or bottom edge, which is where a right-click near a corner always lands. */
export function clampMenu(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
): { left: number; top: number } {
  return {
    left: Math.max(4, Math.min(x, vw - w - 4)),
    top: Math.max(4, Math.min(y, vh - h - 4)),
  };
}

/** The app's own right-click menu (§5). The OS/webview menu — "Save image as…", "Copy image",
 *  "Reload" — is suppressed app-wide in `App.tsx`; this replaces it with the five things you can
 *  actually do to a file from here. Text only: at this size an icon column is decoration that
 *  costs a third of the menu's width and names nothing the label has not already named. */
export function ContextMenu() {
  const menu = useAppStore((s) => s.contextMenu);
  const close = useAppStore((s) => s.closeContextMenu);
  const openExif = useAppStore((s) => s.openExif);
  const openRenameFile = useAppStore((s) => s.openRenameFile);
  const openRename = useAppStore((s) => s.openRename);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: EST_WIDTH, h: EST_HEIGHT });

  // Measure once it exists, so the clamping uses the real box on the very next frame.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.width !== size.w || r.height !== size.h)) {
      setSize({ w: r.width, h: r.height });
    }
  }, [menu, size.w, size.h]);

  // Anything that moves the page out from under the menu dismisses it: a click anywhere, Esc,
  // a scroll, or the window resizing.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu, close]);

  if (!menu) return null;

  const st = useAppStore.getState();
  const browsing = st.browseFolder != null;
  const source = browsing ? st.browseFiles : st.files;
  // The click already put the file under the cursor into the selection (see App.tsx), so acting
  // on "the selection" is the same as acting on what was right-clicked, plus anything else the
  // user had picked out — which is what a file manager does.
  const targets =
    menu.fileId == null
      ? []
      : st.selectedIds.includes(menu.fileId)
        ? source.filter((f) => st.selectedIds.includes(f.id))
        : source.filter((f) => f.id === menu.fileId);

  const onDelete = () => {
    close();
    void trashSelection(targets).catch(() => {});
  };
  const onRefresh = () => {
    close();
    void refreshApp().catch(() => {});
  };
  const onExif = () => {
    if (menu.fileId) openExif(menu.fileId);
  };
  const onRename = () => {
    if (menu.fileId) openRenameFile(menu.fileId);
  };
  const onBatchRename = () => {
    close();
    openRename();
  };

  const { left, top } = clampMenu(
    menu.x,
    menu.y,
    size.w,
    size.h,
    typeof window === "undefined" ? 1280 : window.innerWidth,
    typeof window === "undefined" ? 800 : window.innerHeight,
  );

  // No icon column: `px-3` alone carries the whole row, so a label starts where the menu starts.
  const item =
    "flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[var(--elevated)] disabled:opacity-40 disabled:hover:bg-transparent";

  const readOnly = browsing ? "Files inside a target folder are read-only" : undefined;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="File actions"
      style={{ left, top }}
      className="surface edge-lit fixed z-[70] min-w-[184px] origin-top-left overflow-hidden rounded-lg border border-[var(--border)] py-1"
    >
      <button
        type="button"
        role="menuitem"
        className={item}
        disabled={targets.length === 0 || browsing}
        onClick={onDelete}
        title={readOnly ?? "Move to the app trash"}
      >
        {/* "Delete" sat one keystroke away from Shift+Delete's *permanent* delete and meant
            something entirely different (undoable, restorable). Say which one this is. */}
        Move to trash
        {targets.length > 1 && (
          <span className="ml-auto text-[11px] text-[var(--muted)] tabular-nums">
            {targets.length}
          </span>
        )}
      </button>
      <button type="button" role="menuitem" className={item} onClick={onRefresh}>
        Refresh
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        disabled={menu.fileId == null}
        onClick={onExif}
      >
        EXIF data
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        disabled={menu.fileId == null || browsing}
        onClick={onRename}
        title={readOnly ?? "Rename this one file"}
      >
        Rename
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        disabled={targets.length === 0 || browsing}
        onClick={onBatchRename}
        title={readOnly ?? "Number the whole selection to a pattern (Shift+R)"}
      >
        Batch rename
      </button>
    </div>
  );
}
