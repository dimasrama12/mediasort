import { useEffect, type RefObject } from "react";

/** Everything a person can Tab to. `:not([disabled])` and the negative-tabindex exclusion keep
 *  the cycle to controls that are actually reachable right now. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Keep keyboard focus inside `ref` while `active`, and give it back to whatever had it when the
 * panel closes.
 *
 * Every modal in this app renders *over* the file grid, which keeps its own window-level key
 * handler. Without a trap, Tab walked straight out of the dialog and into the tiles behind it:
 * the focus ring vanished under the scrim, and the next Space or arrow key went somewhere the
 * user could not see. Nothing about that is visible to a sighted mouse user, which is exactly
 * why it survived this long.
 *
 * Deliberately small: it does not manage `aria-modal` (each dialog sets its own), and it never
 * steals focus from a control the dialog has already focused itself.
 */
export function useFocusTrap(active: boolean, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const previous = document.activeElement as HTMLElement | null;
    // Only take focus if it is not already inside — a dialog that focuses its own Cancel button
    // (ConfirmDelete) must keep that choice.
    if (!root.contains(document.activeElement)) {
      const first = focusable(root)[0];
      (first ?? root).focus?.();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusable(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      // Wrap at both ends, and pull focus back in if it has escaped the dialog entirely.
      if (e.shiftKey && (current === first || !root.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !root.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // Restoring focus is the half people forget: without it, closing a dialog leaves focus on
      // <body> and the next keystroke reaches nothing at all.
      if (previous && document.contains(previous)) previous.focus?.();
    };
  }, [active, ref]);
}
