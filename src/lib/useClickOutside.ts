//! "Click outside to close" (§1). Both the Settings modal and the Trash sidebar float over the
//! app behind a dim backdrop; before this, the only ways out were Esc, the ✕ and (for Settings)
//! the Done button, so a click on the app itself did nothing at all and read as a frozen UI.
//!
//! The listener is on `mousedown` rather than `click`: a click that starts inside the panel and
//! ends outside it (dragging a slider past the panel edge, selecting label text) must not count
//! as "clicking away". It is also registered only while `active`, and always *after* the event
//! that opened the panel has finished — so the very click that opened it can never close it.

import { useEffect, type RefObject } from "react";

export function useClickOutside(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      const target = e.target as Node | null;
      // A target detached from the document (a menu item that removed itself on mousedown)
      // isn't "outside" in any useful sense — ignore it rather than closing behind the user.
      if (!el || !target || !target.isConnected) return;
      if (!el.contains(target)) onOutside();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [active, ref, onOutside]);
}
