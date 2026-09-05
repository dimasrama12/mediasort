//! Window-level input the grid's keyboard handler can't own (§1, §5).
//!
//! `FileGrid` hands the keyboard to whichever modal is open, which is right for everything that
//! acts on files — but wrong for two actions:
//!
//!   * **Ctrl+' twice** toggles Settings. If it lived in the grid, Settings could be opened and
//!     never closed the same way, because the open modal owns the keyboard.
//!   * **Ctrl+R / F5** refreshes. The webview's own binding *reloads the page*, throwing away the
//!     scan, the undo stack and the folder being browsed; `preventDefault` here is what stops it,
//!     and it has to fire whatever else is open.
//!
//! Right-click is here for the same reason: the native webview menu ("Save image as…", "Copy
//! image", "Reload") offers actions that either don't apply or would break the session, so it is
//! suppressed app-wide and replaced with the app's own menu.
//!
//! Both are plain install/uninstall functions rather than hooks so they can be exercised
//! directly, without standing up the whole application tree.

import { bindingsWithDefaults, isDoubleTap, matchAction } from "./keybindings";
import { refreshApp } from "./refresh";
import { cancelGrouping } from "./commands";
import { abortScan } from "./appActions";
import { useAppStore } from "../store/useAppStore";

/** Install the app-level key handling. Returns the uninstaller. */
export function installGlobalKeys(): () => void {
  /** Timestamp of the previous Ctrl+' press, or null when there is no pending first tap. */
  let lastTap: number | null = null;

  /**
   * Esc aborts whichever long job is running.
   *
   * Registered in the **capture** phase, and separately from the bubble-phase handler below, for
   * two reasons: every other Escape in the app (clear the selection, leave the folder browser,
   * close a panel) listens on the bubble phase and would otherwise consume the key first, and
   * keeping the rest of the app-level bindings on the bubble phase leaves their existing
   * ordering against the modals exactly as it was.
   *
   * Scanning and grouping are the only two operations that can hold the app for minutes, and
   * until now neither could be stopped from the keyboard: a mis-aimed scan of `C:\` or a
   * "Group: Similar" over 10 000 photos had to be waited out. A scan stops mid-walk and keeps
   * what it found; a grouping run is discarded whole, leaving the previous grouping untouched.
   */
  const onEscape = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const st = useAppStore.getState();
    if (!st.scanning && !st.grouping) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (st.scanning) void abortScan();
    if (st.grouping) void cancelGrouping().catch(() => {});
  };

  const onKey = (e: KeyboardEvent) => {
    const st = useAppStore.getState();
    const action = matchAction(bindingsWithDefaults(st.settings.keybindings), e, "global");

    if (action === "refresh") {
      e.preventDefault(); // never let the webview reload the page out from under the session
      void refreshApp().catch(() => {});
      return;
    }
    if (action !== "toggleSettingsDouble") return;
    e.preventDefault();
    const now = Date.now();
    if (isDoubleTap(lastTap, now)) {
      lastTap = null; // a third press starts a fresh pair rather than toggling again
      st.toggleSettings();
    } else {
      lastTap = now;
    }
  };

  window.addEventListener("keydown", onEscape, true);
  window.addEventListener("keydown", onKey);
  return () => {
    window.removeEventListener("keydown", onEscape, true);
    window.removeEventListener("keydown", onKey);
  };
}

/** Install the app-wide right-click handling. Returns the uninstaller. */
export function installContextMenu(): () => void {
  const onMenu = (e: MouseEvent) => {
    e.preventDefault(); // suppress the OS/webview menu everywhere, including over images
    const st = useAppStore.getState();

    // Over a text field there is nothing file-shaped to offer, and the app's three entries would
    // be nonsense — so show nothing rather than the wrong menu.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

    const fileId = t?.closest<HTMLElement>("[data-file-id]")?.dataset.fileId ?? null;
    // Right-clicking outside the current selection moves it there, the way Explorer does;
    // clicking inside it leaves the selection intact so the menu acts on all of it.
    if (fileId && !st.selectedIds.includes(fileId)) st.selectOnly(fileId);
    st.openContextMenu(e.clientX, e.clientY, fileId);
  };

  window.addEventListener("contextmenu", onMenu);
  return () => window.removeEventListener("contextmenu", onMenu);
}
